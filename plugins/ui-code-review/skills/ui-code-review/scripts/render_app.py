#!/usr/bin/env python3
"""
Render the ui-code-review three-pane review app as a single self-contained HTML page.

Usage:
    python render_app.py state.json -o app.html      # static snapshot (no polling)
    python render_app.py --shell -o app.html         # live shell (polls /state.json)

Two consumers:
  * `serve_review.py` imports `build_page(state=None, live=True)` to serve the live
    shell; the page then fetches `/state.json` and re-renders on every poll, which is
    how the diff view refreshes when the agent edits code.
  * Run directly with a state file to bake a static, shareable snapshot.

The page is fully offline-safe: all CSS and JS are inline, no CDN, no external fetch
other than the same-origin `/state.json` poll in live mode. It is theme-aware
(light / dark) and renders three panes: a change/file sidebar on the left, a
GitHub-style diff in the center (with whitespace, split/unified, and old-only /
new-only toggles), and the review chat on the right.

See references/web-presentation.md for the state.json model this consumes; it is a
superset of references/review-schema.md.
"""
import argparse
import json
import sys

# Severity vocabulary mirrors scripts/render_review.py so the two renderers agree.
# The client re-declares it in JS (below); this copy documents the contract and is
# used by any future server-side rendering.
SEVERITY_ORDER = ["blocker", "high", "medium", "low", "nit", "question", "praise"]

# The whole app: one placeholder for the initial state, one for the live flag.
# Substitution (not str.format) keeps the CSS/JS braces un-escaped.
TEMPLATE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
:root{
  --bg:#fbfbfa; --panel:#fff; --ink:#1a1a1a; --mut:#6b7280; --line:#e5e7eb;
  --accent:#2563eb;
  --add-bg:#e6ffec; --add-gut:#cdfacd; --del-bg:#ffebe9; --del-gut:#ffc9c9;
  --hunk:#f1f5ff; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
:root[data-theme="dark"]{
  --bg:#0f1115;--panel:#161a20;--ink:#e6e6e6;--mut:#9aa4b2;--line:#2a2f37;
  --accent:#5b8bf0;
  --add-bg:#0f2f1c;--add-gut:#1f5133;--del-bg:#3a1a1c;--del-gut:#5a2427;--hunk:#1a2233;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0f1115;--panel:#161a20;--ink:#e6e6e6;--mut:#9aa4b2;--line:#2a2f37;
    --accent:#5b8bf0;
    --add-bg:#0f2f1c;--add-gut:#1f5133;--del-bg:#3a1a1c;--del-gut:#5a2427;--hunk:#1a2233;
  }
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
button{font:inherit;cursor:pointer}
code{font-family:var(--mono);font-size:.92em;background:var(--hunk);
  padding:1px 4px;border-radius:4px}

/* ---- layout: three panes + top bar ---- */
.app{display:grid;grid-template-columns:250px 1fr 380px;grid-template-rows:auto 1fr;
  height:100vh;}
.topbar{grid-column:1 / 4;display:flex;align-items:center;gap:14px;
  padding:9px 16px;background:var(--panel);border-bottom:1px solid var(--line)}
.topbar h1{margin:0;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topbar .scope{color:var(--mut);font-size:12px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;flex:1}
.topbar .mode{font-size:11px;text-transform:uppercase;letter-spacing:.05em;
  background:var(--hunk);color:var(--mut);padding:2px 9px;border-radius:20px}
.topbar .status{font-size:11px;color:var(--mut);min-width:70px;text-align:right}
.iconbtn{background:var(--panel);border:1px solid var(--line);color:var(--mut);
  border-radius:6px;padding:3px 9px}
.iconbtn:hover{color:var(--ink)}

.sidebar{grid-row:2;overflow-y:auto;background:var(--panel);
  border-right:1px solid var(--line);padding:8px}
.center{grid-row:2;overflow:auto;padding:0}
.chat{grid-row:2;overflow-y:auto;background:var(--panel);
  border-left:1px solid var(--line);display:flex;flex-direction:column}

/* ---- sidebar ---- */
.nav-item{display:block;width:100%;text-align:left;border:0;background:none;
  color:var(--ink);padding:7px 9px;border-radius:7px;margin-bottom:2px;line-height:1.35}
.nav-item:hover{background:var(--bg)}
.nav-item.sel{background:var(--hunk);color:var(--ink);font-weight:600}
.nav-item .n-file{display:block;font-family:var(--mono);font-size:11px;color:var(--mut);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav-item .n-title{display:block;font-size:13px}
.nav-item .n-row{display:flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--mut)}
.dot.current{background:var(--accent)} .dot.reviewed{background:#1a7f37}
.dot.fixed{background:#1a7f37} .dot.skipped{background:var(--line)}
.nav-sec{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);
  padding:10px 9px 4px}
.mini-badges{display:inline-flex;gap:3px;margin-left:auto}

/* ---- center / diff ---- */
.diff-toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:6px;
  align-items:center;padding:9px 14px;background:var(--panel);
  border-bottom:1px solid var(--line)}
.diff-toolbar .fname{font-family:var(--mono);font-size:12px;color:var(--mut);
  margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}
.seg button{border:0;background:var(--panel);color:var(--mut);padding:3px 10px;font-size:12px}
.seg button+button{border-left:1px solid var(--line)}
.seg button.on{background:var(--accent);color:#fff}
.seg button:disabled{opacity:.4;cursor:default}
.toggle{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);
  border-radius:7px;padding:3px 9px;font-size:12px;color:var(--mut)}
.toggle.on{color:var(--ink);border-color:var(--accent)}
.toggle input{margin:0}
.center-pad{padding:14px}
.overview h2{font-size:15px;margin:18px 0 6px}
.overview .verdict{border-left:3px solid var(--accent);padding:8px 12px;background:var(--panel);
  border-radius:0 8px 8px 0;margin:6px 0}
.stats{color:var(--mut);font-size:13px;margin:6px 0}
.add-t{color:#1a7f37;font-weight:600} .del-t{color:#cf222e;font-weight:600}
.routine{margin-top:10px} .routine summary{cursor:pointer;font-weight:600}
.routine ul{margin:8px 0 0;padding-left:20px;color:var(--mut)} .routine li{margin:3px 0}

table.diff{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12.5px}
table.diff td{padding:0 8px;white-space:pre-wrap;word-break:break-word;vertical-align:top}
td.gut{width:1px;text-align:right;color:var(--mut);user-select:none;
  border-right:1px solid var(--line);opacity:.7;white-space:nowrap}
td.code{width:auto}
tr.d-add{background:var(--add-bg)} tr.d-add .gut{background:var(--add-gut)}
tr.d-del{background:var(--del-bg)} tr.d-del .gut{background:var(--del-gut)}
tr.d-hunk .code{background:var(--hunk);color:var(--mut)}
tr.d-file td{background:var(--panel);color:var(--mut);font-weight:600;
  border-top:1px solid var(--line);padding:6px 8px}
tr.blank{background:repeating-linear-gradient(45deg,transparent,transparent 6px,var(--bg) 6px,var(--bg) 12px)}
tr.flash td{animation:flash 1.4s ease-out}
@keyframes flash{0%{background:#fff3bf}100%{background:transparent}}
.diff-empty{color:var(--mut);font-style:italic;padding:16px}

/* ---- chat ---- */
.chat-scroll{flex:1;overflow-y:auto;padding:14px}
.msg{margin-bottom:14px}
.msg .who{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);
  margin-bottom:3px}
.msg .bubble{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 11px}
.beat{margin:5px 0} .beat b{color:var(--ink)}
.finding{border-left:3px solid var(--line);padding:6px 9px;margin:8px 0;
  border-radius:0 6px 6px 0;background:var(--bg)}
.finding .f-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.finding .f-title{font-weight:600;margin-top:2px}
.finding .f-body{margin-top:2px}
.src{font-size:11px;color:var(--mut);font-family:var(--mono)}
.fix{border:1px dashed var(--accent);border-radius:8px;padding:9px 11px;margin-top:8px;background:var(--bg)}
.fix .fx-head{font-weight:600;color:var(--accent);margin-bottom:4px}
.no-findings{color:var(--mut);font-style:italic}
.badge{font-size:11px;font-weight:700;padding:1px 8px;border-radius:20px;color:#fff}
.badge.mini{padding:0 6px}
.sev-blocker{background:#8b0000} .sev-high{background:#cf222e}
.sev-medium{background:#d97706} .sev-low{background:#6b7280}
.sev-nit{background:#8b8b8b} .sev-question{background:#2563eb} .sev-praise{background:#1a7f37}
.jump{font-family:var(--mono);font-size:11px;border:1px solid var(--line);
  background:var(--panel);color:var(--mut);border-radius:5px;padding:0 6px}
.jump:hover{color:var(--ink)}

.composer{border-top:1px solid var(--line);padding:10px 12px;background:var(--panel)}
.composer .hint{font-size:12px;color:var(--mut);margin-bottom:6px}
.composer textarea{width:100%;min-height:56px;resize:vertical;border:1px solid var(--line);
  border-radius:8px;padding:8px;background:var(--bg);color:var(--ink);font:inherit}
.composer .row{display:flex;gap:8px;margin-top:6px}
.composer button{border:1px solid var(--line);background:var(--panel);color:var(--ink);
  border-radius:7px;padding:5px 12px}
.composer button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.composer .copied{color:#1a7f37;font-size:12px;align-self:center}
</style></head>
<body>
<div class="app">
  <div class="topbar">
    <h1 id="title">Code review</h1>
    <span class="mode" id="mode"></span>
    <span class="scope" id="scope"></span>
    <span class="status" id="poll-status"></span>
    <button class="iconbtn" id="theme-btn" title="Toggle light/dark">◐</button>
  </div>
  <div class="sidebar" id="sidebar"></div>
  <div class="center" id="center"></div>
  <div class="chat">
    <div class="chat-scroll" id="chat"></div>
    <div class="composer" id="composer"></div>
  </div>
</div>

<script>
const LIVE = __LIVE__;
let STATE = __INITIAL_STATE__;
let selected = null;            // selected change id, or "__overview__"
let userPicked = false;         // has the user clicked a nav item this session?
const view = { split:false, ignoreWs:false, side:"both" };  // diff view options

const SEV = {
  blocker:{label:"Blocker",cls:"sev-blocker",order:0},
  high:{label:"High",cls:"sev-high",order:1},
  medium:{label:"Medium",cls:"sev-medium",order:2},
  low:{label:"Low",cls:"sev-low",order:3},
  nit:{label:"Nit",cls:"sev-nit",order:4},
  question:{label:"Question",cls:"sev-question",order:5},
  praise:{label:"Praise",cls:"sev-praise",order:6},
};
const sev = n => SEV[(n||"").toLowerCase()] || {label:n||"Note",cls:"sev-low",order:3};
const SEVCOL = {"sev-blocker":"#8b0000","sev-high":"#cf222e","sev-medium":"#d97706",
  "sev-low":"#6b7280","sev-nit":"#8b8b8b","sev-question":"#2563eb","sev-praise":"#1a7f37"};

function esc(s){return (s==null?"":String(s)).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
// minimal inline markdown: escape, then `code`, **bold**, *italic*, newlines
function md(s){
  if(s==null) return "";
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g,"<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*/g,"$1<em>$2</em>");
  t = t.replace(/\n/g,"<br>");
  return t;
}

/* ---------- unified-diff parsing ----------
 Returns [{file, hunks:[{lines:[{type,old,new,text}]}]}]. type: ctx|add|del. */
function parseDiff(text){
  const files = [];
  let file=null, hunk=null, oldLn=0, newLn=0;
  const lines=(text||"").split("\n");
  if(lines.length && lines[lines.length-1]==="") lines.pop();  // drop the tail from a trailing newline
  lines.forEach(raw=>{
    if(raw.startsWith("diff ")){ file={name:null,hunks:[]}; files.push(file); hunk=null; return; }
    let m;
    if((m=raw.match(/^\+\+\+ (?:b\/)?(.*)$/))){ if(file) file.name=m[1]==="/dev/null"?(file.name):m[1]; return; }
    if((m=raw.match(/^--- (?:a\/)?(.*)$/))){ if(file&&!file.name&&m[1]!=="/dev/null") file.name=m[1]; return; }
    if(raw.startsWith("index ")||raw.startsWith("new file")||raw.startsWith("deleted file")
       ||raw.startsWith("old mode")||raw.startsWith("new mode")||raw.startsWith("similarity")
       ||raw.startsWith("rename ")||raw.startsWith("copy ")) return;
    if((m=raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/))){
      if(!file){ file={name:null,hunks:[]}; files.push(file); }
      oldLn=+m[1]; newLn=+m[2]; hunk={header:raw,lines:[]}; file.hunks.push(hunk); return;
    }
    if(!hunk){ return; }  // preamble outside a hunk
    if(raw.startsWith("\\ ")) return;  // "\ No newline at end of file" — not a content line
    if(raw.startsWith("+")){ hunk.lines.push({type:"add",old:null,new:newLn++,text:raw.slice(1)}); }
    else if(raw.startsWith("-")){ hunk.lines.push({type:"del",old:oldLn++,new:null,text:raw.slice(1)}); }
    else { const t = raw.startsWith(" ")?raw.slice(1):raw;
           hunk.lines.push({type:"ctx",old:oldLn++,new:newLn++,text:t}); }
  });
  return files;
}

function diffTableUnified(cid, files){
  let rows="";
  files.forEach(f=>{
    if(f.name && files.length>1) rows+=`<tr class="d-file"><td colspan="3">${esc(f.name)}</td></tr>`;
    f.hunks.forEach(h=>{
      rows+=`<tr class="d-hunk"><td class="gut"></td><td class="gut"></td><td class="code">${esc(h.header)}</td></tr>`;
      h.lines.forEach(l=>{
        if(view.side==="old" && l.type==="add") return;
        if(view.side==="new" && l.type==="del") return;
        const cls = l.type==="add"?"d-add":l.type==="del"?"d-del":"d-ctx";
        const sign = l.type==="add"?"+":l.type==="del"?"-":" ";
        const idAttr = l.new!=null ? ` id="${cid}-L${l.new}"` : "";
        rows+=`<tr class="${cls}"${idAttr}><td class="gut">${l.old??""}</td>`+
              `<td class="gut">${l.new??""}</td><td class="code">${esc(sign+l.text)}</td></tr>`;
      });
    });
  });
  return `<table class="diff">${rows}</table>`;
}

// pair consecutive del/add runs for side-by-side rendering
function diffTableSplit(cid, files){
  let rows="";
  const emit=(L,R)=>{
    const lc=L?(L.type==="del"?"d-del":"d-ctx"):"blank";
    const rc=R?(R.type==="add"?"d-add":"d-ctx"):"blank";
    const rid=R&&R.new!=null?` id="${cid}-L${R.new}"`:"";
    rows+=`<tr${rid}>`+
      `<td class="gut ${lc}">${L?(L.old??""):""}</td><td class="code ${lc}">${L?esc(L.text):""}</td>`+
      `<td class="gut ${rc}">${R?(R.new??""):""}</td><td class="code ${rc}">${R?esc(R.text):""}</td></tr>`;
  };
  files.forEach(f=>{
    if(f.name && files.length>1) rows+=`<tr class="d-file"><td colspan="4">${esc(f.name)}</td></tr>`;
    f.hunks.forEach(h=>{
      rows+=`<tr class="d-hunk"><td class="gut"></td><td class="code">${esc(h.header)}</td><td class="gut"></td><td class="code"></td></tr>`;
      let dels=[],adds=[];
      const flush=()=>{ const n=Math.max(dels.length,adds.length);
        for(let i=0;i<n;i++) emit(dels[i]||null,adds[i]||null); dels=[];adds=[]; };
      h.lines.forEach(l=>{
        if(l.type==="del") dels.push(l);
        else if(l.type==="add") adds.push(l);
        else { flush(); emit(l,l); }
      });
      flush();
    });
  });
  return `<table class="diff diff-split">${rows}</table>`;
}

function renderDiff(ch){
  const src = (view.ignoreWs && ch.diff_nows) ? ch.diff_nows : ch.diff;
  if(!src) return `<div class="diff-empty">No diff for this change.</div>`;
  const files = parseDiff(src);
  return (view.split && view.side==="both") ? diffTableSplit(ch.id, files)
                                            : diffTableUnified(ch.id, files);
}

/* ---------- panes ---------- */
function miniBadges(comments){
  const counts={};
  (comments||[]).forEach(c=>{const s=sev(c.severity);counts[s.cls]=(counts[s.cls]||0)+1;});
  return Object.keys(counts).sort().map(cls=>`<span class="badge ${cls} mini">${counts[cls]}</span>`).join("");
}

function renderSidebar(){
  const sb=document.getElementById("sidebar");
  let h=`<button class="nav-item ${selected==="__overview__"?"sel":""}" data-id="__overview__">`+
        `<span class="n-title">Overview &amp; verdict</span></button>`;
  h+=`<div class="nav-sec">Changes (${(STATE.changes||[]).length})</div>`;
  (STATE.changes||[]).forEach((ch,i)=>{
    const st=ch.status||(ch.id===STATE.current?"current":"pending");
    h+=`<button class="nav-item ${selected===ch.id?"sel":""}" data-id="${esc(ch.id)}">`+
       `<span class="n-file">${esc(ch.file||"")}</span>`+
       `<span class="n-row"><span class="dot ${esc(st)}"></span>`+
       `<span class="n-title">${i+1}. ${md(ch.title||ch.id)}</span>`+
       `<span class="mini-badges">${miniBadges(ch.comments)}</span></span></button>`;
  });
  sb.innerHTML=h;
  sb.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{selected=b.dataset.id;userPicked=true;renderAll();});
}

function renderOverviewCenter(){
  const o=STATE.overview||{}, s=STATE.summary||{};
  const stats=[];
  if(s.files_changed!=null) stats.push(`<b>${s.files_changed}</b> files`);
  if(s.additions!=null) stats.push(`<span class="add-t">+${s.additions}</span>`);
  if(s.deletions!=null) stats.push(`<span class="del-t">-${s.deletions}</span>`);
  let routine="";
  if((s.routine||[]).length){
    routine=`<details class="routine" open><summary>Routine / skipped (${s.routine.length})</summary>`+
            `<ul>${s.routine.map(r=>`<li>${md(r)}</li>`).join("")}</ul></details>`;
  }
  return `<div class="center-pad overview">`+
    (o.what?`<h2>What this PR does</h2><div>${md(o.what)}</div>`:"")+
    (o.scope_line?`<h2>Scope</h2><div>${md(o.scope_line)}</div>`:"")+
    (stats.length?`<div class="stats">${stats.join(" · ")}</div>`:"")+
    routine+
    (o.verdict?`<h2>Verdict</h2><div class="verdict">${md(o.verdict)}</div>`:"")+
    `</div>`;
}

function renderCenter(){
  const c=document.getElementById("center");
  if(selected==="__overview__" || !currentChange()){ c.innerHTML=renderOverviewCenter(); return; }
  const ch=currentChange();
  const hasNows=!!ch.diff_nows;
  // split only applies with both sides shown; reflect the effective state so the toolbar can't lie
  const effSplit=view.split && view.side==="both";
  const splitDis=view.side!=="both"?"disabled":"";
  const toolbar=`<div class="diff-toolbar">`+
    `<span class="fname">${esc(ch.file||"")}</span>`+
    `<div class="seg"><button data-split="0" class="${!effSplit?"on":""}">Unified</button>`+
      `<button data-split="1" class="${effSplit?"on":""}" ${splitDis}>Split</button></div>`+
    `<div class="seg">`+
      `<button data-side="both" class="${view.side==="both"?"on":""}">Both</button>`+
      `<button data-side="old" class="${view.side==="old"?"on":""}">Old</button>`+
      `<button data-side="new" class="${view.side==="new"?"on":""}">New</button></div>`+
    `<label class="toggle ${view.ignoreWs?"on":""}" title="${hasNows?"":"No whitespace-ignored diff provided"}">`+
      `<input type="checkbox" id="ws" ${view.ignoreWs?"checked":""} ${hasNows?"":"disabled"}>Ignore whitespace</label>`+
    `</div>`;
  c.innerHTML=toolbar+`<div class="center-pad" id="diffwrap">${renderDiff(ch)}</div>`;
  c.querySelectorAll("[data-split]").forEach(b=>b.onclick=()=>{view.split=b.dataset.split==="1";renderCenter();});
  c.querySelectorAll("[data-side]").forEach(b=>b.onclick=()=>{view.side=b.dataset.side;renderCenter();});
  const ws=document.getElementById("ws"); if(ws) ws.onchange=()=>{view.ignoreWs=ws.checked;renderCenter();};
}

function beat(label,val){ return val?`<div class="beat"><b>${label}:</b> ${md(val)}</div>`:""; }

function renderFinding(cid,f){
  const s=sev(f.severity);
  const jump=f.line!=null?`<button class="jump" data-target="${cid}-L${f.line}">L${f.line}</button>`:"";
  const src=f.source?`<span class="src">[${esc(f.source)}]</span>`:"";
  return `<div class="finding" style="border-left-color:${SEVCOL[s.cls]||"var(--line)"}">`+
    `<div class="f-head"><span class="badge ${s.cls}">${s.label}</span>${jump}${src}</div>`+
    (f.title?`<div class="f-title">${md(f.title)}</div>`:"")+
    `<div class="f-body">${md(f.body)}</div></div>`;
}

function renderChat(){
  const chat=document.getElementById("chat");
  let h="";
  if(selected==="__overview__" || !currentChange()){
    const o=STATE.overview||{};
    h=`<div class="msg"><div class="who">Reviewer</div>`+
      `<div class="bubble">${o.verdict?md(o.verdict):"Select a change on the left to walk through it."}</div></div>`;
  } else {
    const ch=currentChange(), b=ch.briefing||{};
    let briefing=beat("What this is",b.what)+beat("Why it exists",b.why)+
                 beat("What uses it",b.uses)+beat("Who consumes it",b.consumes)+beat("Tested",b.tested);
    const comments=(ch.comments||[]).slice().sort((a,c)=>sev(a.severity).order-sev(c.severity).order);
    const findings = comments.length
      ? comments.map(c=>renderFinding(ch.id,c)).join("")
      : `<div class="no-findings">Nothing jumps out — looks correct.</div>`;
    const fix = ch.proposed_fix?`<div class="fix"><div class="fx-head">Proposed fix</div>${md(ch.proposed_fix)}</div>`:"";
    const action = ch.action?`<div class="msg"><div class="who">Options</div><div class="bubble">${md(ch.action)}</div></div>`:"";
    h=`<div class="msg"><div class="who">${esc(ch.title||ch.id)}</div><div class="bubble">${briefing||"—"}</div></div>`+
      `<div class="msg"><div class="who">What could be improved</div><div class="bubble">${findings}${fix}</div></div>`+
      action;
  }
  chat.innerHTML=h;
  chat.querySelectorAll(".jump").forEach(btn=>btn.onclick=()=>{
    const el=document.getElementById(btn.dataset.target); if(!el) return;
    el.scrollIntoView({behavior:"smooth",block:"center"});
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  });
}

function renderComposer(){
  const el=document.getElementById("composer");
  const hint = STATE.input_hint ||
    "This box composes your reply and copies it — then paste it into the terminal where Claude is running.";
  const prev=(document.getElementById("say")||{}).value||"";  // keep the user's text across re-renders
  el.innerHTML=`<div class="hint">${md(hint)}</div>`+
    `<textarea id="say" placeholder="Ask for a change, a question, or 'next'..."></textarea>`+
    `<div class="row"><button class="primary" id="copybtn">Copy for terminal</button>`+
    `<span class="copied" id="copied"></span></div>`;
  document.getElementById("say").value=prev;
  document.getElementById("copybtn").onclick=async()=>{
    const t=document.getElementById("say").value;
    try{ await navigator.clipboard.writeText(t); document.getElementById("copied").textContent="Copied — paste in terminal"; }
    catch(e){ document.getElementById("copied").textContent="Copy failed — select and copy manually"; }
  };
}

function currentChange(){ return (STATE.changes||[]).find(c=>c.id===selected); }

function renderTop(){
  document.getElementById("title").textContent=STATE.title||"Code review";
  document.getElementById("scope").textContent=STATE.scope||"";
  const m=document.getElementById("mode"); m.textContent=STATE.mode||""; m.style.display=STATE.mode?"":"none";
}

function renderAll(){ renderTop(); renderSidebar(); renderCenter(); renderChat(); renderComposer(); }

/* ---------- initial selection + live polling ---------- */
function pickInitial(){
  if(!userPicked){ selected = STATE.current || ((STATE.changes||[])[0]||{}).id || "__overview__"; }
  if(selected!=="__overview__" && !currentChange()) selected="__overview__";
}

// theme toggle (cycles auto -> light -> dark by stamping data-theme)
document.getElementById("theme-btn").onclick=()=>{
  const r=document.documentElement, cur=r.getAttribute("data-theme");
  r.setAttribute("data-theme", cur==="dark"?"light":"dark");
};

let lastJSON = JSON.stringify(STATE);
async function poll(){
  try{
    const r=await fetch("state.json",{cache:"no-store"});
    if(r.ok){
      const txt=await r.text();
      if(txt!==lastJSON){
        lastJSON=txt; STATE=JSON.parse(txt);
        const keep=selected; pickInitial(); if(userPicked && (keep==="__overview__"||currentChange())) selected=keep;
        renderAll();
        const s=document.getElementById("poll-status"); s.textContent="updated";
        setTimeout(()=>{if(s.textContent==="updated")s.textContent="live";},1200);
      }
    }
  }catch(e){ document.getElementById("poll-status").textContent="offline"; }
}

pickInitial();
renderAll();
if(LIVE){
  document.getElementById("poll-status").textContent="live";
  setInterval(poll, 1500);
}
</script>
</body></html>"""


def build_page(state=None, live=True):
    """Return the full HTML page. In live mode the baked state is a placeholder the
    page immediately refreshes from /state.json; in static mode it is the snapshot."""
    initial = json.dumps(state if state is not None else {"title": "Code review",
                                                          "changes": [], "current": None},
                         ensure_ascii=False)
    title = (state or {}).get("title", "Code review") if state else "Code review"
    return (TEMPLATE
            .replace("__TITLE__", title.replace("<", "&lt;"))
            .replace("__LIVE__", "true" if live else "false")
            .replace("__INITIAL_STATE__", initial))


def main():
    ap = argparse.ArgumentParser(description="Render the ui-code-review three-pane app.")
    ap.add_argument("input", nargs="?", help="Path to state JSON (omit with --shell).")
    ap.add_argument("--shell", action="store_true",
                    help="Emit a live shell that polls /state.json (no baked data).")
    ap.add_argument("-o", "--output", default="app.html", help="Output HTML path.")
    args = ap.parse_args()

    if args.shell:
        page = build_page(state=None, live=True)
    else:
        raw = open(args.input, encoding="utf-8").read() if args.input else sys.stdin.read()
        page = build_page(state=json.loads(raw), live=False)

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
