---
name: concolic-test-generation
description: >-
  Generate high-coverage tests using LLM-driven concolic execution (concrete
  coverage + symbolic path negation). Runs the test suite with branch and line
  coverage, builds a branch frontier where one outcome is covered and its flip
  is not, extracts the concrete seed input and path condition up to the
  divergence point, negates the target branch predicate, and solves the
  negated path condition with LLM reasoning instead of an SMT solver. Verifies
  each synthesized test by re-running coverage and keeps only tests that flip
  the target branch without failing or duplicating existing paths. Use when
  asked for concolic test generation, coverage-guided test synthesis, branch
  inversion testing, or closing uncovered execution paths with tests.
---

# Concolic Test Generation

Generate tests that reach unexecuted program paths by combining **concrete
execution** (test runner + branch/line coverage + trace inspection) with
**LLM-driven symbolic path negation**. Instead of translating constraints to
SMT-LIB and calling Z3, you act as the constraint solver: read the concrete seed
input that reaches the parent of an uncovered branch, collect the path
condition along that trace, negate the branch predicate at the divergence
point, and construct a new input that satisfies the prefix constraints while
flipping the target branch.

Every generated test is **verified against the coverage tool**. A test that
does not flip its target branch (or uncover a new path) is discarded or retried
once; never keep a test for coverage theater.

Read `references/coverage-and-constraints.md` for per-language coverage commands
(branch + per-test context where supported) and constraint-solving patterns
across data types, state, and external boundaries.

## Inputs

- **Target**: files, functions, packages, or diff (`origin/main...HEAD` by
  default when no target is named and the branch has changes; otherwise ask or
  use the user-specified files).
- **Budget**: max iterations or target branches to attempt (default: `10`
  branches or until all reachable branches in target are covered or classified
  infeasible).
- **Mode**: `write` (default: add verified tests to the project's test suite)
  or `report` (emit candidate inputs, path conditions, and infeasible-branch
  findings without modifying tracked test files).

## Concolic Loop

### 1. Discover test runner and coverage instrumentation

Inspect the repository (`pyproject.toml`, `package.json`, `Cargo.toml`,
`go.mod`, `Project.toml`, `Makefile`, CI workflows) to identify the test runner
and coverage tool. Always enable **branch coverage** when the ecosystem supports
it; line coverage misses short-circuiting boolean expressions (`a && b`),
ternary operators, and implicit `else` paths.

Coverage tool lookup and invocation by language (details and JSON/LCOV schemas in
`references/coverage-and-constraints.md`):

- **TypeScript / JavaScript**: check `package.json` (`devDependencies` and
  `scripts`), `vitest.config.*`, `jest.config.*`, or `.nycrc*`.
  - **Vitest**: requires `@vitest/coverage-v8` or `@vitest/coverage-istanbul` in
    `node_modules/@vitest/`. Run with `--coverage.enabled=true --coverage.reporter=json`
    (writes `coverage/coverage-final.json`).
  - **Jest**: built-in `--coverage --coverageReporters=json` (uses `babel` or
    `v8` via `coverageProvider`; writes `coverage/coverage-final.json`).
  - **Node.js test runner / Mocha / tape**: use `c8` (`npx c8 --reporter=json`)
    or `nyc` (`npx nyc --reporter=json`), or Node's built-in V8 coverage
    directory (`NODE_V8_COVERAGE=.concolic-v8 node --test ...`).
- **Rust**: check `Cargo.toml` and `rust-toolchain.toml`, then locate the
  installed binary in `~/.cargo/bin` or `PATH`:
  - **`cargo-llvm-cov`** (`cargo llvm-cov --version`; install via
    `cargo install cargo-llvm-cov` + `rustup component add llvm-tools-preview`):
    preferred. Exports region/branch JSON via
    `cargo llvm-cov --test <target> --json --output-path .concolic-coverage.json`
    (add `--branch` on nightly with `-Z coverage-options=branch`).
  - **`cargo-tarpaulin`** (`cargo tarpaulin --version`, Linux/macOS): fallback if
    `cargo-llvm-cov` is absent (`cargo tarpaulin --out Json`).
  - **Raw `rustc` instrumentation** (when no wrapper is installed): run with
    `RUSTFLAGS="-C instrument-coverage" LLVM_PROFILE_FILE=".concolic-%p-%m.profraw" cargo test`,
    then merge and export with `llvm-profdata` and `llvm-cov` located inside
    `$(rustc --print sysroot)/lib/rustlib/$(rustc -vV | sed -n 's/host: //p')/bin/`.
- **Julia**: built into the `julia` binary (`--code-coverage=user` or
  `--code-coverage=tracefile-%p.info`), plus standard library `CoverageTools`
  (ships in the `CoverageTools` / `Coverage` package or stdlib depot under
  `~/.julia/packages/CoverageTools`):
  - Run `julia --project=. --code-coverage=user -e 'include("test/runtests.jl")'`
    to emit `.cov` files alongside each `.jl` source file, or parse them into
    LCOV with `using CoverageTools; LCOV.writefile(".concolic-lcov.info", process_folder("src"))`.
  - Note: Julia's `--code-coverage` records per-line execution counts, not
    sub-line short-circuit arms. To inspect short-circuit `&&` / `||` or ternary
    outcomes on a single line, inspect the AST or temporarily split arms onto
    separate lines during trace inspection.
- **Python**: `coverage.py` (`uv run coverage run --branch --context=test -m pytest ...`
  and `uv run coverage json`).
- **Go**: built-in `go test -covermode=count -coverprofile=.concolic-coverage.out`.

Check machine load before running the suite. Run coverage scoped to the target
module and its existing tests, not the entire monorepo suite.

### 2. Baseline concrete execution and branch frontier

Run the existing tests under coverage and parse the structured output (JSON,
LCOV, Cobertura XML, or annotated source report):

1. **Seed corpus**: map each existing test case to the lines and branches it
   executes. When the coverage tool supports per-test contexts (e.g.
   `pytest --cov-context=test`), enable it; otherwise map tests by targeting
   the test file for the module under test.
2. **Branch frontier**: find **half-covered branches**, which are conditional
   predicates `P` at `file:line` where execution reached `P` at least once,
   took one outcome (`True` or `False`, or a subset of `match`/`switch` arms),
   and never took the alternative outcome.
   - If the target function has **zero** coverage (no seed reaches the entry
     point), first synthesize one baseline seed input that enters the function,
     run it under coverage, and rebuild the frontier.
3. **Rank the frontier**: prioritize branches by:
   - Shallowest control-dependency depth from an already-covered path (closest
     divergence point first).
   - High-consequence paths: error handling, boundary guards, parser/validator
     rejections, state transitions, and security/permission checks.
   - Skip generated code, unreachable defensive assertions mandated by the type
     system, and platform-specific branches for other OSes.

### 3. Select a target branch and extract the path condition

For the top unexplored branch `(location, predicate P, taken_outcome, desired_outcome = ¬taken_outcome)`:

1. **Identify a concrete seed test `T_seed`** that reaches `location` and
   evaluates `P` to `taken_outcome`.
2. **Trace the concrete execution** of `T_seed` from the entry point to
   `location`:
   - Read the concrete input values `I_seed` (arguments, fixture state, mocked
     returns) that `T_seed` supplies.
   - Follow the control flow through the source code (or attach a lightweight
     trace/log probe if arithmetic or loop state is opaque) and list every
     branch condition `C_1, C_2, ..., C_{k-1}` evaluated along the path before
     `P`.
3. **Write down the explicit Path Condition**:
   - Prefix constraints: `C_1(I) ∧ C_2(I) ∧ ... ∧ C_{k-1}(I)` (must remain
     **unchanged** so execution still reaches `location`).
   - Negated target constraint: `¬P(I)` (or the specific arm condition for a
     multi-way branch).
   - Trace symbolic expressions back to the entry parameters `I`: if `P` checks
     a local variable `y > 10` where `y = normalize(x) + offset`, express `¬P`
     in terms of the input `x` and state `offset`.

### 4. Solve the negated path condition (LLM instead of SMT)

Construct a concrete input `I_new` that satisfies:

$$\text{Prefix}(I_{\text{new}}) \;\land\; \neg P(I_{\text{new}})$$

Apply minimal perturbation to `I_seed`:

- Keep every field, argument, or fixture setup of `I_seed` that does not
  participate in `P` fixed, so `C_1 ... C_{k-1}` stay satisfied.
- Solve for the minimal change to `I_seed` that flips `P`:
  - **Numeric / arithmetic / bitwise**: solve the inequality or modular
    equation directly; pick the boundary value (e.g. `x == limit` or
    `x == limit - 1`).
  - **Strings / regex / parsers**: construct a string that passes earlier stage
    checks (`C_1 ... C_{k-1}`) and triggers `¬P` (e.g. valid header prefix,
    malformed payload at offset `k`).
  - **Collections / graphs / trees**: adjust length, duplicate keys, ordering,
    or depth to satisfy structural predicates.
  - **External calls / I/O seams**: when `P` depends on a clock, RNG, network,
    or DB error return, inject or stub only that boundary return value while
    keeping the production logic under test unmocked.
- **Check for unsatisfiability (infeasible path)**: if `C_1 ∧ ... ∧ C_{k-1}`
  logically implies `P` (for example, `C_1` established `x > 5` and `x` is
  not mutated before `P` checks `x >= 0`), the negated branch `¬P` is **dead
  code** along this path. Check whether another entry path reaches `location`
  without `C_1`; if none exists, mark the branch **infeasible** and record the
  contradiction (`C_i` vs `¬P`) instead of guessing inputs.

### 5. Synthesize the test and determine the oracle

Write a focused test case using `I_new` that matches the repository's existing
test conventions (file placement, naming, fixtures, table-driven style where
used):

- **Oracle (assertion)**: do **not** assert whatever the code happens to return
  without checking the contract. Derive the expected return value, state
  mutation, or raised exception from the function's specification, types,
  docstring, and callers.
- **Bug discovery**: if executing `I_new` along `¬P` triggers an unhandled
  exception, panic, data corruption, or contract violation that the caller does
  not expect, **flag it as a bug** found by concolic exploration rather than
  enshrining the broken behavior in a passing assertion.

### 6. Execute, measure coverage delta, and refine

Run the test runner with branch coverage on the new test:

1. **Target branch flipped (`desired_outcome` is now covered)**:
   - Keep the test.
   - Update the coverage map and the branch frontier: flipping `P` often exposes
     nested branches inside the newly entered block; add those to the frontier.
2. **Target branch NOT flipped (execution diverged earlier at `C_j` or still
   took `taken_outcome`)**:
   - Inspect which lines/branches actually executed for `I_new`.
   - Identify the exact predicate where concrete execution disagreed with the
     predicted path condition (either `C_j` flipped unintentionally, or an
     intermediate transformation changed the value before `P`).
   - **Retry once** with the refined constraint (adding the missed intermediate
     transformation or tightening `C_j`). If the second attempt still fails to
     flip `P`, revert the candidate test, mark the branch `unresolved`, and
     move to the next frontier item.
3. **Prune redundant tests**: if a later test covers a strict superset of an
   earlier generated test's branches and locks the same behavioral contract,
   merge or prune the weaker test so the suite stays minimal.

## Output

Report a concise summary at the end of the run:

1. **Coverage delta**: line and branch coverage on the target before vs. after.
2. **Resolved branches**: table or list of `(file:line, branch predicate,
   negated path condition, test name, input summary)`.
3. **Bugs uncovered** (if any): `file:line`, triggering input `I_new`, path
   condition, failure mode, and fix recommendation.
4. **Infeasible / dead branches**: `file:line`, the contradictory predicates
   (`C_i` vs `¬P`), and whether the dead branch can be simplified or removed.
5. **Unresolved branches** (if budget exhausted or complex external state
   blocked inversion): `file:line` and what blocked satisfaction.
