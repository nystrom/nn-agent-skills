#!/usr/bin/env bash
# next-iteration.sh: advancing the counter, and stopping at the limit.
source "$(dirname "$0")/../lib.sh"

N="$SCRIPTS/next-iteration.sh"
repo="$(mk_repo)"; cd "$repo"

check_fail "refuses a missing state file" 1 bash "$N" .evolve/nope.json

bash "$SCRIPTS/setup-evolve.sh" "f" --fitness "x" --iterations 3 >/dev/null 2>&1
expect "setup left iteration at 1" "$(jq -r '.iteration' .evolve/state.json)" "1"

bash "$N" .evolve/state.json >/dev/null 2>&1
expect "advances to 2" "$(jq -r '.iteration' .evolve/state.json)" "2"
bash "$N" .evolve/state.json >/dev/null 2>&1
expect "advances to 3" "$(jq -r '.iteration' .evolve/state.json)" "3"

check_fail "exits 1 once max_iterations is reached" 1 bash "$N" .evolve/state.json
expect "does not advance past the limit" "$(jq -r '.iteration' .evolve/state.json)" "3"

check "writes current-iteration.json"     test -f .evolve/current-iteration.json
check "current-iteration.json is valid"   jq -e . .evolve/current-iteration.json
expect "context carries the target"   "$(jq -r '.target'         .evolve/current-iteration.json)" "f"
expect "context carries the fitness"  "$(jq -r '.fitness_prompt' .evolve/current-iteration.json)" "x"
check "context names a primary parent" jq -e '.primary_parent.id' .evolve/current-iteration.json

cd /; rm -rf "$repo"
summary
