# Recording Paths and Solving Path Conditions

## 1. Recording One Path per Test

The search needs, for each test, the ordered list of `(branchId, arm)`
decisions it made through the target module, plus a branch map naming every
branch and its arms. Aggregate coverage (hit counts per arm) is not enough: it
loses order and which test made which decision. Use it only to find the
module's tests and its branches.

Output shapes, consumed by `scripts/concolic.mjs`:

- Branch map: `{"<branchId>": {"type": "if", "loc": {"start": {"line": 12}},
  "locations": [<arm 0>, <arm 1>, ...]}}`. Istanbul's per-file entry in
  `coverage-final.json` has this shape; `concolic.mjs` reads that file directly.
- Traces: `*.jsonl` files in one directory, one line per test:
  `{"testPath": "...", "testName": "...", "decisions": [["3", 1], ["5", 0]]}`.
  Branch ids are strings and must match the branch map's keys.

### Never edit the source under test in place

Tracing must not change the production checkout. An interrupted run leaves
an in-place edit behind, and every later measurement and commit includes it.
Choose, in order:

1. A runtime hook that observes existing instrumentation (the Jest tracer
   below). Nothing on disk changes.
2. A copy. Instrument the module in a scratch git worktree and run the tests
   there:

   ```bash
   git worktree add --detach .concolic/wt HEAD
   # insert trace calls into .concolic/wt/<module>, run tests from .concolic/wt
   git worktree remove --force .concolic/wt
   ```

3. A patch reverted on every exit path, including failure and interrupt:

   ```bash
   git apply .concolic/trace.patch
   trap 'git apply -R .concolic/trace.patch' EXIT INT TERM
   <run tests>
   ```

   In a script, put the revert in a `finally` block. Check with
   `git -P diff --quiet -- <module>` afterward.

An inserted trace call appends `[branchId, arm]` to a per-process list at the
start of each arm. Use one id per branch and number arms in source order. For
short-circuit operators (`a && b`), each operand is its own branch; trace it
without evaluating an operand the original expression would skip. Split the
list per test with the framework's per-test setup and teardown hooks, and
append one JSON line per test.

### TypeScript / JavaScript with Jest (no source change)

`scripts/tracer/setup.mjs` puts a Proxy on `globalThis.__coverage__`.
Istanbul's preamble registers each file with `coverage[path] = data`; the `set`
trap wraps that file's `b` arrays in Proxies, so each `b[id][arm]++` the
instrumented code executes appends `[id, arm]` to a list in execution order.
`scripts/tracer/hooks.mjs` clears the list in `beforeEach` and writes one JSON
line per test in `afterEach`. Istanbul's `branchMap` gives source locations
already remapped through ts-jest's source maps.

```bash
npx jest path/to/target.test.ts path/to/target.generated.test.ts --ci \
  --collectCoverage --coverageProvider babel --coverageReporters=json \
  --coverageDirectory=.concolic/coverage \
  --collectCoverageFrom=path/to/target.ts \
  --setupFiles=<skill-dir>/scripts/tracer/setup.mjs \
  --setupFilesAfterEnv=<skill-dir>/scripts/tracer/hooks.mjs
```

Run with `CONCOLIC_TRACE_DIR=.concolic/traces` and
`CONCOLIC_TRACE_SOURCE=<absolute path of target.ts>` and
`NODE_OPTIONS=--experimental-vm-modules` in the environment; Jest loads the
`.mjs` setup files only with that flag. Put the test paths
before `--setupFiles`: those flags take lists and swallow a trailing positional.
Clear `.concolic/traces` before each run; the hooks append.

Limits:

- It needs `--coverageProvider babel`. The `v8` provider has no per-arm
  counters to observe.
- It depends on istanbul writing `b[id][arm]++` through a plain property set.
  If a future `babel-plugin-istanbul` changes that, the tracer records nothing.
  `concolic.mjs frontier` exits with status 2 when the baseline has no paths;
  stop the run there.
- It assumes one test runs at a time within a file. `test.concurrent`
  interleaves two tests' decisions into one recorded path. Exclude seed files
  that use it, and never generate a concurrent test.
- It has not been verified under Vitest. Vitest's istanbul provider uses its
  own coverage variable, so `setup.mjs` would need to wrap that global instead.

### Other languages

No tracer ships for these. Record paths with an instrumented copy or a
reverted patch (above), and use the coverage tool to find the module's tests
and branch locations.

- **Python**: `uv run coverage run --branch -m pytest <tests>` and
  `uv run coverage json --show-contexts` with `dynamic_context =
  test_function` in the coverage config. `executed_branches` and
  `missing_branches` list `[from_line, to_line]` arcs; a negative `to_line`
  is an exit from the code object starting at that line. Contexts name the
  tests that reach each line.
- **Go**: `go test -covermode=count -coverpkg=./pkg
  -coverprofile=.concolic/cover.out ./pkg -run TestTarget`. Block counts only;
  `&&` and `||` operands are invisible to it, so find branches by reading the
  source.
- **Rust**: `cargo llvm-cov --test <target> --json --output-path
  .concolic/cov.json` (stable: region segments; nightly `--branch`: branch
  records). Without `cargo-llvm-cov`, use `RUSTFLAGS="-C instrument-coverage"`
  and the `llvm-profdata` and `llvm-cov` binaries under
  `$(rustc --print sysroot)/lib/rustlib/<host>/bin/` (from
  `rustup component add llvm-tools-preview`).
- **Julia**: `julia --project=. --code-coverage=.concolic/lcov-%p.info -e
  'include("test/runtests.jl")'`. Line counts only: a one-line `a && b`,
  `c ? x : y`, or one-line `if` counts as covered when its condition runs.
  Delete the `.info` and `.cov` files after each run so counts do not
  accumulate.
- **C / C++**: `llvm-cov export --format=text -instr-profile=default.profdata
  ./test_bin <target.c>`.

## 2. Solving Path Conditions

The target is `C_1 ∧ ... ∧ C_{k-1} ∧ D`: the seed's first `k-1` decisions
unchanged, then the flipped arm `D`. Decisions after `k` are unconstrained.

### Short-circuit operators

`if A && B && C` is three branches, one per operand, and they appear in the
path in evaluation order:

| Path | `A` | `B` | `C` | Overall |
|---|---|---|---|---|
| 1 | false | not evaluated | not evaluated | false |
| 2 | true | false | not evaluated | false |
| 3 | true | true | false | false |
| 4 | true | true | true | true |

Each row is a distinct path. A seed on row 2 yields two targets at this
expression: flip `A` (row 1) and flip `B` (rows 3 and 4 share that prefix; the
next search step separates them).

### Loops

A loop's guard appears in the path once per iteration, so the same branch id
repeats. A target that flips the guard at its `j`-th appearance asks for exactly
`j-1` iterations followed by an exit (or one more iteration). Solve for the
input that makes the loop run that many times: a collection of that length, a
counter that crosses the threshold on that iteration. `max-visits` limits how
many appearances of one branch are flip points, so a seed that loops 100 times
does not yield 100 targets for one guard.

The zero-trip path (guard false on first evaluation) is the flip at the guard's
first appearance.

### Data structures, strings, parsers

List each validation stage in the prefix and the slice of the input it
constrains (`C_1`: `len(s) >= 4`, `C_2`: `s` starts with `"v1:"`, `C_3`:
`s[3:]` parses as an integer). Keep the slices that satisfy them and change
only the part `D` inspects (`D`: value `> 0xFFFF`, so `s = "v1:65536"`).

### Floating point and boundaries

- `NaN` makes every ordered comparison false, so `!(x <= y)` and `x > y`
  disagree on it. Also try `-0.0`, `Inf`, `-Inf`, subnormals.
- For integer comparisons, use `bound - 1`, `bound`, `bound + 1`, not an
  arbitrary large value.

### Infeasible paths

Check the prefix against `D` before writing a test. Common contradictions:

1. **Dominating guard**: `if x == nil { return }` earlier in the prefix makes a
   later `x == nil` true-arm unsatisfiable.
2. **Constructor invariant**: a smart constructor clamps `0 <= p <= 1`, so a
   later `p < 0` cannot hold for values built through it.
3. **Derived flags**: `C_1` requires `mode == READ_ONLY` and `D` requires
   `can_write`, where `can_write = mode != READ_ONLY`.

Infeasibility here is per path, not per branch: the same arm may be reachable
under a different prefix, and that prefix is a separate target.

### Paths behind module-private bindings

Some paths turn on values that only an unexported constructor or a
module-private variable can produce: a branded type, a private cache entry, an
internal state reachable only through a sequence the public API does not
allow. A test is a separate module and cannot produce them. Report the path as
unreachable through the public API, naming the private binding. Do not export
it, add a test-only accessor, or move the test into the module: each buys path
coverage by coupling tests to internals that are private so they can change.
