#!/usr/bin/env bash
# AlphaEvolve setup: validate environment, parse args, write initial state,
# seed the first iteration context.

set -euo pipefail

# ── Dependency check ──────────────────────────────────────────────────────────
if ! command -v jq > /dev/null 2>&1; then
  echo "❌ AlphaEvolve requires jq (https://jqlang.github.io/jq/)." >&2
  echo "   Install: brew install jq  /  apt install jq  /  etc." >&2
  exit 1
fi

# ── Defaults ──────────────────────────────────────────────────────────────────
TARGET=""
FITNESS=""
BRANCH=""
MAX_ITERATIONS=10
POPULATION_SIZE=6

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --fitness)
      [[ -z "${2:-}" ]] && { echo "❌ --fitness requires a value" >&2; exit 1; }
      FITNESS="$2"; shift 2 ;;
    --branch)
      [[ -z "${2:-}" ]] && { echo "❌ --branch requires a value" >&2; exit 1; }
      BRANCH="$2"; shift 2 ;;
    --iterations)
      [[ -z "${2:-}" ]] && { echo "❌ --iterations requires a number" >&2; exit 1; }
      [[ ! "$2" =~ ^[0-9]+$ ]] && { echo "❌ --iterations must be a positive integer" >&2; exit 1; }
      MAX_ITERATIONS="$2"; shift 2 ;;
    --population)
      [[ -z "${2:-}" ]] && { echo "❌ --population requires a number" >&2; exit 1; }
      [[ ! "$2" =~ ^[0-9]+$ ]] && { echo "❌ --population must be a positive integer" >&2; exit 1; }
      POPULATION_SIZE="$2"; shift 2 ;;
    -h|--help)
      cat <<'HELP'
Usage: /evolve TARGET_PROMPT --fitness FITNESS_PROMPT [options]

  TARGET_PROMPT     What to evolve (e.g. "the sort() function in src/sort.ts")

Options:
  --fitness TEXT    How to measure success (e.g. "run make bench and report ops/sec")
  --branch NAME     Base branch for worktrees (default: current branch)
  --iterations N    Evolution iterations (default: 10)
  --population N    Max archive cells (default: 6)

Examples:
  /evolve "the foo() function" --fitness "run make bench, maximize ops/sec"
  /evolve "the query builder" --fitness "go test -bench=. minimize ns/op" --iterations 20
HELP
      exit 0 ;;
    *)
      TARGET="${TARGET:+$TARGET }$1"; shift ;;
  esac
done

# ── Validations ───────────────────────────────────────────────────────────────
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "❌ Not a git repository. AlphaEvolve requires git." >&2
  echo "   Run: git init && git add -A && git commit -m 'initial'" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain -- ':!*.pyc' ':!__pycache__')" ]]; then
  echo "❌ Working tree has uncommitted changes." >&2
  echo "   Commit or stash them before running /evolve:" >&2
  git status --short -- ':!*.pyc' ':!__pycache__' >&2
  exit 1
fi

[[ -z "$TARGET" ]] && { echo "❌ No target specified. Usage: /evolve \"the foo() function\" --fitness \"...\"" >&2; exit 1; }
[[ -z "$FITNESS" ]] && { echo "❌ --fitness is required." >&2; exit 1; }

if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
fi

git rev-parse --verify "$BRANCH" > /dev/null 2>&1 || { echo "❌ Branch '$BRANCH' does not exist." >&2; exit 1; }

if [[ -f ".evolve/state.json" ]]; then
  echo "❌ An evolve run is already in progress. Use /evolve-stop first." >&2
  exit 1
fi

# ── Create state ──────────────────────────────────────────────────────────────
mkdir -p .evolve

SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -n \
  --arg session   "$SESSION_ID" \
  --arg started   "$STARTED_AT" \
  --arg target    "$TARGET" \
  --arg fitness   "$FITNESS" \
  --arg branch    "$BRANCH" \
  --argjson maxiter "$MAX_ITERATIONS" \
  --argjson popsize "$POPULATION_SIZE" \
  '{
    active:          true,
    session_id:      $session,
    started_at:      $started,
    iteration:       0,
    max_iterations:  $maxiter,
    population_size: $popsize,
    target:          $target,
    fitness_prompt:  $fitness,
    branch:          $branch,
    archive: {
      original: {
        id:           "original",
        description:  "Original code (baseline — not yet evaluated)",
        final_code:   {},
        metrics:      {},
        feature_coords: null,
        generation:   0,
        parent_id:    null
      }
    },
    best_id: "original",
    history: []
  }' > .evolve/state.json

# ── .gitignore ────────────────────────────────────────────────────────────────
if [[ -f ".gitignore" ]] && ! grep -q "^\.evolve" .gitignore 2>/dev/null; then
  echo ".evolve/" >> .gitignore
fi

# ── Seed iteration 1 ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/next-iteration.sh" .evolve/state.json

cat <<EOF

AlphaEvolve initialized.

  Target:     $TARGET
  Fitness:    $FITNESS
  Branch:     $BRANCH
  Iterations: $MAX_ITERATIONS

Iteration 1 context written to .evolve/current-iteration.json.
Continue with the iteration loop. Claude Code's stop hook will advance it
automatically; other agents should call next-iteration.sh after each result.
EOF
