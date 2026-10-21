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
# the contract documents never reaches the screen. The page embeds the whole
# fixture as its STATE literal, so the HTML always contains every token; check
# the text the browser actually draws instead.
tokens=(OVERVIEW_WHAT OVERVIEW_SCOPELINE OVERVIEW_VERDICT OVERVIEW_XCUT LENSES_RUN
        ROUTINE_LINE CHANGE_TITLE
        BRIEF_WHAT BRIEF_WHY BRIEF_USES BRIEF_CONSUMES BRIEF_TESTED
        CTX_LABEL CTX_CODE FIND_TITLE FIND_BODY FIND_FIX)
shown="$(NODE_PATH="${NODE_PATH:-}${NODE_PATH:+:}$(npm root -g 2>/dev/null)" \
         node "$(dirname "$0")/visible_text.js" "$out" 2>&1)"; rc=$?
if ! command -v node >/dev/null 2>&1 || [[ "$rc" == 77 ]]; then
  skip "renders every contract field" "needs node + playwright + a browser"
elif [[ "$rc" != 0 ]]; then
  _notok "page loads in a browser" "${shown:0:300}"
else
  absent "page runs without script errors" "$shown" "PAGE_ERROR"
  for tok in "${tokens[@]}"; do
    contains "renders $tok" "$shown" "$tok"
  done
fi

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
