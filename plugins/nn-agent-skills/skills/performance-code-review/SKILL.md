---
name: performance-code-review
description: >-
  Performance-focused code review of a change set. Finds regressions and missed
  wins in algorithmic complexity, hot-path allocations, N+1 and chatty I/O,
  unbounded work, lock contention, cache misuse, excess serialization, and
  accidental quadratic behavior. Prefers measured or complexity-backed claims
  over taste. Use when asked for a performance review, to check a PR for
  slowdowns, or as a review lens under run-review-lenses.
---

# Performance Code Review

Review the change set for performance — regressions introduced by the diff,
and clear missed wins on paths the change already touches. Clarity still beats
micro-optimization; flag only costs that are real at the scale this code runs.

This is a **review lens**. It returns findings and never acts — no file edits,
no GitHub posts, no rewrites "for speed." When another skill (typically
`run-review-lenses`) loaded you and asked for a structured finding list, obey
that wire format and stop there. When invoked on your own, review the change
set and report as below.

## Scope

- Prefer the net diff against `origin/main` (or the base the caller named).
- Include the working tree when the caller said to, or when pointed at local
  uncommitted work.
- Read enough surrounding code to see call frequency, data sizes, and whether
  the path is on a request/hot loop versus a rare admin path.
- Weight any focus area (p99 latency, memory, startup, a named endpoint), but
  still report other material issues on the change.

## What to look for

Prioritize, in roughly this order:

- **Algorithmic / complexity regressions** — newly quadratic or worse over
  input size, nested loops over the same collection, repeated scans that a
  single pass or index would replace.
- **N+1 and chatty I/O** — per-item queries, RPCs, or file reads inside a
  loop; missing batch/prefetch; sync I/O on an async path.
- **Unbounded work** — loads that grow with table size and have no limit,
  pagination gap, or circuit breaker; unbounded buffering or retries.
- **Allocations and copies on a hot path** — per-request large allocs, needless
  clones, repeated serialization/deserialization, building huge strings or
  intermediate collections.
- **Lock contention and scheduling** — coarse locks held across I/O or slow
  work; blocking calls on latency-sensitive threads; thundering herds.
- **Cache and locality** — broken or bypassed caches, stampede risk, cache
  keys that defeat reuse, repeated work the change could have memoized where
  a cache already exists.
- **Data-shape mistakes** — wrong index usage, full scans introduced by a
  predicate change, SELECT * / over-fetch, loading relations unused by the
  new path.
- **Startup and build-path costs** only when the change clearly moves them
  (new eager imports, sync work at module load, etc.).

Do **not** flag:

- Style, naming, or pure readability preferences.
- Micro-optimizations on cold code with no evidence of cost.
- "Could use a faster hash map" without a reason this path cares.
- Speculative rewrites that trade clarity for unmeasured gains.

## Method

1. Identify which changed paths are likely hot (request handlers, loops over
   user data, parsers, tight inner functions) versus cold (one-shot migrations,
   rare admin tools).
2. For each hot path, estimate cost drivers: per-call work, per-item work in a
   loop, I/O count, allocation shape, critical-section length.
3. Compare to what the code did before when the diff shows it — a regression
   beats a theoretical absolute.
4. Anchor every finding in a concrete scenario: input size, concurrency, or
   call frequency that makes the cost matter.

## Finding bar

File a finding only when you can state:

1. Where the cost is (path / line).
2. What triggers it (input size, QPS, concurrency).
3. Why it matters at this system's scale (or why it is a clear regression).
4. A concrete, smaller-cost alternative.

If you cannot defend the scale claim, drop it or mark severity `low` with the
uncertainty in the body.

## Output

### When a caller requested structured findings

```
{ source, path, line, severity, title, body, suggested_fix }
```

- `source` — `performance-code-review`
- `path` — file path
- `line` — new-file line, or `null` for cross-cutting cost
- `severity` — `blocker` (user-visible meltdown / clear production regression) |
  `high` (likely severe under expected load) | `medium` (real but bounded) |
  `low` (minor or uncertain scale)
- `title` — short heading
- `body` — cost, trigger, impact; name complexity (e.g. O(n²)) when that is the
  claim
- `suggested_fix` — smallest change that removes or bounds the cost

One-line headline: `needs-attention` or `approve`.

### When invoked standalone

Compact markdown: verdict line, short summary, findings ranked by severity
with file, line, trigger scenario, and recommendation.

## Final check

Each finding must be about cost or capacity, tied to a location, plausible at
real scale (or clearly a regression), and actionable — not a taste debate.
