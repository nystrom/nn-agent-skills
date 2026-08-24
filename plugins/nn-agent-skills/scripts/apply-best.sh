#!/usr/bin/env bash
# Apply the best archived program's final_code to the working tree,
# and print the full evolution history before doing so.
# Usage: apply-best.sh [state-file]

set -euo pipefail

STATE_FILE="${1:-.evolve/state.json}"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "❌ No state file at $STATE_FILE" >&2
  exit 1
fi

# ── Evolution history ─────────────────────────────────────────────────────────
echo "=== Evolution history ==="

TOTAL=$(jq '.history | length' "$STATE_FILE")
if [[ "$TOTAL" -eq 0 ]]; then
  echo "  (no iterations completed)"
else
  printf "  %-6s %-12s %-16s %-14s %s\n" "iter" "outcome" "fitness" "cell" "description"
  printf "  %-6s %-12s %-16s %-14s %s\n" "------" "------------" "----------------" "--------------" "-----------"
  jq -r '.history[] |
    [ (.iter | tostring),
      .outcome,
      (.metrics.fitness | if . then (. | tostring) else "—" end),
      ( if .feature_coords then
          "(" + (.feature_coords.complexity | tostring) + "," + .feature_coords.approach + ")"
        else "—" end ),
      .description
    ] | @tsv' "$STATE_FILE" \
  | while IFS=$'\t' read -r iter outcome fitness cell desc; do
      # Mark new_best iterations
      marker=""
      [[ "$outcome" == "new_best" ]] && marker=" ★"
      printf "  %-6s %-12s %-16s %-14s %s%s\n" \
        "$iter" "$outcome" "$fitness" "$cell" "${desc:0:50}" "$marker"
    done
fi

echo

# ── Archive summary ───────────────────────────────────────────────────────────
echo "=== Archive ==="
BEST_ID=$(jq -r '.best_id' "$STATE_FILE")

jq -r --arg best "$BEST_ID" '
  .archive | to_entries[]
  | select(.value.metrics.fitness != null)
  | [ .key,
      (.value.metrics.fitness | tostring),
      ( if .value.feature_coords then
          "(" + (.value.feature_coords.complexity | tostring) + "," + .value.feature_coords.approach + ")"
        else "—" end ),
      .value.description,
      (if .key == $best then " ← best" else "" end)
    ] | @tsv' "$STATE_FILE" \
| while IFS=$'\t' read -r id fitness cell desc marker; do
    printf "  %-12s  %-16s  %-16s  %s%s\n" "$id" "$fitness" "$cell" "${desc:0:45}" "$marker"
  done

echo

# ── Apply ─────────────────────────────────────────────────────────────────────
FINAL_CODE=$(jq -r --arg id "$BEST_ID" '.archive[$id].final_code // {}' "$STATE_FILE")
FILE_COUNT=$(echo "$FINAL_CODE" | jq 'length')

if [[ "$FILE_COUNT" -eq 0 ]]; then
  echo "⚠️  Best program ($BEST_ID) has no final_code — nothing to apply." >&2
  exit 0
fi

BEST_FITNESS=$(jq -r --arg id "$BEST_ID" '.archive[$id].metrics.fitness // "unscored"' "$STATE_FILE")
echo "Applying: $BEST_ID  (fitness: $BEST_FITNESS)"

echo "$FINAL_CODE" | jq -r 'keys[]' | while IFS= read -r path; do
  mkdir -p "$(dirname "$path")"
  echo "$FINAL_CODE" | jq -r --arg p "$path" '.[$p]' > "$path"
  echo "  wrote $path"
done
