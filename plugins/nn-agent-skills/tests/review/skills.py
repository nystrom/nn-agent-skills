"""Structural checks on the skills themselves.

These .md files are executable instructions, so a dangling reference or a
frontmatter name that disagrees with its directory is a runtime defect.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SKILLS = ROOT / "skills"
fails, passes = [], []
def check(desc, ok, detail=""):
    (passes if ok else fails).append((desc, detail))

skills = sorted(SKILLS.glob("*/SKILL.md"))
check("the plugin ships skills", len(skills) > 0)

names = set()
for sk in skills:
    rel = sk.parent.name
    t = sk.read_text()
    m = re.match(r"^---\n(.*?)\n---\n", t, re.S)
    check(f"{rel}: has frontmatter", m is not None)
    if not m:
        continue
    fm = m.group(1)
    nm = re.search(r"^name:\s*(\S+)", fm, re.M)
    check(f"{rel}: declares a name", nm is not None)
    if nm:
        check(f"{rel}: name matches its directory", nm.group(1) == rel,
              f"frontmatter says {nm.group(1)!r}")
        names.add(nm.group(1))
    check(f"{rel}: declares a description",
          re.search(r"^description:", fm, re.M) is not None)
    check(f"{rel}: ends with exactly one newline",
          t.endswith("\n") and not t.endswith("\n\n"))

# Every `references/x.md` a skill mentions must exist in that skill.
for sk in SKILLS.iterdir():
    if not sk.is_dir():
        continue
    for f in sk.rglob("*.md"):
        for ref in sorted(set(re.findall(r"`references/([a-z0-9-]+\.md)`", f.read_text()))):
            check(f"{sk.name}/{f.name} -> references/{ref} exists",
                  (sk / "references" / ref).exists())

# Files this repo deleted must not be referenced anywhere.
for gone in ["render_review.py", "review-schema.md"]:
    hits = [str(p.relative_to(ROOT)) for p in SKILLS.rglob("*")
            if p.is_file() and gone in p.read_text(errors="ignore")]
    check(f"nothing references the deleted {gone}", not hits, ", ".join(hits))

# The three review skills form a producer/consumer trio; each consumer must
# name the producer, or the split silently stops working.
for consumer in ["interactive-code-review", "ui-code-review"]:
    p = SKILLS / consumer / "SKILL.md"
    if p.exists():
        body = p.read_text()
        check(f"{consumer} invokes run-review-lenses", "run-review-lenses" in body)
        check(f"{consumer} passes caller", "caller" in body,
              "a consumer must set `caller` so the producer knows where to stop")

for d, _ in passes: print(f"  ok   {d}")
for d, detail in fails:
    print(f"  FAIL {d}")
    if detail: print(f"       {detail}")
print(f"\n  {len(passes)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
