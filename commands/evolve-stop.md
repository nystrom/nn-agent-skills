---
description: "Stop an active evolve run and optionally apply the best result so far"
allowed-tools:
  - "Bash(cat .evolve/state.json)"
  - "Bash(git worktree list)"
  - "Bash(git worktree remove*)"
  - "Bash(rm -rf .evolve)"
  - "Read(.evolve/state.json)"
  - "Write"
  - "Edit"
---

# Evolve Stop

1. Check if `.evolve/state.json` exists:

```bash
cat .evolve/state.json 2>/dev/null || echo "NOT_FOUND"
```

2. **If NOT_FOUND**: report "No active evolve run." and stop.

3. **If found**:
   a. Show the current best from `best_id` and its fitness score.
   b. Ask the user: **"Apply the best result (iter: <id>, fitness: <X>) to the working tree? [y/N]"**
   c. If **yes**: apply the `final_code` map from the best archive entry to the real files.
   d. Clean up any stale worktrees:
      ```bash
      git worktree list
      ```
      Remove any listed under `.evolve/`:
      ```bash
      git worktree remove --force .evolve/<name>
      ```
   e. Remove state: `rm -rf .evolve`
   f. Report done.
