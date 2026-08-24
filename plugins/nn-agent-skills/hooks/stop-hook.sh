#!/usr/bin/env bash
# AlphaEvolve stop hook — drives the evolution loop.
# Called by Claude Code whenever Claude tries to exit.
# Outputs JSON to block exit and feed the next iteration prompt back.

set -euo pipefail

HOOK_INPUT=$(cat)
STATE_FILE=".evolve/state.json"

# ── Not active ────────────────────────────────────────────────────────────────
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# If run is marked inactive (apply already done), allow exit.
if [[ "$(jq -r '.active' "$STATE_FILE")" == "false" ]]; then
  exit 0
fi

# ── Session isolation ─────────────────────────────────────────────────────────
# Only the session that started the run should drive it.
STATE_SESSION=$(jq -r '.session_id // ""' "$STATE_FILE")
HOOK_SESSION=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
if [[ -n "$STATE_SESSION" ]] && [[ "$STATE_SESSION" != "$HOOK_SESSION" ]]; then
  exit 0
fi

# ── Advance to next iteration ─────────────────────────────────────────────────
# next-iteration.sh exits 0 + writes current-iteration.json if there is work,
# exits 1 if the run is complete.
NEXT_SCRIPT="${CLAUDE_PLUGIN_ROOT}/scripts/next-iteration.sh"

if ! bash "$NEXT_SCRIPT" "$STATE_FILE"; then
  # Evolution complete — ask Claude to apply the best result and report.
  BEST_ID=$(jq -r '.best_id' "$STATE_FILE")
  BEST_FITNESS=$(jq -r --arg id "$BEST_ID" '.archive[$id].metrics.fitness // "unknown"' "$STATE_FILE")
  MAX=$(jq -r '.max_iterations' "$STATE_FILE")

  jq -n \
    --arg best "$BEST_ID" \
    --arg fitness "$BEST_FITNESS" \
    --arg max "$MAX" \
    '{
      "decision": "block",
      "reason": ("AlphaEvolve complete — " + $max + " iterations finished.\n\nBest result: " + $best + " (fitness: " + $fitness + ")\n\nRead .evolve/state.json, apply the best program'\''s final_code to the working tree, and print the summary table. Do not remove .evolve/."),
      "systemMessage": ("AlphaEvolve: all " + $max + " iterations done. Applying best result.")
    }'
  exit 0
fi

# ── Feed next iteration ───────────────────────────────────────────────────────
ITER=$(jq -r '.iteration' "$STATE_FILE")
MAX=$(jq -r '.max_iterations' "$STATE_FILE")

jq -n \
  --arg iter "$ITER" \
  --arg max "$MAX" \
  '{
    "decision": "block",
    "reason": "Read .evolve/current-iteration.json and execute the evolution iteration described there.",
    "systemMessage": ("AlphaEvolve: iteration " + $iter + "/" + $max)
  }'

exit 0
