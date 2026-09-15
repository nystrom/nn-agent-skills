# Shared assertions and fixtures for the test suite.
# Every test file sources this, then calls `check` / `check_fail` / `expect`.

set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$PLUGIN_ROOT/scripts"
SKILLS="$PLUGIN_ROOT/skills"
PASS=0; FAIL=0; CURRENT=""

case=  # name of the test being run, set by `it`
it() { CURRENT="$1"; }

_ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
_notok(){ FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; [[ -n "${2:-}" ]] && printf '       %s\n' "$2"; }

# expect <description> <actual> <expected>
expect() {
  if [[ "$2" == "$3" ]]; then _ok "$1"; else _notok "$1" "expected '$3', got '$2'"; fi
}

# contains <description> <haystack> <needle>
contains() {
  if [[ "$2" == *"$3"* ]]; then _ok "$1"; else _notok "$1" "missing substring: $3"; fi
}

# absent <description> <haystack> <needle>
absent() {
  if [[ "$2" != *"$3"* ]]; then _ok "$1"; else _notok "$1" "unexpected substring: $3"; fi
}

# check <description> <command...>   -- passes when the command exits 0
check() {
  local d="$1"; shift
  if "$@" >/dev/null 2>&1; then _ok "$d"; else _notok "$d" "command failed: $*"; fi
}

# check_fail <description> <expected-exit> <command...>
check_fail() {
  local d="$1" want="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [[ "$rc" == "$want" ]]; then _ok "$d"; else _notok "$d" "expected exit $want, got $rc: ${out:0:120}"; fi
}

# A throwaway git repo with one commit. Echoes its path.
mk_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" config user.email t@example.com
  git -C "$d" config user.name Test
  printf 'def f():\n    return 1\n' > "$d/code.py"
  git -C "$d" add -A
  git -C "$d" -c commit.gpgsign=false commit -qm initial
  echo "$d"
}

summary() {
  printf '\n  %d passed, %d failed\n' "$PASS" "$FAIL"
  [[ "$FAIL" -eq 0 ]]
}
