---
name: concolic-test-generation
description: >-
  Generate tests for execution paths a module's test suite never takes, by
  LLM-driven concolic search. Records the ordered branch decisions each
  existing test makes (one path per test), targets every path that keeps a
  known path's first k-1 decisions and flips the k-th, picks the test sharing
  the longest prefix as the seed, and uses LLM reasoning in place of an SMT
  solver to build an input for that path. A candidate is kept only if it
  passes, adds exactly one test, and its recorded path starts with the target
  prefix. Writes characterization tests to a separate generated test file; an
  optional review pass on a stronger model judges whether each pinned behavior
  is correct. Use when asked for concolic test generation, path-coverage test
  synthesis, or tests for unexplored execution paths.
---

# Concolic Test Generation

A concolic engine records the path condition of a concrete run, negates one
conjunct, and asks a solver for inputs that satisfy the result. This skill does
the same search with you in place of the solver.

Read `references/coverage-and-constraints.md` for how to record paths per
language and for constraint-solving patterns. The search, the bounds, and the
ledger are implemented in this skill's `scripts/` directory (run
`node <skill-dir>/scripts/concolic.mjs` from the target repository's root; with
no arguments it prints usage). Do not compute the frontier by hand. The examples
below write `scripts/` for `<skill-dir>/scripts/`.

## What a path is

A path is the ordered sequence of branch decisions one test makes through one
module. A decision is `(branchId, arm)`: which branch, and which way it went.

Branch coverage cannot express this. Coverage counters are aggregates: a suite
that takes an `if` true in one test and false in another reports both arms
covered, but says nothing about which combinations occur in one run. Two tests
can cover every arm of a function with three sequential two-way branches and
still miss six of its eight paths. When every arm is covered, a branch frontier
is empty; a path frontier is not.

## Inputs

- **Target**: one module (source file). For a diff or a package, run once per
  changed module.
- **Mode**:
  - `generate` (default): add accepted tests to the module's generated test
    file. Never edit hand-written test files or the source under test.
  - `review`: run the oracle pass over an existing generated file.
  - `report`: print the frontier and stop. Writes nothing.
- **Bounds**: `max-depth` (default 12), `max-visits` (default 2), `max-tests`
  accepted tests per run (default 10), `retries` repair attempts per target
  (default 2). See "Bounds".

## The search

### 1. Record a baseline path per test

Find the test runner and how to record ordered decisions for the language
(`references/coverage-and-constraints.md`, section 1). Check machine load first,
and run only the test files that exercise the target module.

Produce two artifacts:

- A branch map: `{branchId: {type, loc: {start: {line}}, locations: [...]}}`,
  one entry per branch, one `locations` element per arm. Istanbul's
  `coverage-final.json` entry already has this shape.
- A trace directory of `*.jsonl` files, one line per test:
  `{"testPath", "testName", "decisions": [[branchId, arm], ...]}`.

Stop if the baseline records no paths although tests ran. The tracer is then
broken or misconfigured, and every candidate would be rejected for having no
path. `concolic.mjs frontier` exits with status 2 in that case.

If no test reaches the module at all, report that there is no seed and stop.

### 2. Compute the frontier

```bash
node scripts/concolic.mjs frontier --source src/target.ts \
  --branches .concolic/coverage/coverage-final.json --traces .concolic/traces \
  --max-depth 12 --max-visits 2
```

For each known path `T` and each index `k`, the target prefix is
`T[0..k-1] ++ flip(T[k])`: a path that shares a feasible prefix with `T` and
then goes where no test has gone. For a branch with more than two arms, each
other arm is a separate flip. The script drops prefixes that a known path
already realizes, and prefixes the ledger retired for the current source hash.
It orders the rest shortest first, and names a seed for each: the known test
whose path shares the longest prefix with the target, ties going to the shorter
path.

Shortest first spreads exploration across many branches before going deep
along one path. Each step costs a model call, not a solver query.

In `report` mode, print the frontier with each target's decisions rendered as
source predicates, and stop.

### 3. Write the path condition for the target

Take the first target. Read the seed test and its concrete inputs `I_seed`.
Map each decision in the target prefix to its predicate at `branchMap[id].loc`:
`C_1 ... C_{k-1}` for the shared prefix (each true under `I_seed`), and `D` for
the flipped arm. Express each in terms of the test's inputs: if `D` checks a
local `y > 10` where `y = normalize(x) + offset`, write it in terms of `x` and
`offset`.

The path condition is `C_1 ∧ ... ∧ C_{k-1} ∧ D`. Decisions after `k` are free.

### 4. Solve it

Construct `I_new` satisfying the path condition by the smallest change to
`I_seed` (patterns in the reference, section 2):

- Keep every input that no `C_i` or `D` depends on.
- Numeric: solve the inequality; pick the boundary value.
- Strings and parsers: keep the prefix that passes earlier stages, change the
  slice `D` inspects.
- Collections: change length, order, duplicates, or depth.
- External boundaries (clock, RNG, network, DB): stub only that boundary's
  return value. Do not mock the code under test.

Before writing a test, check whether the target is reachable:

- **Infeasible**: the prefix implies `¬D` (an outer guard dominates the inner
  check, a smart constructor clamps the value, two flags are derived from one
  field). Record the contradicting `C_i` and `D`.
- **Unreachable through the public API**: the path turns on a value only a
  module-private binding can produce, such as a brand made by an unexported
  constructor. A test cannot reach it without coupling to internals.

Never export internals, add test-only hooks, or write in-source tests to reach a
path. Report it as unreachable and move on. Retire either kind in the ledger:

```bash
node scripts/concolic.mjs retire --source src/target.ts --key '<target key>' \
  --status infeasible --reason 'C_2 (n > 0) contradicts D (n < 0)'
```

### 5. Write the candidate

Write exactly one test that drives `I_new` through the module, following the
repository's test conventions. The assertion pins what the code does now: this
is a characterization test, not a judgment that the behavior is right.

To keep the recorded path equal to the intended one:

- Reach the module through the same entry point the seed uses, unless the path
  requires another.
- Call the module once. A second call appends its own decisions and usually
  breaks the prefix.
- Setup that calls the module under test also records decisions. Build fixtures
  by hand rather than through helpers that run the module.

Assert on observable results: a return value, a thrown error's message, a
state change. If the only assertion available is "does not throw", say so in the
report rather than padding the test.

If running `I_new` crashes or violates an obvious contract, keep the test
pinning the current behavior and note the suspicion for the review pass. Do not
assert the behavior you think is intended; that is the review pass's call.

### 6. Gate the candidate

Before running it, check structure. Reject a candidate that:

- has more or less than one test case, or wraps it in a `describe` group;
- uses a snapshot assertion;
- imports anything other than the module's public API, the test framework, and
  helpers the seed test already uses.

Then add it to the generated file (see "Output files"), run that file with the
tracer, and accept only if all three hold:

1. the new test passes;
2. the file runs exactly one more test than before (one test per candidate; the
   trace for the new test must be its own);
3. its recorded path starts with the target prefix:

   ```bash
   node scripts/concolic.mjs check --traces .concolic/traces \
     --test-name '<full test name>' --prefix '<target prefix JSON>'
   ```

A test that reaches the flipped arm by a different route fails check 3: it
covers the arm but not the target path.

On rejection, remove the candidate and retry up to `retries` times, each time
with the rejection reason in hand: the failing assertion, the test-count
mismatch, or the decision where the recorded path diverged (`check` prints it).
After the last retry, retire the target as `gaveup` with the last reason.

### 7. Repeat

Re-run the generated file with the tracer so accepted paths join the known set,
then go back to step 2. Each accepted path adds deeper prefixes to the frontier.
Stop at `max-tests` accepted
tests or when the frontier is empty.

Once per run, after the loop, type-check and lint the generated file with the
project's own commands (`tsc --noEmit`, `cargo clippy --tests`, `ruff check`,
`go vet`). Some runners skip type checking per test (`ts-jest` with
`diagnostics: false`), so a candidate can pass the gate and still break the
build. Map each error to the test whose lines contain it, drop that test, and
report it as rejected.

Do not prune generated tests by coverage. Two tests are redundant only if their
recorded paths are identical, which the gate already prevents.

## Output files

Generated tests go in one file per module, separate from hand-written tests, so
they can be reviewed and deleted as a group. Use the language's discovery rules:
`target.generated.test.ts`, `test_target_generated.py`,
`target_generated_test.go`, `tests/target_generated.rs`,
`test/target_generated.jl` (and include it from `runtests.jl`). Start the file
with this header in the language's comment syntax:

```
Machine-generated characterization tests (concolic-test-generation).
Each test drives one execution path through <module>.
Assertions describe current behavior, not intended behavior.
Regenerate rather than hand-edit; delete the file to drop them all.
```

The ledger and traces go under `.concolic/` at the repository root. Add it to
`.gitignore`. The ledger keys each retired path by its decisions and validates
it against a hash of the whole source file: branch ids are numbered per file,
so any edit can renumber every decision in a stored path.

## Review pass (`review` mode)

Generation answers "can this path execute". It says nothing about whether the
behavior on that path is right, and the model that made the path execute should
not also judge its assertion. The review pass asks the second question of every
test in a generated file.

Run it as a fresh subagent that did not write the tests, on the strongest model
available (in Claude Code, the Agent tool with `model: "opus"`). Allow it only
read-only tools: Read, Grep, Glob. It writes nothing; you apply its verdicts. Give it inline the test, the source of the module, and the module's
specification comments and doc comments; let it search for the rest (design
docs, callers, specs). Ask for one verdict per test:

- `correct`: the pinned behavior is what the code should do. No change.
- `unclear`: the sources do not decide it. No change.
- `suspected-bug`: write the verdict and its reason as a comment above the
  test, and draft an issue (location, input, observed, expected, evidence) in
  `.concolic/issues/`. Keep the test: it is the evidence. Do not file the issue;
  the user decides.

Record whether a specification was available. A `correct` verdict reached from
the source alone is weaker than one checked against a specification.

## Bounds

Path coverage is infinite once loops are involved, and exponential without
them.

- `max-depth` caps the prefix length targeted. A path longer than the cap is
  never targeted.
- `max-visits` caps how many times one branch may appear in a prefix before it
  stops being a flip point. In a loop this keeps the target count proportional
  to the branches in the module, not to the iteration count.
- `max-tests` and `retries` cap the cost of a run.

## Output

Report at the end of the run:

1. **Paths**: distinct recorded paths before and after.
2. **Accepted tests**: test name, target prefix as predicates, input summary.
3. **Infeasible**: prefix, and the contradicting `C_i` and `D`.
4. **Unreachable through the public API**: prefix, and the private binding the
   path depends on.
5. **Given up**: prefix and the last rejection reason.
6. **Remaining frontier**: how many targets were left when `max-tests` stopped
   the run.
7. **Review verdicts** (review mode): counts, and each `suspected-bug` with its
   issue draft path.

State that the accepted tests are characterization tests and must be read
before they are committed.
