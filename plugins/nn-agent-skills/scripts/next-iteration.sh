#!/usr/bin/env bash
# Advance the evolution state by one iteration.
# Selects parents, determines mode, builds stratified history,
# writes .evolve/current-iteration.json.
#
# Exit 0 — iteration prepared, run it.
# Exit 1 — evolution complete, nothing to do.

set -euo pipefail

STATE_FILE="${1:-.evolve/state.json}"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "❌ No state file at $STATE_FILE" >&2
  exit 1
fi

# ── Check completion ──────────────────────────────────────────────────────────
ITERATION=$(jq -r '.iteration' "$STATE_FILE")
MAX_ITERATIONS=$(jq -r '.max_iterations' "$STATE_FILE")

if [[ "$ITERATION" -ge "$MAX_ITERATIONS" ]]; then
  exit 1   # done
fi

# ── Advance iteration counter ─────────────────────────────────────────────────
NEW_ITER=$(( ITERATION + 1 ))
tmp=$(mktemp)
jq --argjson i "$NEW_ITER" '.iteration = $i' "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"

# ── Collect evaluated programs from archive ───────────────────────────────────
# (programs that have a numeric fitness score)
EVALUATED=$(jq '[.archive | to_entries[]
  | select(.value.metrics.fitness != null)
  | {id: .key, fitness: .value.metrics.fitness,
     description: .value.description,
     feature_coords: .value.feature_coords,
     metrics: .value.metrics,
     final_code: .value.final_code}]
  | sort_by(.fitness)' "$STATE_FILE")

EVAL_COUNT=$(echo "$EVALUATED" | jq 'length')

# ── Select primary parent ─────────────────────────────────────────────────────
ROLL=$(( RANDOM % 10 ))   # 0–9; <7 = elite (70%), >=7 = random (30%)

if [[ "$EVAL_COUNT" -eq 0 ]]; then
  # No evaluated programs yet — use original
  PRIMARY_ID="original"
  PRIMARY=$(jq '.archive.original' "$STATE_FILE")
elif [[ "$ROLL" -lt 7 ]]; then
  # Elite: highest fitness
  PRIMARY=$(echo "$EVALUATED" | jq 'last')
  PRIMARY_ID=$(echo "$PRIMARY" | jq -r '.id')
else
  # Random archive member
  IDX=$(( RANDOM % EVAL_COUNT ))
  PRIMARY=$(echo "$EVALUATED" | jq --argjson i "$IDX" '.[$i]')
  PRIMARY_ID=$(echo "$PRIMARY" | jq -r '.id')
fi

# ── Determine mode ────────────────────────────────────────────────────────────
MODE="mutate"
SECOND_PARENT="null"
SECOND_ID="null"

if [[ $(( NEW_ITER % 4 )) -eq 0 ]] && [[ "$EVAL_COUNT" -ge 2 ]]; then
  # Crossover: pick archive member from a different approach cell
  PRIMARY_APPROACH=$(echo "$PRIMARY" | jq -r '.feature_coords.approach // "unknown"')
  SECOND=$(echo "$EVALUATED" | jq \
    --arg pa "$PRIMARY_APPROACH" \
    --arg pid "$PRIMARY_ID" \
    '[.[] | select(.id != $pid and (.feature_coords.approach // "unknown") != $pa)]
     | if length > 0 then sort_by(.fitness) | last
       else null end')

  if [[ "$SECOND" != "null" ]]; then
    MODE="crossover"
    SECOND_PARENT="$SECOND"
    SECOND_ID=$(echo "$SECOND" | jq -r '.id')
  fi
fi

# ── Determine search mode ─────────────────────────────────────────────────────
SEARCH_MODE="false"
if [[ $(( NEW_ITER % 3 )) -eq 0 ]]; then
  SEARCH_MODE="true"
fi

# ── Build stratified history ──────────────────────────────────────────────────
# All failures (never truncated) + last 10 rejected + last 5 for recency
HISTORY_FAILURES=$(jq '[.history[] | select(.outcome == "compile_failed" or .outcome == "test_failed")]' "$STATE_FILE")
HISTORY_REJECTED=$(jq '[.history[] | select(.outcome == "rejected")] | last(10)' "$STATE_FILE" 2>/dev/null \
  || jq '[.history[] | select(.outcome == "rejected")] | .[-10:]' "$STATE_FILE")
HISTORY_RECENT=$(jq '.history[-5:]' "$STATE_FILE")

HISTORY=$(jq -n \
  --argjson failures "$HISTORY_FAILURES" \
  --argjson rejected "$HISTORY_REJECTED" \
  --argjson recent "$HISTORY_RECENT" \
  '{failures: $failures, rejected: $rejected, recent: $recent}')

# ── Top programs and inspiration ──────────────────────────────────────────────
TOP_PROGRAMS=$(echo "$EVALUATED" | jq '
  sort_by(.fitness) | reverse | .[:3]
  | map({id, description, metrics, feature_coords,
         code_snippet: (.final_code | to_entries | .[0] | .value[:400] // "")})
')

# Inspiration: diverse programs from different cells (lowest fitness per approach)
INSPIRATION=$(echo "$EVALUATED" | jq '
  group_by(.feature_coords.approach)
  | map(sort_by(.fitness) | first)
  | sort_by(.fitness) | reverse | .[:2]
  | map({id, description, metrics, feature_coords,
         code_snippet: (.final_code | to_entries | .[0] | .value[:400] // "")})
')

# ── Parent code ───────────────────────────────────────────────────────────────
# For "original", final_code is empty — the worktree base branch IS the parent.
PRIMARY_CODE=$(jq -r '.archive[$id].final_code // {}' --arg id "$PRIMARY_ID" "$STATE_FILE")
SECOND_CODE="null"
if [[ "$MODE" == "crossover" ]] && [[ "$SECOND_ID" != "null" ]]; then
  SECOND_CODE=$(jq -r '.archive[$id].final_code // {}' --arg id "$SECOND_ID" "$STATE_FILE")
fi

# ── Write current-iteration.json ──────────────────────────────────────────────
TARGET=$(jq -r '.target' "$STATE_FILE")
FITNESS=$(jq -r '.fitness_prompt' "$STATE_FILE")
BRANCH=$(jq -r '.branch' "$STATE_FILE")

jq -n \
  --argjson iter "$NEW_ITER" \
  --argjson max "$MAX_ITERATIONS" \
  --arg target "$TARGET" \
  --arg fitness "$FITNESS" \
  --arg branch "$BRANCH" \
  --arg mode "$MODE" \
  --arg search_mode "$SEARCH_MODE" \
  --arg primary_id "$PRIMARY_ID" \
  --argjson primary_metrics "$(echo "$PRIMARY" | jq '.metrics // {}')" \
  --argjson primary_code "$PRIMARY_CODE" \
  --arg second_id "$SECOND_ID" \
  --argjson second_parent "$SECOND_PARENT" \
  --argjson second_code "$SECOND_CODE" \
  --argjson top_programs "$TOP_PROGRAMS" \
  --argjson inspiration "$INSPIRATION" \
  --argjson history "$HISTORY" \
  '{
    iteration:            $iter,
    max_iterations:       $max,
    target:               $target,
    fitness_prompt:       $fitness,
    branch:               $branch,
    mode:                 $mode,
    search_mode:          ($search_mode == "true"),
    primary_parent: {
      id:           $primary_id,
      metrics:      $primary_metrics,
      final_code:   $primary_code
    },
    second_parent: (if $second_id != "null" then {
      id:           $second_id,
      metrics:      ($second_parent.metrics // {}),
      final_code:   ($second_code // {})
    } else null end),
    top_programs:         $top_programs,
    inspiration_programs: $inspiration,
    history:              $history
  }' > .evolve/current-iteration.json

exit 0
