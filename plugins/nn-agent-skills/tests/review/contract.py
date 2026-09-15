"""The contract and the renderer must agree on field names.

review-json.md is the producer's contract; render_app.py is the only consumer
that turns it into something a person sees. A name documented in one and not
read by the other renders as a silent blank, which is how `consumes`/`tested`
once shipped broken.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "skills/run-review-lenses/references/review-json.md"
RENDERER = ROOT / "skills/ui-code-review/scripts/render_app.py"

fails, passes = [], []
def check(desc, ok, detail=""):
    (passes if ok else fails).append((desc, detail))

doc = CONTRACT.read_text()
js = RENDERER.read_text()

# Field names the contract documents, taken from its own jsonc example.
documented = set(re.findall(r'^\s*"([a-z_]+)"\s*:', doc, re.M))

# The briefing beats are the ones with a history of drifting; assert them by name.
brief_doc = set(re.findall(r'"([a-z_]+)":\s*"[A-Z]', doc))
for beat in ["what", "why", "uses", "consumes", "tested"]:
    check(f"contract documents briefing.{beat}",
          re.search(rf'"{beat}"\s*:', doc) is not None)
    check(f"renderer reads briefing.{beat}",
          re.search(rf'\bb\.{beat}\b', js) is not None,
          f"render_app.py never reads b.{beat}")

for key in ["what", "scope_line", "verdict"]:
    check(f"renderer reads overview.{key}", re.search(rf'\bo\.{key}\b', js) is not None)

for key in ["body", "severity", "line", "source"]:
    check(f"renderer reads a finding's {key}",
          re.search(rf'\b[fc]\.{key}\b', js) is not None)

# Nothing the contract documents should be invisible to the renderer.
INTERNAL = {"id", "file", "title", "kind", "diff", "base", "scope", "generated_at",
            "collapsed", "path", "code", "label", "symbol", "suggested_fix",
            "files_changed", "additions", "deletions", "routine", "structural",
            "overview", "summary", "changes", "briefing", "context", "comments",
            "lang"}
for name in sorted(documented - INTERNAL):
    check(f"renderer reads the documented field '{name}'",
          re.search(rf'\.{name}\b', js) is not None,
          f"'{name}' is in the contract but render_app.py never reads it")

# The line-number gutter must out-specify the generic cell rule, or its
# white-space:nowrap loses and two-digit numbers wrap mid-number.
def spec(sel):
    return (len(re.findall(r'\.[\w-]+', sel)), len(re.findall(r'(?:^|[\s>])([a-z]+)', sel)))
generic = re.search(r'^(table\.diff td)\{', js, re.M)
gutter  = re.search(r'^([^\n{]*td\.gut)\{', js, re.M)
check("a gutter rule exists", gutter is not None)
if generic and gutter:
    check("the gutter rule out-specifies the generic cell rule",
          spec(gutter.group(1)) > spec(generic.group(1)),
          f"{gutter.group(1)} {spec(gutter.group(1))} does not beat "
          f"{generic.group(1)} {spec(generic.group(1))}")
    grule = js[gutter.start():js.index("}", gutter.start())]
    check("the gutter does not break inside a number",
          "word-break:keep-all" in grule or "word-break:normal" in grule,
          "generic td sets word-break:break-word, which splits '10' across lines")

for d, _ in passes: print(f"  ok   {d}")
for d, detail in fails:
    print(f"  FAIL {d}")
    if detail: print(f"       {detail}")
print(f"\n  {len(passes)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
