#!/usr/bin/env bash
# Clean up after an evolve run (complete or cancelled).
# Removes active worktrees and the .evolve directory.

set -euo pipefail

STATE_FILE=".evolve/state.json"

if [[ ! -d ".evolve" ]]; then
  echo "Nothing to clean up."
  exit 0
fi

# Remove any worktrees created under .evolve/
if git rev-parse --git-dir > /dev/null 2>&1; then
  while IFS= read -r wt_path; do
    if [[ "$wt_path" == "$(pwd)/.evolve/"* ]]; then
      echo "Removing worktree: $wt_path"
      git worktree remove --force "$wt_path" 2>/dev/null || true
    fi
  done < <(git worktree list --porcelain | grep '^worktree ' | awk '{print $2}')
fi

rm -rf .evolve
echo "AlphaEvolve state removed."
