---
name: adversarial-review
description: >-
  Adversarial code review of a change set — assume the change is subtly wrong
  and find the ways it fails, then prove it by running code against head and
  base. Hunts expensive, dangerous, and hard-to-detect failures: broken
  extension contracts and downstream implementations, boundary and degenerate
  inputs, mutability and cache-reuse hazards, auth and trust-boundary gaps,
  data loss, races, retry/idempotency holes, migration and version-skew
  hazards. Reports only material findings, each with a mechanism, evidence, and
  a concrete fix. Use when asked to review adversarially, stress-test a PR or
  branch, find reasons to block a merge, or as a review lens under
  run-review-lenses.
---

# Adversarial Review

Break confidence in the change. Do not validate it. Assume it can fail in
subtle, high-cost, or user-visible ways until the evidence says otherwise. Good
intent, partial fixes, green CI, and "we'll follow up" do not count.

This is a **review lens**. Read the shared protocol and scope rules first:
`../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md`. They define the two
invocation modes (standalone vs. fan-out), scope resolution, the structured
finding format, and the rule that a lens never acts. This file holds only what
is specific to the adversarial lens.

## Operating stance

- Default to skepticism. Happy-path-only is a real weakness.
- **The burden of proof is on approval.** `approve` is a claim that you looked
  for the failure modes below and could not produce one; it must say what you
  checked. "Nothing found" without a record of what was probed is not an
  approval, it is an absence of review.
- **Passing tests are not evidence of safety.** CI, the PR's own regression
  test, and the broader suite show only that the inputs someone already chose
  still work. They say nothing about inputs, subtypes, and call patterns
  nobody wrote a test for — which is where the expensive bugs live. Never cite
  "tests pass" or "the suite is green" as a reason to approve.
- No filler and no style nits dressed up as risk — but **one blocker does not
  end the search.** A change can carry several independent defects; each
  distinct mechanism is its own finding. Keep hunting after the first one.
- Do not invent files, lines, code paths, incidents, or runtime behavior. Mark
  what you reproduced as verified and what you reasoned out as inferred, and
  keep confidence honest.
- If the change survives adversarial pressure, return `approve` with no
  findings. That is success, not a failure to find something.

## Method

### 1. Map what the change can break

Before hunting, list the **contracts the diff touches** — not just the code it
edits:

- every public function, method, or interface whose behavior changed, and
  every caller-visible effect (return values, thrown errors, mutation,
  callbacks invoked, writes, emitted events);
- every **extension point** the changed code reaches: methods downstream code
  can overload or implement, abstract types or interfaces others subtype,
  documented accessors, plugin hooks, generic containers of user types;
- what the PR's tests actually exercise. The gap between the two lists is your
  hunting ground.

### 2. Attack

Walk the attack surface below against that gap. For each plausible failure,
build the smallest input that would trigger it.

### 3. Verify by execution

Whenever you can run code, **prove findings by running them** rather than
arguing them:

- Get both trees: the head under review and its base (merge base with
  `origin/main` or the base the caller named). Use a scratch location — a
  temporary `git worktree` or an export under a temp directory — never the
  user's working tree, and clean up after. Running probes is not "acting";
  editing the user's files is.
- Write **targeted probes**: minimal scripts that run the same input against
  base and head and compare. Prefer probes over re-running the full suite —
  the suite tests what the author thought of; the probe tests what you suspect.
- Target the contracts from step 1 that the tests skip: a custom subtype that
  implements only the documented interface, a value wrapped in a container, a
  boundary or degenerate input, an immutable variant, a reused cache, a
  callback that counts its calls.
- A probe that shows base working and head failing (or producing a different
  result) makes the finding `verified`. Record the probe in the finding.
- If you cannot execute (no runtime, no tools, dependencies won't build), say
  so in the verdict line, mark every finding `inferred`, and name the probe
  that would confirm each one.

### 4. Diagnose the mechanism

Observing a symptom is not a diagnosis. "Users sometimes see another
account's data" is a symptom; "the new cache key omits the tenant id, so the
second tenant to request a page reads the first tenant's entry" is a
mechanism. A fix aimed at
the wrong mechanism leaves the defect in place. Trace each failure to the
specific operation, branch, or code-path decision that causes it before filing.
If you cannot pin it down, file the symptom as `inferred`, say the mechanism
is unknown, and make the suggested fix a diagnostic step rather than a guessed
patch.

## Attack surface

Prioritize failures that are expensive, dangerous, or hard to detect.

**Contracts and extension points** — the most commonly missed class:

- downstream subtypes or implementations that satisfy the documented
  interface but not the internal shape the new code now assumes (reading a
  field directly instead of calling the documented accessor; assuming a
  concrete type)
- overloads or custom methods on user types that the new path bypasses — e.g.
  honored for a bare value but skipped when the value sits inside an array,
  tuple, or wrapper
- built-in types passing while third-party types break; repository examples
  are not a sample of downstream use
- compatibility regressions: a previously valid call that now throws, changes
  type, or changes result

**Boundary and degenerate inputs:**

- empty, singleton, and duplicate collections; zero, negative, and maximum
  values; a divisor, length, or count that can be zero
- inputs that only reach a fallback, repair, or clamping path the main path
  never exercises
- overflow, truncation, rounding, and precision loss; encodings and unicode;
  time zones, DST, and leap days; very large or deeply nested inputs
- sentinel and special values (null, empty string, NaN, default objects)
  propagating where real data is expected, and code that carries on with a
  plausible-looking wrong result
- changed defaults, limits, tolerances, units, or types
- silent wrong answers — worse than errors, because nothing flags them

**Mutability, state, and caches:**

- in-place vs. out-of-place APIs: requiring mutation of storage that can be
  immutable, or returning a new object where callers expect an update
- aliasing: two names for one buffer, mutation of an input the caller still uses
- cache or workspace reuse after a parameter, size, or type change; stale
  derived or precomputed data
- callbacks and hooks: changes to how many times or in what order they run,
  matters whenever they carry state, are non-idempotent, or have side
  effects
- changes to which implementation a call resolves to (overload, override,
  or type-based selection) that alter results, not only speed

**Systems failures:**

- auth, permissions, tenant isolation, and trust boundaries
- data loss, corruption, duplication, and irreversible state changes
- rollback safety, retries, partial failure, and idempotency gaps
- race conditions, ordering assumptions, stale state, and re-entrancy
- empty-state, null, timeout, and degraded-dependency behavior
- version skew, schema drift, and migration hazards
- observability gaps that would hide failure or make recovery harder

## Finding bar

A finding is worth filing only when you can answer all five:

1. **What** can go wrong — the user-visible behavior that breaks.
2. **Mechanism** — the specific operation or decision that causes it.
3. **Evidence** — the probe that reproduces it (`verified`), or the reasoning
   and the probe that would confirm it (`inferred`).
4. **Impact** — who hits it and how bad it is.
5. **Fix** — the smallest concrete change that closes the hole.

Skip stylistic preferences, speculative cleanups, and anything you cannot
anchor to a real path through the change.

## Severity and verdict

The verdict follows from the findings. Do not decide it separately.

- **Regressions block.** If something that worked at base now throws, returns
  a different type, or produces a different result at head, that is
  at least `high`. There is no "noted but not blocking" for a regression: a
  review that sees the break and approves anyway is as harmful as one that
  misses it.
- **The only exception** is a behavior change the PR explicitly intends and
  documents (in its description, changelog, or deprecation path). Accept it
  only by saying so in the finding body and citing where it is documented —
  and still file it, at `medium` or below, so the reader sees the change.
- **High-impact uncertainty escalates.** A plausible `high`-impact failure you
  could not verify is still filed — as `question` severity, or at its impact
  severity with `inferred` evidence — and it still makes the verdict
  `needs-attention`. Dropping it for low confidence is how a cautious reviewer
  lets a real defect through.
- `blocker` — data loss, security hole, silent wrong results, or a crash on a
  previously valid public call.
- `high` — any other regression, or a likely failure under realistic use.
- `medium` — a real failure under unusual but legitimate use.
- `low` — a real but minor weakness. No `nit`: if it is a nit it is not
  adversarial.

Verdict: `needs-attention` if there is any finding at `medium` or above or any
`question`; otherwise `approve`.

## Output

Use the formats in `lens-protocol.md`, with these additions.

**Structured (fan-out).** Fill the optional `evidence` field on every
finding. Start it with `Verified:` or `Inferred:`, then give the probe (the
input and the base-vs-head result) or the reasoning plus the probe that would
confirm it. The `body` states what breaks, the mechanism, and the impact.

**Standalone.** In the compact markdown report, give each finding its
mechanism, evidence (verified/inferred, with the probe), and confidence
`0..1`. The verdict line says whether you executed code. An `approve` adds a
short **probed** list: the contracts from step 1 and how each was checked.

## Final check

Before returning, check that:

- every finding names a mechanism, not just a symptom, and carries evidence
  marked verified or inferred;
- no regression you observed is filed below `high` or described as
  non-blocking without a documented intent;
- you kept hunting after the first blocker, and each independent mechanism has
  its own finding;
- an `approve` lists what was probed and does not rest on passing tests;
- every finding is adversarial (not stylistic), tied to a concrete location,
  and actionable.
