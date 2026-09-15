#!/usr/bin/env bash
# setup-evolve.sh: preconditions it must refuse, and the state it must write.
source "$(dirname "$0")/../lib.sh"

S="$SCRIPTS/setup-evolve.sh"

# --- refuses what it documents as invalid -----------------------------------
repo="$(mk_repo)"; cd "$repo"

check_fail "refuses a target with no --fitness"      1 bash "$S" "the f() function"
check_fail "refuses --fitness with no value"         1 bash "$S" "f" --fitness
check_fail "refuses a non-numeric --iterations"      1 bash "$S" "f" --fitness "x" --iterations abc
check_fail "refuses a non-numeric --population"      1 bash "$S" "f" --fitness "x" --population abc
check_fail "refuses a branch that does not exist"    1 bash "$S" "f" --fitness "x" --branch nope

printf 'dirty\n' >> code.py
check_fail "refuses a dirty working tree"            1 bash "$S" "f" --fitness "x"
git checkout -q -- code.py

cd /; rm -rf "$repo"

# --- outside a git repo ------------------------------------------------------
bare="$(mktemp -d)"; cd "$bare"
check_fail "refuses a directory that is not a git repo" 1 bash "$S" "f" --fitness "x"
cd /; rm -rf "$bare"

# --- the state it writes -----------------------------------------------------
repo="$(mk_repo)"; cd "$repo"
bash "$S" "the f() function" --fitness "maximise speed" --iterations 4 --population 3 >/dev/null 2>&1

check "writes .evolve/state.json"            test -f .evolve/state.json
check "state.json is valid JSON"             jq -e . .evolve/state.json
expect "records the target"       "$(jq -r '.target'          .evolve/state.json)" "the f() function"
expect "records the fitness"      "$(jq -r '.fitness_prompt'  .evolve/state.json)" "maximise speed"
expect "records max_iterations"   "$(jq -r '.max_iterations'  .evolve/state.json)" "4"
expect "records population_size"  "$(jq -r '.population_size' .evolve/state.json)" "3"
expect "starts active"            "$(jq -r '.active'          .evolve/state.json)" "true"
expect "seeds an original cell"   "$(jq -r '.archive.original.id' .evolve/state.json)" "original"
expect "best_id starts at original" "$(jq -r '.best_id'       .evolve/state.json)" "original"
expect "history starts empty"     "$(jq  '.history | length'  .evolve/state.json)" "0"
check "seeds iteration 1 context" test -f .evolve/current-iteration.json
expect "iteration advanced to 1"  "$(jq -r '.iteration'       .evolve/state.json)" "1"

# --- refuses to clobber a run in progress ------------------------------------
check_fail "refuses a second run while one is active" 1 bash "$S" "g" --fitness "y"

summary
