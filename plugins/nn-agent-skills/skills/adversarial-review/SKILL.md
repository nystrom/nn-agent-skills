---
name: adversarial-review
description: >-
  Adversarial code review of a change set — assume the change is subtly wrong
  and find the ways it fails. Hunts expensive, dangerous, and hard-to-detect
  failures: auth and trust-boundary gaps, data loss and corruption, races and
  ordering bugs, retry/idempotency holes, migration and version-skew hazards,
  and observability blind spots. Reports only material findings with a concrete
  fix. Use when asked to review adversarially, stress-test a PR or branch, find
  reasons to block a merge, or as a review lens under run-review-lenses.
---

# Adversarial Review

Break confidence in the change. Do not validate it. Assume it can fail in
subtle, high-cost, or user-visible ways until the evidence says otherwise. Good
intent, partial fixes, and "we'll follow up" do not count.

This is a **review lens**. It returns findings and never acts — no file edits,
no GitHub posts, no "fixed it for you." When another skill (typically
`run-review-lenses`) loaded you and asked for a structured finding list, obey
that wire format and stop there. When invoked on your own, review the change
set and report as below.

## Scope

Review the **change set**, not the whole repository as archaeology:

- Prefer the net diff against `origin/main` (or the base the caller named).
- Walk commits only to learn *why* a surviving change exists; ignore work a
  later commit undid.
- Include the working tree when the caller said to, or when you were pointed
  at local uncommitted work.
- Weight any focus area the user named, but still report every other material
  issue you can defend.

## Operating stance

- Default to skepticism. Happy-path-only is a real weakness.
- Prefer one strong finding over several weak ones. No filler, no style nits
  dressed up as risk.
- Do not invent files, lines, code paths, incidents, or runtime behavior. If a
  conclusion is an inference, say so and keep confidence honest.
- If the change looks safe under adversarial pressure, say so and return no
  findings. `approve` is allowed; empty praise is not required.

## Attack surface

Prioritize failures that are expensive, dangerous, or hard to detect:

- auth, permissions, tenant isolation, and trust boundaries
- data loss, corruption, duplication, and irreversible state changes
- rollback safety, retries, partial failure, and idempotency gaps
- race conditions, ordering assumptions, stale state, and re-entrancy
- empty-state, null, timeout, and degraded-dependency behavior
- version skew, schema drift, migration hazards, and compatibility regressions
- observability gaps that would hide failure or make recovery harder

Trace how bad inputs, retries, concurrent actions, and partially completed
operations move through the new code. Look for violated invariants, missing
guards, and assumptions that stop being true under stress.

## Finding bar

A finding is worth filing only when you can answer all four:

1. What can go wrong?
2. Why is this code path vulnerable?
3. What is the likely impact?
4. What concrete change would reduce the risk?

Skip stylistic preferences, speculative cleanups, and anything you cannot
anchor to a real path through the change.

## Output

### When a caller requested structured findings

Emit one object per finding and nothing else that needs parsing:

```
{ source, path, line, severity, title, body, suggested_fix }
```

- `source` — `adversarial-review`
- `path` — file path (routing key for the caller)
- `line` — new-file line number, or `null` for a design-level finding
- `severity` — `blocker` | `high` | `medium` | `low` (no `nit` here; if it is a
  nit it is not adversarial)
- `title` — short heading
- `body` — what goes wrong, why this path, impact
- `suggested_fix` — the smallest concrete change that closes the hole

Also return a one-line ship/no-ship headline (`needs-attention` or `approve`).

### When invoked standalone

Return a compact markdown report:

- a one-line verdict: `needs-attention` or `approve`
- a terse ship/no-ship summary (not a neutral recap)
- findings ranked by severity; each with file, line (or range), confidence
  `0..1`, impact, and a concrete recommendation

## Final check

Before returning, verify each finding is adversarial (not stylistic), tied to a
concrete location, plausible under a real failure scenario, and actionable.
