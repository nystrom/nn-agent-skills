#!/usr/bin/env bash
# Run every test file under tests/. Usage: run-tests.sh [name-filter]
set -uo pipefail
cd "$(dirname "$0")/.."

filter="${1:-}"
total_fail=0

for f in tests/evolve/*.sh tests/review/*.sh; do
  [[ -e "$f" ]] || continue
  [[ -n "$filter" && "$f" != *"$filter"* ]] && continue
  printf '\n%s\n' "${f#tests/}"
  bash "$f" || total_fail=$((total_fail+1))
done

printf '\n'
if [[ "$total_fail" -eq 0 ]]; then
  printf 'all suites passed\n'; exit 0
else
  printf '%d suite(s) failed\n' "$total_fail"; exit 1
fi
