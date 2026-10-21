---
name: numerical-code-review
description: >-
  Numerical-correctness review of a change set to scientific, statistical,
  simulation, optimization, solver, or other numeric code. Hunts changes that
  alter results: degenerate inputs (zero steps, empty data, coincident points),
  NaN/Inf creation and propagation, overflow and precision loss,
  ill-conditioning, changed tolerances and stopping criteria, convergence
  failures that end on a plausible wrong answer, broken invariants, element
  type and shape changes, and stale caches, factorizations, or workspaces.
  Proves findings with head-vs-base probes and reference computations. Use
  when asked to review numerical or scientific code, check that a change does
  not alter results, or as a review lens under run-review-lenses.
---

# Numerical Code Review

Find the changes that make numerical code return different answers — above
all, wrong answers that look plausible. A crash gets noticed; a solver that
stops early at a reasonable-looking point, or a result that drifts in the
fourth digit, does not.

This is a **review lens**. Read the shared protocol and scope rules first:
`../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md`. They define the two
invocation modes (standalone vs. fan-out), scope resolution, the structured
finding format, and the rule that a lens never acts. This file holds only what
is specific to numerical review.

**Applicability.** If the change touches no numerical code — no arithmetic
that produces results someone relies on, no solvers, statistics, geometry,
simulation, optimization, or numeric data handling — return `approve` with no
findings and say the lens did not apply. Do not stretch to find something.

## Operating stance

- **Results are the contract.** A change to what the code computes is a
  behavior change even when every type, signature, and test is unchanged.
- **Green tests are weak evidence here.** Numerical tests usually check a few
  well-conditioned cases at loose tolerances. They rarely cover degenerate
  inputs, extreme scales, or the fallback paths where numerical bugs live.
  Never approve because the suite passes.
- **Plausible is not correct.** A finite, reasonable-looking output proves
  nothing; compare against base, a reference, or a known invariant.
- **Name the operation.** "The result goes NaN" is a symptom. "A clamped step
  can be exactly zero, so the update divides by its squared norm, giving Inf,
  then `Inf × 0 = NaN`" is a mechanism. File the mechanism.
- One blocker does not end the search; each independent mechanism is its own
  finding. No style nits.
- If the change is numerically sound under pressure, return `approve` and list
  what you checked.

## Method

### 1. Map the numerical contract

For each changed numerical path, write down what it promises: outputs and
their accuracy, invariants (conservation, symmetry, monotonicity, bounds,
positive-definiteness, sums to one), behavior at the edges of the input
domain, termination, and determinism. Note what the PR's tests check and at
what tolerance. The gap is your hunting ground.

### 2. Attack

Walk the attack surface below against that gap. For each risk, build the
smallest input that would trigger it — usually an edge of the domain, not a
typical value.

### 3. Verify by execution

Whenever you can run code, prove findings rather than argue them:

- Get both trees — the head under review and its base — in a scratch location
  (a temporary worktree or export), never the user's working tree, and clean
  up after.
- **Differential probes:** run the same inputs on base and head and compare
  outputs, iteration counts, and status codes. Report the size of any
  difference, not just that one exists.
- **Reference checks:** compare against a closed-form answer, a
  higher-precision computation, an independent algorithm, or a simple slow
  implementation.
- **Invariant checks:** test properties that must hold whatever the input —
  residuals, conservation laws, symmetry, bounds, idempotence, round-trips.
- **Edge sweeps:** zero, one, empty, tiny and huge magnitudes, values at and
  just past boundaries, both precisions the code supports, ill-conditioned
  cases, and inputs that force fallback or recovery paths.
- Fix random seeds, or compare distributions rather than single draws, so a
  difference is not noise.
- A probe showing base correct and head wrong (or head newly different) makes
  the finding `verified`; record it. If you cannot execute, say so in the
  verdict line, mark findings `inferred`, and give the probe that would
  confirm each.

## Attack surface

**Degenerate and boundary inputs:**

- zero-length steps, empty or singleton data, coincident or collinear points,
  zero variance, rank-deficient or singular matrices, a norm or denominator
  that can be zero
- points clipped, clamped, projected, or rounded back onto a boundary or their
  origin — repair paths often produce exactly the degenerate value the main
  path never sees
- bracket endpoints, domain limits, and values just inside and outside them

**Special values and range:**

- Inf/NaN creation (`x/0`, `0 × Inf`, `Inf − Inf`, `log(0)`, `sqrt` of a tiny
  negative from rounding) and propagation through later steps
- NaN comparisons: `NaN < x` is false, so sign tests, min/max, sorting, and
  bracket updates silently take a wrong branch
- overflow and underflow in intermediates (`(a + b) / 2` near the maximum,
  squaring before a square root, products of many probabilities) where a
  rescaled form would not overflow
- integer overflow and integer-vs-float division

**Precision and conditioning:**

- catastrophic cancellation, naive summation of many terms, subtracting
  nearly equal quantities
- changed formulas that are algebraically equal but numerically worse
- ill-conditioned problems where a small change of algorithm moves the answer
- changed precision or element type (single vs. double, integer vs. float,
  real vs. complex), mixed-type promotion, and unit-carrying or
  arbitrary-precision types the new code no longer accepts

**Algorithms, convergence, and stopping:**

- changed tolerances, default parameters, step sizes, iteration limits, or
  stopping tests (absolute vs. relative, norm choice)
- failure modes that end with a status nobody checks, or a "converged" flag on
  a non-converged result
- loss of a safeguard: bracketing, line search, step-size control, fallback
  to a robust method
- changed iteration counts or accuracy for problems that used to converge

**Shape, layout, and type:**

- broadcasting, shape, or orientation changes; row vs. column major; batched
  vs. single inputs
- results returned in a different container, element type, or nesting
- static/fixed-size, sparse, GPU, or user-defined numeric types that the new
  code path no longer handles

**State, caches, and mutation:**

- reused caches, factorizations, workspaces, or preconditioners after the
  problem, size, or parameters change
- aliasing between inputs and outputs, in-place updates of storage the caller
  still uses, or of storage that cannot be mutated
- callbacks or user functions whose call count or order changed — matters when
  they carry state, log, or update parameters each call

**Reproducibility:**

- RNG seeding and stream changes, iteration order over unordered collections,
  parallel reductions that change summation order

## Finding bar

File a finding only when you can state:

1. **What** result changes or breaks, and for which inputs.
2. **Mechanism** — the specific operation that causes it.
3. **Evidence** — the probe and its base-vs-head or reference result
   (`verified`), or the reasoning and the probe that would confirm it
   (`inferred`).
4. **Impact** — magnitude of the error and who hits it.
5. **Fix** — the smallest change that closes it (a guard, a rescaled
   formula, a different stopping test, a cache invalidation).

## Severity and verdict

- `blocker` — silent wrong results on legitimate inputs, NaN/Inf where base
  returned finite correct values, or a previously valid call that now fails.
- `high` — any other result regression, lost safeguard, or broken invariant on
  realistic inputs.
- `medium` — a real error on unusual but legitimate inputs, or accuracy loss
  that stays within documented tolerance but is a regression.
- `low` — a minor or uncertain numerical weakness.
- An observed regression is at least `high` unless the PR documents the change
  as intended; even then, file it at `medium` or below so the reader sees it.
- A plausible high-impact numerical failure you could not verify is filed as
  `question` and still makes the verdict `needs-attention`.

Verdict: `needs-attention` if there is any finding at `medium` or above or any
`question`; otherwise `approve`.

## Output

Use the formats in `lens-protocol.md`, with `source` set to
`numerical-code-review`. Fill `evidence` on every finding: `Verified:` or
`Inferred:`, then the probe and the observed values. Standalone reports give
each finding its mechanism, evidence, error magnitude, and confidence `0..1`;
the verdict line says whether you executed code, and an `approve` lists what
was checked.

## Final check

- Every finding names an operation, not just a symptom, and carries evidence.
- Every observed result regression is at least `high` or cites documented
  intent.
- Degenerate inputs, special values, and fallback paths were probed, not just
  typical values.
- An `approve` lists what was checked and does not rest on passing tests.
