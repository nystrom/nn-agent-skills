#!/usr/bin/env python3
"""
Render the ui-code-review review page as a single self-contained HTML file.

Usage:
    python render_app.py state.json -o review.html [--open]

The page opens over `file://` — it fetches nothing and needs no server. It is
theme-aware (light / dark) and has two tabs:

- **Overview** — the whole-change story: what it does, scope, before/after
  architecture diagrams, verdict, advantages/disadvantages/risks, cross-cutting
  concerns, and the folded bookkeeping list.
- **Changes** — three panes: the change sidebar on the left, the diff in the
  center (only that change's hunks, with a whole-file toggle, split/unified,
  old-only / new-only, whitespace, full old/new file views, and a marker on every
  line carrying a finding), and the briefing, context, and findings on the right.

See references/web-presentation.md for the state.json model this consumes; it is a
superset of references/review-schema.md. Diagram, usage, and tradeoff specs are in
references/diagrams.md.
"""
import argparse
import json
import os
import subprocess
import sys
import webbrowser

# Severity vocabulary. The client re-declares it in JS (below); this copy documents
# the contract for any caller that validates state before rendering.
SEVERITY_ORDER = ["blocker", "high", "medium", "low", "nit", "question", "praise"]

# The whole app: one placeholder for the title, one for the baked state.
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

/* ---- layout: top bar with tabs, then either the overview or the three panes ---- */
.app{display:grid;grid-template-columns:250px 1fr 380px;grid-template-rows:auto 1fr;
  height:100vh;}
.topbar{grid-column:1 / 4;display:flex;align-items:center;gap:14px;
  padding:9px 16px;background:var(--panel);border-bottom:1px solid var(--line)}
.topbar h1{margin:0;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topbar .scope{color:var(--mut);font-size:12px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;flex:1}
.topbar .gen{color:var(--mut);font-size:11px;white-space:nowrap}
.iconbtn{background:var(--panel);border:1px solid var(--line);color:var(--mut);
  border-radius:6px;padding:3px 9px}
.iconbtn:hover{color:var(--ink)}
.tabs button{padding:4px 14px;font-weight:600}

.overview{grid-column:1 / 4;grid-row:2;overflow-y:auto;background:var(--panel);
  padding:18px 22px 40px}
.overview .ov-body{max-width:1150px}
.sidebar{grid-row:2;overflow-y:auto;background:var(--panel);
  border-right:1px solid var(--line);padding:8px}
.center{grid-row:2;overflow:auto;padding:0}
.notes{grid-row:2;overflow-y:auto;background:var(--panel);
  border-left:1px solid var(--line);padding:14px}
.app[data-tab="overview"] .sidebar,
.app[data-tab="overview"] .center,
.app[data-tab="overview"] .notes{display:none}
.app[data-tab="changes"] .overview{display:none}

/* ---- sidebar ---- */
.nav-item{display:block;width:100%;text-align:left;border:0;background:none;
  color:var(--ink);padding:7px 9px;border-radius:7px;margin-bottom:2px;line-height:1.35}
.nav-item:hover{background:var(--bg)}
.nav-item.sel{background:var(--hunk);color:var(--ink);font-weight:600}
.nav-item .n-file{display:block;font-family:var(--mono);font-size:11px;color:var(--mut);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav-item .n-title{display:block;font-size:13px}
.nav-item .n-row{display:flex;align-items:center;gap:6px}
.nav-sec{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);
  padding:10px 9px 4px}
.mini-badges{display:inline-flex;gap:3px;margin-left:auto}

/* ---- center / diff ---- */
.diff-toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:6px;
  align-items:center;padding:9px 14px;background:var(--panel);
  border-bottom:1px solid var(--line)}
.diff-toolbar .fname{font-family:var(--mono);font-size:12px;color:var(--mut);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.diff-toolbar .kind{font-size:11px;text-transform:uppercase;letter-spacing:.05em;
  background:var(--hunk);color:var(--mut);padding:1px 8px;border-radius:20px;
  margin-right:auto}
.diff-toolbar .kind.none{margin-right:auto;background:none;padding:0}
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
.overview h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;
  letter-spacing:.05em;color:var(--mut)}
.overview h2:first-child{margin-top:0}
.overview .verdict{border-left:3px solid var(--accent);padding:8px 12px;background:var(--bg);
  border-radius:0 8px 8px 0;margin:6px 0}
.overview ul.xcut{margin:6px 0 0;padding-left:20px} .overview ul.xcut li{margin:3px 0}
.stats{color:var(--mut);font-size:13px;margin:6px 0}
.add-t{color:#1a7f37;font-weight:600} .del-t{color:#cf222e;font-weight:600}
.routine{margin-top:18px} .routine summary{cursor:pointer;font-weight:600;color:var(--mut)}
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
tr.has-mk .code{box-shadow:inset 2px 0 0 var(--accent)}
.mk{font-family:var(--mono);font-size:10.5px;font-weight:700;color:#fff;border:0;
  border-radius:10px;padding:0 6px;margin-right:6px;vertical-align:1px}
.mk:hover{outline:1px solid var(--ink)}

/* ---- right pane: explanation + findings ---- */
.msg{margin-bottom:14px}
.msg .who{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);
  margin-bottom:3px}
.msg .bubble{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 11px}
.beat{margin:5px 0} .beat b{color:var(--ink)}
.finding{border-left:3px solid var(--line);padding:6px 9px;margin:8px 0;
  border-radius:0 6px 6px 0;background:var(--bg)}
.finding.flash{animation:flash 1.4s ease-out}
.finding .f-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.finding .f-title{font-weight:600;margin-top:2px}
.finding .f-body{margin-top:2px}
.src{font-size:11px;color:var(--mut);font-family:var(--mono)}
.sugg{border-top:1px dashed var(--line);margin-top:6px;padding-top:5px;font-size:13px}
.sugg b{color:var(--accent)}
.ctx{margin:8px 0;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.ctx>summary{cursor:pointer;padding:6px 9px;font-size:12px;font-weight:600}
.ctx .ctx-path{font-family:var(--mono);font-size:11px;color:var(--mut);font-weight:400}
.ctx pre{margin:0;padding:8px 9px;border-top:1px solid var(--line);overflow-x:auto;
  font-family:var(--mono);font-size:12px;line-height:1.45}
.no-findings{color:var(--mut);font-style:italic}
.badge{font-size:11px;font-weight:700;padding:1px 8px;border-radius:20px;color:#fff}
.badge.mini{padding:0 6px}
.sev-blocker{background:#8b0000} .sev-high{background:#cf222e}
.sev-medium{background:#d97706} .sev-low{background:#6b7280}
.sev-nit{background:#8b8b8b} .sev-question{background:#2563eb} .sev-praise{background:#1a7f37}
.jump{font-family:var(--mono);font-size:11px;border:1px solid var(--line);
  background:var(--panel);color:var(--mut);border-radius:5px;padding:0 6px}
.jump:hover{color:var(--ink)}

/* ---- tradeoffs: advantages / disadvantages / risks ---- */
.tro{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:6px 0}
@media (max-width:820px){.tro{grid-template-columns:1fr}}
.tro section{border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:7px 10px}
.tro h3{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.tro h3.adv{color:#1a7f37} .tro h3.dis{color:#d97706} .tro h3.rsk{color:#cf222e}
.tro ul{margin:0;padding-left:17px} .tro li{margin:3px 0}
.notes .tro{grid-template-columns:1fr;gap:6px}

/* ---- diagrams: before/after box-and-arrow panels ---- */
.dg{margin:10px 0}
.dg-title{font-weight:600;font-size:13px}
.dg-cap{color:var(--mut);font-size:12px;margin:2px 0 6px}
.dg-pair{display:grid;grid-template-columns:1fr;gap:10px}
.dg-pair.two{grid-template-columns:1fr 1fr}
@media (max-width:900px){.dg-pair.two{grid-template-columns:1fr}}
.dg-panel{border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:6px 9px 8px}
.dg-panel h4{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;
  color:var(--mut)}
svg.dg-svg{width:100%;height:auto;display:block;overflow:visible}
.dg-svg .nd rect{fill:var(--panel);stroke:var(--line);stroke-width:1.2}
.dg-svg .nd text{fill:var(--ink);font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dg-svg .nd text.sub{fill:var(--mut);font-weight:400;font-size:10.5px}
.dg-svg .nd.added rect{stroke:#1a7f37;fill:var(--add-bg)}
.dg-svg .nd.removed rect{stroke:#cf222e;fill:var(--del-bg);stroke-dasharray:4 3}
.dg-svg .nd.changed rect{stroke:#d97706}
.dg-svg .eg path{fill:none;stroke:var(--mut);stroke-width:1.3}
.dg-svg .eg.added path{stroke:#1a7f37}
.dg-svg .eg.removed path{stroke:#cf222e;stroke-dasharray:4 3}
.dg-svg .eg.changed path{stroke:#d97706}
.dg-svg .eg text{fill:var(--mut);font-size:10.5px;paint-order:stroke;stroke:var(--bg);
  stroke-width:3.5px;stroke-linejoin:round}
.dg-svg marker path{stroke:none}
.dg-svg marker.m-def path{fill:var(--mut)}
.dg-svg marker.m-added path{fill:#1a7f37}
.dg-svg marker.m-removed path{fill:#cf222e}
.dg-svg marker.m-changed path{fill:#d97706}
.dg-note{color:var(--mut);font-size:12px;margin-top:5px}

/* ---- usage: the old way vs. the new way, side by side ---- */
.usg{margin:10px 0;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.usg>summary{cursor:pointer;padding:7px 10px;font-weight:600;font-size:13px}
.usg-body{padding:0 10px 10px}
.usg-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:0}
@media (max-width:900px){.usg-pair{grid-template-columns:1fr}}
.usg-col{min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.usg-col h4{margin:0;padding:5px 9px;font-size:11px;text-transform:uppercase;
  letter-spacing:.06em;color:var(--mut);border-bottom:1px solid var(--line)}
.usg-col.old h4{color:#cf222e} .usg-col.new h4{color:#1a7f37}
.usg-col .u-path{font-family:var(--mono);font-size:10.5px;font-weight:400;color:var(--mut)}
.usg-col pre{margin:0;padding:8px 9px;overflow-x:auto;font-family:var(--mono);
  font-size:12px;line-height:1.45}
.usg-note{color:var(--mut);font-size:12px;margin:6px 0 0}
</style></head>
<body>
<div class="app" id="app" data-tab="overview">
  <div class="topbar">
    <h1 id="title">Code review</h1>
    <span class="scope" id="scope"></span>
    <div class="seg tabs" id="tabs">
      <button data-tab="overview">Overview</button>
      <button data-tab="changes">Changes</button>
    </div>
    <span class="gen" id="gen"></span>
    <button class="iconbtn" id="theme-btn" title="Toggle light/dark">◐</button>
  </div>
  <div class="overview" id="overview"></div>
  <div class="sidebar" id="sidebar"></div>
  <div class="center" id="center"></div>
  <div class="notes" id="notes"></div>
</div>

<script>
const STATE = __STATE__;
let selected = null;            // selected change id
let tab = "overview";           // "overview" | "changes"
// diff view options. mode: the diff or a whole old/new file; whole: this change's
// hunks vs. every hunk in the file.
const view = { split:false, ignoreWs:false, side:"both", mode:"diff", whole:false };

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

/* findings in render order; the index is the finding's anchor id, shared by the
   marker in the diff and the finding in the right pane. */
function sortedComments(ch){
  return (ch.comments||[]).map((c,i)=>Object.assign({_src:i},c))
    .sort((a,b)=>sev(a.severity).order-sev(b.severity).order || a._src-b._src);
}
function commentsByLine(ch){
  const m={};
  sortedComments(ch).forEach((c,fid)=>{
    if(c.line==null) return;
    (m[c.line]=m[c.line]||[]).push(Object.assign({_fid:fid},c));
  });
  return m;
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

// the finding markers that sit on a new-file line
function markers(byLine, ln){
  const list = ln==null ? null : byLine[ln];
  if(!list) return "";
  return list.map(c=>{
    const s=sev(c.severity);
    return `<button class="mk ${s.cls}" data-fid="${c._fid}" `+
           `title="${esc(s.label)}: ${esc(c.title||c.body||"")}">${s.label[0]}</button>`;
  }).join("");
}

function diffTableUnified(cid, files, byLine){
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
        const mk = markers(byLine, l.new);
        const idAttr = l.new!=null ? ` id="${cid}-L${l.new}"` : "";
        rows+=`<tr class="${cls}${mk?" has-mk":""}"${idAttr}><td class="gut">${l.old??""}</td>`+
              `<td class="gut">${l.new??""}</td><td class="code">${mk}${esc(sign+l.text)}</td></tr>`;
      });
    });
  });
  return `<table class="diff">${rows}</table>`;
}

// pair consecutive del/add runs for side-by-side rendering
function diffTableSplit(cid, files, byLine){
  let rows="";
  const emit=(L,R)=>{
    const lc=L?(L.type==="del"?"d-del":"d-ctx"):"blank";
    const rc=R?(R.type==="add"?"d-add":"d-ctx"):"blank";
    const rid=R&&R.new!=null?` id="${cid}-L${R.new}"`:"";
    const mk=R?markers(byLine,R.new):"";
    rows+=`<tr class="${mk?"has-mk":""}"${rid}>`+
      `<td class="gut ${lc}">${L?(L.old??""):""}</td><td class="code ${lc}">${L?esc(L.text):""}</td>`+
      `<td class="gut ${rc}">${R?(R.new??""):""}</td><td class="code ${rc}">${mk}${R?esc(R.text):""}</td></tr>`;
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

// A whole-file diff equal to the change's own diff shows nothing more, so the
// toggle disables itself rather than pretending there is more of the file to see.
function hasWhole(ch){ return !!ch.diff_all && ch.diff_all!==ch.diff; }
// which of the four diff strings the toolbar is currently asking for
function diffSource(ch){
  const whole=view.whole && hasWhole(ch);
  if(whole) return (view.ignoreWs && ch.diff_all_nows) ? ch.diff_all_nows : ch.diff_all;
  return (view.ignoreWs && ch.diff_nows) ? ch.diff_nows : ch.diff;
}
function hasNows(ch){ return (view.whole&&hasWhole(ch)) ? !!ch.diff_all_nows : !!ch.diff_nows; }

function renderDiff(ch){
  const src = diffSource(ch);
  if(!src) return `<div class="diff-empty">No diff for this change.</div>`;
  const files = parseDiff(src);
  const byLine = commentsByLine(ch);
  return (view.split && view.side==="both") ? diffTableSplit(ch.id, files, byLine)
                                            : diffTableUnified(ch.id, files, byLine);
}

/* whole old / new file, numbered, with the same finding markers on the new side */
function renderFileView(ch, which){
  const files=(ch.files||[]).filter(f=>f[which]!=null);
  if(!files.length){
    return `<div class="diff-empty">No ${which} version of the file was included in this review.</div>`;
  }
  const byLine = which==="new" ? commentsByLine(ch) : {};
  return files.map(f=>{
    const lines=String(f[which]).split("\n");
    if(lines.length && lines[lines.length-1]==="") lines.pop();
    const rows=lines.map((t,i)=>{
      const n=i+1, mk=markers(byLine,n);
      const idAttr = which==="new" ? ` id="${ch.id}-L${n}"` : "";
      return `<tr class="${mk?"has-mk":""}"${idAttr}><td class="gut">${n}</td>`+
             `<td class="code">${mk}${esc(t)}</td></tr>`;
    }).join("");
    const head=(ch.files.length>1||f.path)
      ? `<tr class="d-file"><td colspan="2">${esc(f.path||"")} — ${which} version</td></tr>` : "";
    return `<table class="diff">${head}${rows}</table>`;
  }).join("");
}

/* ---------- diagrams ----------
 A diagram is {title, caption, note, before?, after?}; each side is a panel
 {label, nodes, edges}. Nodes carry an explicit `layer` and lay out strictly
 left-to-right, one column per layer; edges run forward only (layer -> higher
 layer). See references/diagrams.md. */
const DG = {NW_MIN:120, NW_MAX:230, GAPX:66, GAPY:18, PAD:10, LH:16, SLH:13};

// greedy wrap to `n` characters, at most `max` lines (last line gets an ellipsis).
// A word longer than the line budget is hard-broken so it cannot overflow its box.
function dgWrap(text, n, max){
  const words=[];
  String(text==null?"":text).split(/\s+/).filter(Boolean).forEach(w=>{
    while(w.length>n){ words.push(w.slice(0,n)); w=w.slice(n); }
    words.push(w);
  });
  const out=[]; let cur="";
  words.forEach(w=>{
    if(!cur) cur=w;
    else if((cur+" "+w).length<=n) cur+=" "+w;
    else { out.push(cur); cur=w; }
  });
  if(cur) out.push(cur);
  if(out.length>max){ const keep=out.slice(0,max); keep[max-1]=keep[max-1]+"…"; return keep; }
  return out.length?out:[""];
}

function dgLayout(panel){
  const nodes=(panel.nodes||[]).map(n=>Object.assign({},n));
  nodes.forEach(n=>{
    n._lines=dgWrap(n.label||n.id, 26, 3);
    n._sub=n.sub?dgWrap(n.sub, 30, 2):[];
    const wide=Math.max(8, ...n._lines.map(t=>t.length), ...n._sub.map(t=>t.length*0.88));
    n.w=Math.max(DG.NW_MIN, Math.min(DG.NW_MAX, Math.round(wide*7.1)+26));
    n.h=18+n._lines.length*DG.LH+(n._sub.length?n._sub.length*DG.SLH+3:0);
  });
  const cols={};
  nodes.forEach(n=>{ const L=Number.isFinite(+n.layer)?+n.layer:0; (cols[L]=cols[L]||[]).push(n); });
  const keys=Object.keys(cols).map(Number).sort((a,b)=>a-b);
  const colH=keys.map(k=>cols[k].reduce((t,n)=>t+n.h,0)+DG.GAPY*(cols[k].length-1));
  const H=Math.max(0,...colH);
  let x=DG.PAD;
  keys.forEach((k,i)=>{
    const cw=Math.max(...cols[k].map(n=>n.w));
    let y=DG.PAD+(H-colH[i])/2;
    cols[k].forEach(n=>{ n.x=x+(cw-n.w)/2; n.y=y; y+=n.h+DG.GAPY; });
    x+=cw+DG.GAPX;
  });
  return {nodes, w:Math.max(x-DG.GAPX+DG.PAD, 2*DG.PAD), h:H+2*DG.PAD};
}

function dgNodeSvg(n){
  const cx=n.x+n.w/2;
  const bodyH=n._lines.length*DG.LH+(n._sub.length?n._sub.length*DG.SLH+3:0);
  let ty=n.y+(n.h-bodyH)/2+12;
  let t="";
  n._lines.forEach(line=>{ t+=`<text x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle">${esc(line)}</text>`; ty+=DG.LH; });
  if(n._sub.length){ ty+=1;
    n._sub.forEach(line=>{ t+=`<text class="sub" x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle">${esc(line)}</text>`; ty+=DG.SLH; }); }
  const cls=["nd", (n.state||"same")].join(" ");
  return `<g class="${esc(cls)}"><rect x="${n.x.toFixed(1)}" y="${n.y.toFixed(1)}" `+
    `width="${n.w}" height="${n.h}" rx="8"></rect>${t}</g>`;
}

function dgEdgeSvg(e, byId, uid){
  const a=byId[e.from], b=byId[e.to];
  if(!a||!b) return "";
  const x1=a.x+a.w, y1=a.y+a.h/2, x2=b.x, y2=b.y+b.h/2;
  const dx=Math.max(28,(x2-x1)/2);
  const d=`M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1+dx).toFixed(1)},${y1.toFixed(1)} `+
          `${(x2-dx).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  const st=({added:"added",removed:"removed",changed:"changed"})[e.state]||"def";
  const lab=e.label
    ? `<text x="${((x1+x2)/2).toFixed(1)}" y="${((y1+y2)/2-5).toFixed(1)}" text-anchor="middle">${esc(e.label)}</text>`
    : "";
  return `<g class="eg ${esc(e.state||"")}"><path d="${d}" marker-end="url(#${uid}-${st})"></path>${lab}</g>`;
}

function dgPanelSvg(panel, uid){
  const L=dgLayout(panel);
  if(!L.nodes.length) return `<div class="dg-note">No nodes in this panel.</div>`;
  const byId={}; L.nodes.forEach(n=>byId[n.id]=n);
  const marks=["def","added","removed","changed"].map(k=>
    `<marker class="m-${k}" id="${uid}-${k}" viewBox="0 0 8 8" refX="7" refY="4" `+
    `markerWidth="7" markerHeight="7" orient="auto-start-reverse">`+
    `<path d="M0,0.5 L8,4 L0,7.5 z"></path></marker>`).join("");
  const edges=(panel.edges||[]).map(e=>dgEdgeSvg(e,byId,uid)).join("");
  return `<svg class="dg-svg" viewBox="0 0 ${Math.ceil(L.w)} ${Math.ceil(L.h)}" `+
    `role="img" preserveAspectRatio="xMidYMin meet"><defs>${marks}</defs>`+
    `${edges}${L.nodes.map(dgNodeSvg).join("")}</svg>`;
}

function renderDiagrams(diagrams, keyPrefix){
  return (diagrams||[]).map((d,i)=>{
    const sides=[];
    if(d.before) sides.push(["before", d.before.label||"Before", d.before]);
    if(d.after)  sides.push(["after",  d.after.label||"After",  d.after]);
    if(!sides.length) return "";
    const panels=sides.map(([k,label,p])=>
      `<div class="dg-panel"><h4>${esc(label)}</h4>`+
      dgPanelSvg(p, `dg-${keyPrefix}-${i}-${k}`)+`</div>`).join("");
    return `<div class="dg">`+
      (d.title?`<div class="dg-title">${md(d.title)}</div>`:"")+
      (d.caption?`<div class="dg-cap">${md(d.caption)}</div>`:"")+
      `<div class="dg-pair ${sides.length>1?"two":""}">${panels}</div>`+
      (d.note?`<div class="dg-note">${md(d.note)}</div>`:"")+`</div>`;
  }).join("");
}

/* ---------- tradeoffs ---------- */
function renderTradeoffs(t){
  if(!t) return "";
  const col=(cls,label,items)=>(items||[]).length
    ? `<section><h3 class="${cls}">${label}</h3><ul>`+
      items.map(i=>`<li>${md(i)}</li>`).join("")+`</ul></section>` : "";
  const body=col("adv","Advantages",t.advantages)+
             col("dis","Disadvantages",t.disadvantages)+
             col("rsk","Risks",t.risks);
  return body?`<div class="tro">${body}</div>`:"";
}

/* ---------- usage: old way vs. new way ---------- */
function renderUsage(usage){
  return (usage||[]).map(u=>{
    const col=(cls,fallback,side)=>side
      ? `<div class="usg-col ${cls}"><h4>${esc(side.label||fallback)} `+
        (side.path?`<span class="u-path">${esc(side.path)}</span>`:"")+`</h4>`+
        `<pre>${esc(side.code||"")}</pre></div>` : "";
    const cols=col("old","The old way",u.before)+col("new","The new way",u.after);
    if(!cols) return "";
    return `<details class="usg" open><summary>${md(u.title||"Old way vs. new way")}</summary>`+
      `<div class="usg-body"><div class="usg-pair">${cols}</div>`+
      (u.note?`<div class="usg-note">${md(u.note)}</div>`:"")+`</div></details>`;
  }).join("");
}

/* ---------- panes ---------- */
function miniBadges(comments){
  const counts={};
  (comments||[]).forEach(c=>{const s=sev(c.severity);counts[s.cls]=(counts[s.cls]||0)+1;});
  return Object.keys(counts).sort().map(cls=>`<span class="badge ${cls} mini">${counts[cls]}</span>`).join("");
}

function renderSidebar(){
  const sb=document.getElementById("sidebar");
  let h=`<div class="nav-sec">Changes (${(STATE.changes||[]).length})</div>`;
  (STATE.changes||[]).forEach((ch,i)=>{
    h+=`<button class="nav-item ${selected===ch.id?"sel":""}" data-id="${esc(ch.id)}">`+
       `<span class="n-file">${esc(ch.file||"")}</span>`+
       `<span class="n-row">`+
       `<span class="n-title">${i+1}. ${md(ch.title||ch.id)}</span>`+
       `<span class="mini-badges">${miniBadges(ch.comments)}</span></span></button>`;
  });
  sb.innerHTML=h;
  sb.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{selected=b.dataset.id;renderPanes();});
}

function renderOverview(){
  const o=STATE.overview||{}, s=STATE.summary||{};
  const stats=[];
  if(s.files_changed!=null) stats.push(`<b>${s.files_changed}</b> files`);
  if(s.additions!=null) stats.push(`<span class="add-t">+${s.additions}</span>`);
  if(s.deletions!=null) stats.push(`<span class="del-t">-${s.deletions}</span>`);
  let routine="";
  if((s.routine||[]).length){
    routine=`<details class="routine"><summary>Skipped as bookkeeping (${s.routine.length})</summary>`+
            `<ul>${s.routine.map(r=>`<li>${md(r)}</li>`).join("")}</ul></details>`;
  }
  const xcut=(o.cross_cutting||[]).length
    ? `<h2>Cross-cutting concerns</h2><ul class="xcut">`+
      o.cross_cutting.map(c=>`<li>${md(c)}</li>`).join("")+`</ul>`
    : "";
  const dg=renderDiagrams(o.diagrams,"ov");
  const tro=renderTradeoffs(o.tradeoffs);
  document.getElementById("overview").innerHTML=`<div class="ov-body">`+
    (o.what?`<h2>What this change does</h2><div>${md(o.what)}</div>`:"")+
    (o.scope_line?`<h2>Scope</h2><div>${md(o.scope_line)}</div>`:"")+
    (stats.length?`<div class="stats">${stats.join(" · ")}</div>`:"")+
    (dg?`<h2>Architecture</h2>${dg}`:"")+
    (o.verdict?`<h2>Verdict</h2><div class="verdict">${md(o.verdict)}</div>`:"")+
    (tro?`<h2>Advantages, disadvantages, risks</h2>${tro}`:"")+
    xcut+routine+`</div>`;
}

function renderCenter(){
  const c=document.getElementById("center");
  const ch=currentChange();
  if(!ch){ c.innerHTML=`<div class="diff-empty">No changes to review.</div>`; return; }
  const nows=hasNows(ch);
  const isDiff=view.mode==="diff";
  // split only applies to a both-sides diff; reflect the effective state so the toolbar can't lie
  const effSplit=isDiff && view.split && view.side==="both";
  const sideDis=isDiff?"":"disabled";
  const splitDis=(!isDiff||view.side!=="both")?"disabled":"";
  const hasOld=(ch.files||[]).some(f=>f.old!=null);
  const hasNew=(ch.files||[]).some(f=>f.new!=null);
  // a toggle the current change can't honour reads as off, but keeps the preference
  const wholeOn=isDiff && hasWhole(ch) && view.whole;
  const wsOn=isDiff && nows && view.ignoreWs;
  const toolbar=`<div class="diff-toolbar">`+
    `<span class="fname">${esc(ch.file||"")}</span>`+
    (ch.kind?`<span class="kind">${esc(ch.kind)}</span>`:`<span class="kind none"></span>`)+
    `<div class="seg">`+
      `<button data-mode="diff" class="${isDiff?"on":""}">Diff</button>`+
      `<button data-mode="oldfile" class="${view.mode==="oldfile"?"on":""}" ${hasOld?"":"disabled"} `+
        `title="${hasOld?"Whole old version of the file":"No old file version in this review"}">Old file</button>`+
      `<button data-mode="newfile" class="${view.mode==="newfile"?"on":""}" ${hasNew?"":"disabled"} `+
        `title="${hasNew?"Whole new version of the file":"No new file version in this review"}">New file</button></div>`+
    `<div class="seg"><button data-split="0" class="${!effSplit?"on":""}" ${sideDis}>Unified</button>`+
      `<button data-split="1" class="${effSplit?"on":""}" ${splitDis}>Split</button></div>`+
    `<div class="seg">`+
      `<button data-side="both" class="${view.side==="both"?"on":""}" ${sideDis}>Both</button>`+
      `<button data-side="old" class="${view.side==="old"?"on":""}" ${sideDis}>Old</button>`+
      `<button data-side="new" class="${view.side==="new"?"on":""}" ${sideDis}>New</button></div>`+
    `<label class="toggle ${wholeOn?"on":""}" title="${hasWhole(ch)?"Show every change to this file, not just this one":"This change owns every hunk in the file"}">`+
      `<input type="checkbox" id="whole" ${wholeOn?"checked":""} ${(isDiff&&hasWhole(ch))?"":"disabled"}>Whole file</label>`+
    `<label class="toggle ${wsOn?"on":""}" title="${nows?"":"No whitespace-ignored diff provided"}">`+
      `<input type="checkbox" id="ws" ${wsOn?"checked":""} ${(isDiff&&nows)?"":"disabled"}>Ignore whitespace</label>`+
    `</div>`;
  const dg=renderDiagrams(ch.diagrams, ch.id);
  const usage=renderUsage(ch.usage);
  const body = isDiff ? renderDiff(ch) : renderFileView(ch, view.mode==="oldfile"?"old":"new");
  c.innerHTML=toolbar+`<div class="center-pad" id="diffwrap">`+dg+usage+body+`</div>`;
  c.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{view.mode=b.dataset.mode;renderCenter();});
  c.querySelectorAll("[data-split]").forEach(b=>b.onclick=()=>{view.split=b.dataset.split==="1";renderCenter();});
  c.querySelectorAll("[data-side]").forEach(b=>b.onclick=()=>{view.side=b.dataset.side;renderCenter();});
  const wh=document.getElementById("whole"); if(wh) wh.onchange=()=>{view.whole=wh.checked;renderCenter();};
  const ws=document.getElementById("ws"); if(ws) ws.onchange=()=>{view.ignoreWs=ws.checked;renderCenter();};
  c.querySelectorAll(".mk").forEach(b=>b.onclick=()=>flashTo(`${ch.id}-F${b.dataset.fid}`));
}

function beat(label,val){ return val?`<div class="beat"><b>${label}:</b> ${md(val)}</div>`:""; }

function renderFinding(cid,f,fid){
  const s=sev(f.severity);
  const jump=f.line!=null?`<button class="jump" data-target="${cid}-L${f.line}">L${f.line}</button>`
            :(f.symbol?`<span class="src">${esc(f.symbol)}</span>`:"");
  const src=f.source?`<span class="src">[${esc(f.source)}]</span>`:"";
  const sugg=f.suggested_fix?`<div class="sugg"><b>Suggested fix:</b> ${md(f.suggested_fix)}</div>`:"";
  return `<div class="finding" id="${cid}-F${fid}" style="border-left-color:${SEVCOL[s.cls]||"var(--line)"}">`+
    `<div class="f-head"><span class="badge ${s.cls}">${s.label}</span>${jump}${src}</div>`+
    (f.title?`<div class="f-title">${md(f.title)}</div>`:"")+
    `<div class="f-body">${md(f.body)}</div>${sugg}</div>`;
}

function renderContext(blocks){
  return (blocks||[]).map(b=>
    `<details class="ctx" ${b.collapsed?"":"open"}><summary>${md(b.label||"Context")} `+
    (b.path?`<span class="ctx-path">${esc(b.path)}</span>`:"")+`</summary>`+
    `<pre>${esc(b.code||"")}</pre></details>`).join("");
}

function renderNotes(){
  const notes=document.getElementById("notes");
  const ch=currentChange();
  if(!ch){ notes.innerHTML=""; return; }
  const b=ch.briefing||{};
  const briefing=beat("What this is",b.what)+beat("Why it exists",b.why)+
                 beat("What uses it",b.uses)+beat("Who consumes it",b.consumes)+
                 beat("Tested",b.tested);
  const ctx=renderContext(ch.context);
  const comments=sortedComments(ch);
  const findings = comments.length
    ? comments.map((c,fid)=>renderFinding(ch.id,c,fid)).join("")
    : `<div class="no-findings">Nothing jumps out — looks correct.</div>`;
  const tro=renderTradeoffs(ch.tradeoffs);
  notes.innerHTML=
    `<div class="msg"><div class="who">${esc(ch.title||ch.id)}</div>`+
    `<div class="bubble">${briefing||"—"}</div></div>`+
    (tro?`<div class="msg"><div class="who">Advantages, disadvantages, risks</div>${tro}</div>`:"")+
    (ctx?`<div class="msg"><div class="who">Context</div>${ctx}</div>`:"")+
    `<div class="msg"><div class="who">What could be improved</div>`+
    `<div class="bubble">${findings}</div></div>`;
  notes.querySelectorAll(".jump").forEach(btn=>btn.onclick=()=>jumpToLine(ch, btn.dataset.target));
}

/* Reach a new-file line wherever it lives: the old-file view has no new-file
   lines, and a line outside this change's own hunks only appears with the whole
   file shown. Widen the view until the anchor exists, then flash it. */
function jumpToLine(ch, id){
  if(view.mode==="oldfile"){ view.mode="diff"; renderCenter(); }
  if(!document.getElementById(id) && hasWhole(ch) && !view.whole){
    view.whole=true; renderCenter();
  }
  flashTo(id);
}

function flashTo(id){
  const el=document.getElementById(id); if(!el) return;
  el.scrollIntoView({behavior:"smooth",block:"center"});
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

function currentChange(){ return (STATE.changes||[]).find(c=>c.id===selected); }

function renderTop(){
  document.getElementById("title").textContent=STATE.title||"Code review";
  document.getElementById("scope").textContent=STATE.scope||"";
  document.getElementById("gen").textContent=STATE.generated_at||"";
  const tabs=document.getElementById("tabs");
  tabs.querySelectorAll("[data-tab]").forEach(b=>{
    b.classList.toggle("on", tab===b.dataset.tab);
    b.onclick=()=>{ tab=b.dataset.tab; document.getElementById("app").dataset.tab=tab;
                    renderTop(); if(tab==="changes") renderPanes(); };
  });
}

/* re-rendered on navigation; the top bar and overview are written once */
function renderPanes(){ renderSidebar(); renderCenter(); renderNotes(); }

// theme toggle (stamps data-theme, overriding the system preference)
document.getElementById("theme-btn").onclick=()=>{
  const r=document.documentElement, cur=r.getAttribute("data-theme");
  r.setAttribute("data-theme", cur==="dark"?"light":"dark");
};

selected = ((STATE.changes||[])[0]||{}).id || null;
renderTop();
renderOverview();
renderPanes();
</script>
</body></html>"""


def build_page(state):
    """Return the whole review as one self-contained HTML page."""
    title = state.get("title") or "Code review"
    return (TEMPLATE
            .replace("__TITLE__", title.replace("<", "&lt;"))
            .replace("__STATE__", json.dumps(state, ensure_ascii=False)))


def open_in_browser(path):
    """Open `path` in the reader's default browser. True if a viewer was launched.

    Prefers the platform launcher over `webbrowser`, which on macOS drives
    AppleScript and both fails and complains loudly where app launching is
    unavailable (a sandbox, a headless box, an SSH session).
    """
    try:
        if sys.platform == "darwin":
            return subprocess.run(["open", path], capture_output=True).returncode == 0
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606 - the only launcher Windows offers
            return True
        if subprocess.run(["xdg-open", path], capture_output=True).returncode == 0:
            return True
    except OSError:
        pass
    return webbrowser.open(f"file://{path}")


def main():
    ap = argparse.ArgumentParser(description="Render the ui-code-review review page.")
    ap.add_argument("input", nargs="?", help="Path to state JSON (default: stdin).")
    ap.add_argument("-o", "--output", default="review.html", help="Output HTML path.")
    ap.add_argument("--open", action="store_true", dest="open_browser",
                    help="Open the rendered page in the default browser.")
    args = ap.parse_args()

    raw = open(args.input, encoding="utf-8").read() if args.input else sys.stdin.read()
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(build_page(json.loads(raw)))
    path = os.path.abspath(args.output)
    print(f"Wrote {args.output}", flush=True)
    if args.open_browser and not open_in_browser(path):
        # no browser this process can launch: the path is still the whole review
        print(f"Could not open a browser. Open it yourself: {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
