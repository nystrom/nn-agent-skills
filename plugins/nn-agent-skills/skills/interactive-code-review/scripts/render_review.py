#!/usr/bin/env python3
"""
Render a code-review walkthrough as a single self-contained HTML file.

Usage:
    python render_review.py review.json -o walkthrough.html
    cat review.json | python render_review.py -o walkthrough.html

This script is the DETERMINISTIC renderer bundled with the interactive-code-review skill.
Claude does the judgment (deciding what is noise, what context matters, and
writing the review); this script only turns the resulting JSON into pixels.
Do not hand-write the HTML — fill in the JSON and run this.

See references/review-schema.md for the full schema. Minimal shape:

{
  "title": "Add token refresh to auth flow",
  "scope": "git diff main...HEAD  (12 files, +340 -88)",
  "summary": {
    "files_changed": 12,
    "additions": 340,
    "deletions": 88,
    "routine": [
      "Removed unused import `os` from auth/session.py",
      "Snapshot `LoginForm` updated: added `refreshToken` field, no behavior change",
      "Whitespace/reformat only in 3 files (skipped)"
    ]
  },
  "changes": [
    {
      "id": "c1",
      "file": "auth/token.py",
      "title": "New refresh_token() coroutine",
      "kind": "logic",
      "diff": "@@ -10,6 +10,20 @@ class TokenStore:\n ...unified diff...",
      "context": [
        {"label": "Caller: login() (auth/session.py:88)", "lang": "python",
         "code": "async def login(...):\n    ...\n    await store.refresh_token()"}
      ],
      "comments": [
        {"severity": "high", "line": 24, "title": "Unbounded retry",
         "body": "The `while True` retry has no ceiling; a persistently failing\nrefresh will spin. Add a max-attempts guard."},
        {"severity": "praise", "body": "Good use of a single lock around the swap."}
      ]
    }
  ]
}
"""
import argparse
import html
import json
import re
import sys
from datetime import datetime

# ---- severity presentation -------------------------------------------------

SEVERITY = {
    "blocker":  {"label": "Blocker",  "cls": "sev-blocker",  "order": 0},
    "high":     {"label": "High",     "cls": "sev-high",     "order": 1},
    "medium":   {"label": "Medium",   "cls": "sev-medium",   "order": 2},
    "low":      {"label": "Low",      "cls": "sev-low",      "order": 3},
    "nit":      {"label": "Nit",      "cls": "sev-nit",      "order": 4},
    "question": {"label": "Question", "cls": "sev-question", "order": 5},
    "praise":   {"label": "Praise",   "cls": "sev-praise",   "order": 6},
}


def sev(name):
    return SEVERITY.get((name or "").lower(), {"label": name or "Note",
                                               "cls": "sev-low", "order": 3})


# ---- tiny, safe inline markdown (escape first, then re-add markup) ----------

def inline(text):
    """Escape HTML, then support `code`, **bold**, and newlines."""
    if text is None:
        return ""
    t = html.escape(str(text))
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = t.replace("\n", "<br>")
    return t


# ---- unified-diff rendering -------------------------------------------------

HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def render_diff(change_id, diff_text):
    """Turn a unified diff string into an HTML table with dual line gutters."""
    if not diff_text:
        return '<div class="diff-empty">No diff provided for this change.</div>'
    old_ln = new_ln = 0
    rows = []
    for raw in diff_text.split("\n"):
        if raw.startswith("@@"):
            m = HUNK_RE.match(raw)
            if m:
                new_ln = int(m.group(1))
                # recover old start too, for the old gutter
                mo = re.match(r"^@@ -(\d+)", raw)
                old_ln = int(mo.group(1)) if mo else 0
            rows.append(
                f'<tr class="d-hunk"><td class="gut"></td><td class="gut"></td>'
                f'<td class="code">{html.escape(raw)}</td></tr>'
            )
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            cls, o, n = "d-add", "", str(new_ln)
            row_id = f'id="{change_id}-L{new_ln}"'
            new_ln += 1
        elif raw.startswith("-") and not raw.startswith("---"):
            cls, o, n, row_id = "d-del", str(old_ln), "", ""
            old_ln += 1
        elif raw.startswith("+++") or raw.startswith("---") or raw.startswith("diff ") \
                or raw.startswith("index "):
            rows.append(
                f'<tr class="d-meta"><td class="gut"></td><td class="gut"></td>'
                f'<td class="code">{html.escape(raw)}</td></tr>'
            )
            continue
        else:  # context line (leading space or empty)
            cls, o, n = "d-ctx", str(old_ln), str(new_ln)
            row_id = f'id="{change_id}-L{new_ln}"'
            old_ln += 1
            new_ln += 1
        rows.append(
            f'<tr class="{cls}" {row_id}><td class="gut">{o}</td>'
            f'<td class="gut">{n}</td><td class="code">{html.escape(raw)}</td></tr>'
        )
    return f'<table class="diff">{"".join(rows)}</table>'


def render_context(block):
    label = inline(block.get("label", "Context"))
    lang = html.escape(block.get("lang", ""))
    code = html.escape(block.get("code", ""))
    path = block.get("path", "")
    path_html = f'<span class="ctx-path">{html.escape(path)}</span>' if path else ""
    collapsed = " open" if not block.get("collapsed") else ""
    return (
        f'<details class="ctx"{collapsed}>'
        f'<summary><span class="ctx-label">{label}</span>{path_html}</summary>'
        f'<pre><code class="language-{lang}">{code}</code></pre>'
        f'</details>'
    )


def render_comment(change_id, c):
    s = sev(c.get("severity"))
    title = inline(c.get("title", "")) if c.get("title") else ""
    body = inline(c.get("body", ""))
    anchor = ""
    if c.get("line") is not None:
        anchor = (f'<button class="jump" data-target="{change_id}-L{c["line"]}">'
                  f'L{c["line"]}</button>')
    elif c.get("symbol"):
        anchor = f'<span class="sym">{inline(c["symbol"])}</span>'
    head = f'<span class="badge {s["cls"]}">{s["label"]}</span>{anchor}'
    title_html = f'<div class="c-title">{title}</div>' if title else ""
    return (f'<div class="comment {s["cls"]}-b">'
            f'<div class="c-head">{head}</div>{title_html}'
            f'<div class="c-body">{body}</div></div>')


def render_change(ch):
    cid = html.escape(ch.get("id", "c"))
    file = html.escape(ch.get("file", ""))
    title = inline(ch.get("title", ""))
    kind = ch.get("kind", "")
    kind_html = f'<span class="kind">{html.escape(kind)}</span>' if kind else ""

    comments = sorted(ch.get("comments", []),
                      key=lambda c: sev(c.get("severity"))["order"])
    # per-severity counts for the header
    counts = {}
    for c in comments:
        s = sev(c.get("severity"))
        counts[s["cls"]] = counts.get(s["cls"], 0) + 1
    count_badges = "".join(
        f'<span class="badge {cls} mini">{n}</span>'
        for cls, n in sorted(counts.items(), key=lambda kv: kv[0])
    ) or '<span class="badge sev-praise mini">clean</span>'

    diff_html = render_diff(cid, ch.get("diff", ""))
    ctx_html = "".join(render_context(b) for b in ch.get("context", []))
    if ctx_html:
        ctx_html = f'<div class="ctx-wrap"><div class="ctx-head">Related code</div>{ctx_html}</div>'

    if comments:
        comments_html = "".join(render_comment(cid, c) for c in comments)
    else:
        comments_html = '<div class="no-comments">No issues found.</div>'

    return f"""
<section class="change" id="{cid}">
  <header class="change-head">
    <div class="ch-file">{file}{kind_html}</div>
    <div class="ch-title">{title}</div>
    <div class="ch-counts">{count_badges}</div>
  </header>
  <div class="change-body">
    <div class="col-left">
      {diff_html}
      {ctx_html}
    </div>
    <div class="col-right">
      {comments_html}
    </div>
  </div>
</section>"""


def render_summary(data):
    s = data.get("summary", {}) or {}
    stats = []
    if s.get("files_changed") is not None:
        stats.append(f'<b>{s["files_changed"]}</b> files')
    if s.get("additions") is not None:
        stats.append(f'<span class="add-t">+{s["additions"]}</span>')
    if s.get("deletions") is not None:
        stats.append(f'<span class="del-t">-{s["deletions"]}</span>')
    stat_html = " · ".join(stats)
    routine = s.get("routine", []) or []
    if routine:
        items = "".join(f"<li>{inline(r)}</li>" for r in routine)
        routine_html = (
            f'<details class="routine" open><summary>Routine / skipped changes '
            f'({len(routine)})</summary><ul>{items}</ul></details>'
        )
    else:
        routine_html = ""
    return f'<div class="summary"><div class="stats">{stat_html}</div>{routine_html}</div>'


def render(data):
    title = html.escape(data.get("title", "Code Review Walkthrough"))
    scope = inline(data.get("scope", ""))
    generated = data.get("generated_at") or datetime.now().strftime("%Y-%m-%d %H:%M")
    changes_html = "".join(render_change(c) for c in data.get("changes", []))
    return TEMPLATE.format(
        title=title,
        scope=scope,
        generated=html.escape(generated),
        summary=render_summary(data),
        changes=changes_html,
    )


# ---- template (single file, degrades gracefully offline) --------------------

TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet"
 href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css"
 onerror="this.remove()">
<style>
:root{{
  --bg:#fbfbfa; --panel:#fff; --ink:#1a1a1a; --mut:#6b7280; --line:#e5e7eb;
  --add-bg:#e6ffec; --add-gut:#cdfacd; --del-bg:#ffebe9; --del-gut:#ffc9c9;
  --hunk:#f1f5ff; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}}
@media (prefers-color-scheme:dark){{
  :root{{--bg:#0f1115;--panel:#161a20;--ink:#e6e6e6;--mut:#9aa4b2;--line:#2a2f37;
    --add-bg:#0f2f1c;--add-gut:#1f5133;--del-bg:#3a1a1c;--del-gut:#5a2427;--hunk:#1a2233;}}
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}}
header.top{{position:sticky;top:0;z-index:5;background:var(--panel);
  border-bottom:1px solid var(--line);padding:14px 22px;}}
header.top h1{{margin:0;font-size:19px}}
.scope{{color:var(--mut);font-size:13px;margin-top:3px}}
.legend{{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}}
.wrap{{max-width:1400px;margin:0 auto;padding:18px 22px 80px}}
.summary{{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:12px 16px;margin-bottom:18px}}
.stats{{font-size:14px;color:var(--mut)}}
.add-t{{color:#1a7f37;font-weight:600}} .del-t{{color:#cf222e;font-weight:600}}
.routine{{margin-top:8px}} .routine summary{{cursor:pointer;font-weight:600}}
.routine ul{{margin:8px 0 0;padding-left:20px;color:var(--mut)}}
.routine li{{margin:3px 0}}
.change{{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  margin-bottom:18px;overflow:hidden}}
.change-head{{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
  padding:11px 16px;border-bottom:1px solid var(--line);background:var(--panel)}}
.ch-file{{font-family:var(--mono);font-size:13px;color:var(--mut)}}
.kind{{margin-left:8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;
  background:var(--hunk);padding:1px 7px;border-radius:20px;color:var(--mut)}}
.ch-title{{font-weight:600;flex:1}} .ch-counts{{display:flex;gap:4px}}
.change-body{{display:grid;grid-template-columns:1fr 1fr;gap:0}}
.col-left{{border-right:1px solid var(--line);min-width:0;overflow-x:auto}}
.col-right{{padding:12px 14px;min-width:0}}
@media(max-width:900px){{.change-body{{grid-template-columns:1fr}}
  .col-left{{border-right:0;border-bottom:1px solid var(--line)}}}}
table.diff{{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12.5px}}
table.diff td{{padding:0 8px;white-space:pre;vertical-align:top}}
td.gut{{width:1%;text-align:right;color:var(--mut);user-select:none;
  border-right:1px solid var(--line);opacity:.7}}
tr.d-add{{background:var(--add-bg)}} tr.d-add .gut{{background:var(--add-gut)}}
tr.d-del{{background:var(--del-bg)}} tr.d-del .gut{{background:var(--del-gut)}}
tr.d-hunk .code{{background:var(--hunk);color:var(--mut)}}
tr.d-meta{{display:none}}
tr.flash{{animation:flash 1.4s ease-out}}
@keyframes flash{{0%{{background:#fff3bf}}100%{{background:transparent}}}}
.ctx-wrap{{border-top:1px dashed var(--line);padding:8px 10px;background:var(--bg)}}
.ctx-head{{font-size:11px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--mut);margin-bottom:6px}}
details.ctx{{margin:6px 0}} details.ctx summary{{cursor:pointer;font-size:13px}}
.ctx-label{{font-weight:600}} .ctx-path{{color:var(--mut);margin-left:8px;font-size:12px;
  font-family:var(--mono)}}
details.ctx pre{{margin:6px 0 0;background:var(--panel);border:1px solid var(--line);
  border-radius:6px;padding:8px;overflow-x:auto;font-size:12.5px}}
.comment{{border-left:3px solid var(--line);padding:7px 10px;margin-bottom:9px;
  border-radius:0 6px 6px 0;background:var(--bg)}}
.c-head{{display:flex;align-items:center;gap:8px}}
.c-title{{font-weight:600;margin-top:3px}} .c-body{{margin-top:3px;font-size:14px}}
.no-comments{{color:var(--mut);font-style:italic;padding:6px 2px}}
.badge{{font-size:11px;font-weight:700;padding:1px 8px;border-radius:20px;color:#fff}}
.badge.mini{{padding:0 6px}}
.sev-blocker{{background:#8b0000}} .sev-high{{background:#cf222e}}
.sev-medium{{background:#d97706}} .sev-low{{background:#6b7280}}
.sev-nit{{background:#8b8b8b}} .sev-question{{background:#2563eb}}
.sev-praise{{background:#1a7f37}}
.sev-blocker-b{{border-left-color:#8b0000}} .sev-high-b{{border-left-color:#cf222e}}
.sev-medium-b{{border-left-color:#d97706}} .sev-question-b{{border-left-color:#2563eb}}
.sev-praise-b{{border-left-color:#1a7f37}}
.jump{{font-family:var(--mono);font-size:11px;border:1px solid var(--line);
  background:var(--panel);color:var(--mut);border-radius:5px;padding:0 6px;cursor:pointer}}
.jump:hover{{color:var(--ink)}}
.sym{{font-family:var(--mono);font-size:12px;color:var(--mut)}}
code{{font-family:var(--mono);font-size:.92em;background:var(--hunk);
  padding:1px 4px;border-radius:4px}}
.c-body code,.ctx code{{background:none;padding:0}}
</style></head>
<body>
<header class="top">
  <h1>{title}</h1>
  <div class="scope">{scope} &nbsp;·&nbsp; generated {generated}</div>
  <div class="legend">
    <span class="badge sev-blocker">Blocker</span>
    <span class="badge sev-high">High</span>
    <span class="badge sev-medium">Medium</span>
    <span class="badge sev-low">Low</span>
    <span class="badge sev-nit">Nit</span>
    <span class="badge sev-question">Question</span>
    <span class="badge sev-praise">Praise</span>
  </div>
</header>
<div class="wrap">
  {summary}
  {changes}
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"
 onerror="window.__nohl=1"></script>
<script>
  if(!window.__nohl && window.hljs){{
    document.querySelectorAll('.ctx pre code').forEach(function(b){{
      try{{hljs.highlightElement(b);}}catch(e){{}}
    }});
  }}
  document.querySelectorAll('.jump').forEach(function(btn){{
    btn.addEventListener('click',function(){{
      var el=document.getElementById(btn.dataset.target);
      if(!el)return;
      el.scrollIntoView({{behavior:'smooth',block:'center'}});
      el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
    }});
  }});
</script>
</body></html>"""


def main():
    ap = argparse.ArgumentParser(description="Render a code-review walkthrough JSON to HTML.")
    ap.add_argument("input", nargs="?", help="Path to review JSON (or stdin).")
    ap.add_argument("-o", "--output", default="walkthrough.html", help="Output HTML path.")
    args = ap.parse_args()

    raw = open(args.input, encoding="utf-8").read() if args.input else sys.stdin.read()
    data = json.loads(raw)
    out = render(data)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(out)
    n = len(data.get("changes", []))
    print(f"Wrote {args.output}  ({n} change block{'s' if n != 1 else ''})")


if __name__ == "__main__":
    main()
