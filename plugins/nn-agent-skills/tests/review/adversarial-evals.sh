#!/usr/bin/env bash
# The adversarial-review eval set is data a scorer depends on: a malformed case
# or a scorer that miscounts would make every eval run report wrong numbers.
source "$(dirname "$0")/../lib.sh"

E="$SKILLS/adversarial-review/evals"
check "cases.json parses" python3 -c "import json;json.load(open('$E/cases.json'))"

shape="$(python3 - "$E/cases.json" <<'EOF'
import json, sys
c = json.load(open(sys.argv[1]))["cases"]
ids = [x["id"] for x in c]
dids = [d["id"] for x in c for d in x["defects"]]
bad = [x["id"] for x in c
       if x["kind"] not in ("defect", "control")
       or (x["kind"] == "defect") != bool(x["defects"])
       or not x["url"].endswith(f"/pull/{x['pr']}")]
print("ok" if len(ids) == len(set(ids)) and len(dids) == len(set(dids)) and not bad
      else f"bad: {bad}")
EOF
)"
expect "cases have unique ids, a valid kind, defects iff defect, matching urls" "$shape" "ok"

# Scorer arithmetic on a pinned toy set: one defect case with two defects, one
# control. An approve on the defect case is harmful; a block on the control is
# a wrong verdict but not harmful.
tmp="$(mktemp -d)"
cat > "$tmp/cases.json" <<'EOF'
{"cases": [
 {"id": "d", "url": "u/pull/1", "pr": 1, "head": "h", "base": "b", "kind": "defect",
  "defects": [{"id": "d1"}, {"id": "d2"}]},
 {"id": "c", "url": "u/pull/2", "pr": 2, "head": "h", "base": "b", "kind": "control",
  "defects": []},
 {"id": "u", "url": "u/pull/3", "pr": 3, "head": null, "base": null, "kind": "defect",
  "defects": [{"id": "u1"}]}
]}
EOF
cat > "$tmp/results.json" <<'EOF'
{"reviews": [
 {"case": "d", "verdict": "needs-attention", "caught": ["d1"]},
 {"case": "d", "verdict": "approve", "caught": []},
 {"case": "c", "verdict": "needs-attention", "caught": []},
 {"case": "u", "verdict": "approve", "caught": []}
]}
EOF
out="$(python3 "$E/score.py" "$tmp/cases.json" "$tmp/results.json")"
contains "counts only pinned cases"            "$out" "reviews graded:   3"
contains "approve on a defect case is harmful" "$out" "harmful approval: 1/3"
contains "credits caught defects only"         "$out" "defects caught:   1/4"
contains "a blocked control is a wrong verdict" "$out" "verdict correct:  1/3"
contains "reports unpinned cases"              "$out" "skipped (unpinned head/base): u"

echo '{"reviews": [{"case": "nope", "verdict": "approve"}]}' > "$tmp/bad.json"
check_fail "an unknown case id fails the run" 1 python3 "$E/score.py" "$tmp/cases.json" "$tmp/bad.json"

summary
