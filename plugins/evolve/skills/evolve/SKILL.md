---
name: evolve
description: Optimize code through iterative LLM-generated mutations measured by a user-defined fitness function. Use when the user asks to evolve or optimize an algorithm, function, query, data structure, or implementation through benchmarks; asks for AlphaEvolve-style search; or wants to inspect, resume, stop, or apply the best result from an existing .evolve run.
---

# Evolve

Run a MAP-Elites-style optimization loop while preserving test and benchmark
integrity. Higher fitness is always better; negate latency, memory, or error
metrics when necessary.

Resolve `PLUGIN_ROOT` as the directory two levels above this `SKILL.md`. The
shared implementation lives in `${PLUGIN_ROOT}/scripts`, and detailed role
prompts live in `${PLUGIN_ROOT}/agents`.

## Choose the operation

- Start or resume an optimization: follow the evolution workflow.
- Ask for status: read `.evolve/state.json` and report iteration progress, the
  archive, the best candidate, and the five most recent history entries.
- Stop or cancel: show the current best, ask whether to apply it, then run
  `${PLUGIN_ROOT}/scripts/teardown-evolve.sh` after the user's choice.
- Apply the best result: run `${PLUGIN_ROOT}/scripts/apply-best.sh`, verify the
  resulting working tree, and leave `.evolve/` intact for auditability.

## Start or resume

For a new run, require a concrete target and fitness criterion. Run:

```bash
bash "${PLUGIN_ROOT}/scripts/setup-evolve.sh" \
  "<target>" --fitness "<fitness>" [--branch "<branch>"] [--iterations N]
```

The setup script requires a clean git tree and `jq`. If `.evolve/state.json`
already exists, resume it instead of replacing it.

## Evolution loop

Continue until the configured iteration count is reached or the user stops the
run. Do not rely on a Claude stop hook.

1. Read `.evolve/current-iteration.json`.
2. Generate three diverse proposals concurrently when subagents are available:
   algorithmic, data-structure, and micro-optimization. Give each explorer the
   iteration context and `${PLUGIN_ROOT}/agents/explorer.md`. When parallel
   agents are unavailable, produce the proposals inline.
3. Synthesize one candidate using `${PLUGIN_ROOT}/agents/refiner.md`. Honor
   mutate, crossover, retry, and search modes from the context.
4. Evaluate in an isolated git worktree using
   `${PLUGIN_ROOT}/agents/evaluator.md`. Never benchmark a candidate in the
   user's primary working tree. If agent worktree isolation is unavailable,
   create a detached worktree under `.evolve/worktrees/`, evaluate there, and
   remove it afterward.
5. Retry once when compilation or tests fail. Do not retry a second time.
6. Update `.evolve/state.json` exactly as described in
   `${PLUGIN_ROOT}/commands/evolve.md`: archive valid candidates, replace a
   MAP-Elites cell only on improvement, update `best_id`, and append history.
7. Report the iteration result. Then run
   `${PLUGIN_ROOT}/scripts/next-iteration.sh .evolve/state.json`. Exit status 0
   means another iteration is ready; exit status 1 means the run is complete.

At completion, show the history and best candidate. Ask before applying it
unless the user explicitly requested automatic application. Verify tests and
the fitness command after applying.

## Safety and integrity

- Treat compilation, tests, and the fitness command as the authority; never
  invent a score or accept an unverified candidate.
- Keep the original branch unchanged during candidate evaluation.
- Do not mutate tests, benchmark definitions, lockfiles, or generated files to
  improve a score.
- Preserve `.evolve/state.json` unless the user explicitly asks to discard the
  run.
