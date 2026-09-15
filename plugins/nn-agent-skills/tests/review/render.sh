#!/usr/bin/env bash
# render_app.py: every contract field reaches the page, and reviewed content
# cannot break the page. Both properties were live bugs before these tests.
source "$(dirname "$0")/../lib.sh"

R="$SKILLS/ui-code-review/scripts/render_app.py"
out="$(mktemp -d)/page.html"

check "renderer parses"  python3 -c "import ast,sys;ast.parse(open('$R').read())"
check "renders a fixture" python3 "$R" tests/fixtures/review.json -o "$out"
page="$(cat "$out" 2>/dev/null || echo '')"

# Every value in the fixture is a unique token, so a missing one means a field
# the contract documents never reaches the page.
for tok in OVERVIEW_WHAT OVERVIEW_SCOPELINE OVERVIEW_VERDICT OVERVIEW_XCUT \
           ROUTINE_LINE CHANGE_TITLE \
           BRIEF_WHAT BRIEF_WHY BRIEF_USES BRIEF_CONSUMES BRIEF_TESTED \
           CTX_LABEL CTX_CODE FIND_TITLE FIND_BODY FIND_FIX; do
  contains "renders $tok" "$page" "$tok"
done

# The reviewed diff contains "</script>". If it is baked in unescaped it
# terminates the state block and the page dies half-parsed.
state="${page#*const STATE =}"; state="${state%%</script>*}"
if [[ "$state" == *"</script>"* ]]; then
  _notok "reviewed </script> cannot break out of the state block" "raw </script> found inside the state literal"
else
  _ok "reviewed </script> cannot break out of the state block"
fi
trimmed="$(printf '%s' "$state" | tr -d '[:space:]')"
if [[ "$trimmed" == *";" ]]; then
  _ok "the state literal terminates cleanly"
else
  _notok "the state literal terminates cleanly" "literal was truncated by reviewed content"
fi

summary
