#!/usr/bin/env bash
# apply-best.sh and teardown-evolve.sh.
source "$(dirname "$0")/../lib.sh"

repo="$(mk_repo)"; cd "$repo"

check_fail "apply-best refuses a missing state file" 1 bash "$SCRIPTS/apply-best.sh" .evolve/nope.json

bash "$SCRIPTS/setup-evolve.sh" "f" --fitness "x" >/dev/null 2>&1

out="$(bash "$SCRIPTS/apply-best.sh" .evolve/state.json 2>&1)"
contains "apply-best prints the history header" "$out" "Evolution history"
contains "apply-best says when nothing ran"     "$out" "no iterations completed"

# a run with history renders a row per iteration
tmp=$(mktemp)
jq '.history = [{iter:1, outcome:"new_best", description:"faster inner loop",
                 metrics:{fitness:42}, feature_coords:{complexity:2, approach:"vectorised"}}]' \
   .evolve/state.json > "$tmp" && mv "$tmp" .evolve/state.json
out="$(bash "$SCRIPTS/apply-best.sh" .evolve/state.json 2>&1)"
contains "history row shows the fitness"     "$out" "42"
contains "history row shows the description" "$out" "faster inner loop"
contains "new_best is marked"                "$out" "★"

# .gitignore gained the state dir, so a run leaves the tree clean
contains ".evolve is gitignored" "$(cat .gitignore 2>/dev/null || echo '')" ".evolve"

bash "$SCRIPTS/teardown-evolve.sh" >/dev/null 2>&1
check "teardown removes .evolve" test ! -d .evolve
out="$(bash "$SCRIPTS/teardown-evolve.sh" 2>&1)"
contains "teardown is safe to repeat" "$out" "Nothing to clean up"

cd /; rm -rf "$repo"
summary
