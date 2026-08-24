---
description: "Show the status of an active evolve run: archive contents and iteration progress"
allowed-tools:
  - "Bash(cat .evolve/state.json)"
  - "Read(.evolve/state.json)"
---

# Evolve Status

1. Check if `.evolve/state.json` exists:

```bash
cat .evolve/state.json 2>/dev/null || echo "NOT_FOUND"
```

2. **If NOT_FOUND**: report "No active evolve run."

3. **If found**, display:

```
AlphaEvolve — iteration <N>/<max_iterations>

  Target:  <target>
  Fitness: <fitness_prompt>
  Branch:  <branch>

MAP-Elites Archive (<K> cells occupied):

  complexity | approach            | fitness    | iter  | description
  -----------+---------------------+------------+-------+-----------------------------
  0          | iterative           |    123.400 | 2     | replaced loop with...
  1          | cache-friendly      |    456.700 | 5     | reordered memory access   ← BEST
  ...

Recent history (last 5):
  [iter-N] <description> → <outcome> (fitness: X)
```
