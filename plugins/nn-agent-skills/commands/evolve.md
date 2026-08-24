---
description: "Start an evolutionary optimization run on a piece of code"
argument-hint: "TARGET_PROMPT --fitness FITNESS_PROMPT [--branch BRANCH] [--iterations N]"
allowed-tools:
  - "Bash(git rev-parse*)"
  - "Bash(git worktree*)"
  - "Bash(cat .evolve/*)"
  - "Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-evolve.sh*)"
  - "Read(.evolve/*)"
  - "Write(.evolve/*)"
  - "Agent"
---

# AlphaEvolve

Run the setup script:

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/setup-evolve.sh" $ARGUMENTS
```

If it exits non-zero, stop and report the error.

---

## Your task: execute one iteration

Read `.evolve/current-iteration.json`. It contains everything you need for
this iteration. Execute the steps below, then exit — the stop hook will
advance the counter and feed the next iteration back to you automatically.

---

### 1. Read the iteration context

```bash
cat .evolve/current-iteration.json
```

Note: `iteration`, `mode` (mutate/crossover), `search_mode`, `primary_parent`,
`second_parent` (null unless crossover), `history`, `top_programs`,
`inspiration_programs`.

---

### 2. Run 3 explorer agents in parallel (model: haiku)

Spawn all three simultaneously. Pass each:

- `TARGET` — from context
- `FITNESS_PROMPT` — from context
- `PARENT_CODE` — `primary_parent.final_code` (empty `{}` means use files as-is on the base branch)
- `HISTORY` — `history.recent` from context
- `STRATEGY` — assign one per explorer:
  - Explorer A: `"algorithmic"`
  - Explorer B: `"data-structure"`
  - Explorer C: `"micro-optimization"`

Collect all proposals. If an explorer fails or returns invalid JSON, continue
with the remaining ones.

---

### 3. Run the refiner agent

Pass:

- `TARGET`, `FITNESS_PROMPT`, `ITERATION` — from context
- `MODE` — from context (`"mutate"` or `"crossover"`)
- `SEARCH_MODE` — from context
- `PARENT_CODE` — `primary_parent.final_code`
- `PARENT_METRICS` — `primary_parent.metrics`
- `SECOND_PARENT_CODE` — `second_parent.final_code` (if crossover)
- `SECOND_PARENT_METRICS` — `second_parent.metrics` (if crossover)
- `EXPLORER_PROPOSALS` — all valid explorer outputs as a JSON array
- `TOP_PROGRAMS`, `INSPIRATION_PROGRAMS` — from context
- `HISTORY` — full history object from context

---

### 4. Evaluate in a worktree

Spawn the **evaluator** agent with `isolation: "worktree"`:

- `FITNESS_PROMPT`, `TARGET` — from context
- `PARENT_CHANGES` — `primary_parent.final_code`
- `DIFFS` — refiner's diffs

---

### 4a. Retry on failure (once)

If `compiled: false` OR `tests_passed: false`: spawn the **refiner** with
`MODE: "retry"`, passing `ERROR_OUTPUT` and `FAILED_DIFFS`, then evaluate again.
Do not retry a second time.

---

### 5. Update state

Write the result into `.evolve/state.json`:

```bash
cat .evolve/state.json
```

- Add the new program to `archive` with key `"iter-<N>"`:
  ```json
  {
    "id": "iter-N",
    "description": "...",
    "final_code": { ... },
    "metrics": { "fitness": 1234.5 },
    "feature_coords": { "complexity": 1, "approach": "iterative" },
    "generation": N,
    "parent_id": "<primary_parent_id>"
  }
  ```
  Only add if `compiled: true` AND `tests_passed: true`.

- MAP-Elites update: if cell `"<complexity>,<approach>"` is empty or new
  fitness > existing fitness, replace it.

- Update `best_id` if new fitness > current best.

- Append to `history`:
  ```json
  {
    "iter": N,
    "description": "...",
    "mode": "mutate|crossover|retry",
    "metrics": { "fitness": 1234.5 },
    "feature_coords": { "complexity": 1, "approach": "iterative" },
    "outcome": "new_best | improved_cell | rejected | compile_failed | test_failed"
  }
  ```

Write the updated state back to `.evolve/state.json`.

---

### 6. Report

```
[iter N/M] <description>  (mode: <mode>)
  fitness: <X>  cell: (<complexity>, <approach>)  outcome: <outcome>
  best: <best_score> (<best_id>, <best_approach>)  archive: <K> cells
```

Then exit. The stop hook handles the rest.
