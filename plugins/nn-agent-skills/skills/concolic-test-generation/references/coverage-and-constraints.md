# Coverage Tooling and Constraint Solving Reference

## 1. Per-Language Branch Coverage Commands

Always request **branch coverage** and a machine-readable report (JSON or LCOV)
so you can map line and branch IDs directly to source predicates. Scope execution
to the target test file and target module to avoid full-suite overhead.

### Python (`pytest` + `coverage.py`)

```bash
uv run coverage run --branch --context=test -m pytest path/to/test_target.py
uv run coverage json -o .concolic-coverage.json --include="path/to/target.py"
```

- `.concolic-coverage.json` contains `files[path].executed_lines`,
  `missing_lines`, `executed_branches` (`[[from_line, to_line], ...]`), and
  `missing_branches` (`[[from_line, to_line], ...]`).
- A negative `to_line` in `missing_branches` (e.g. `[42, -15]`) means the branch
  at line 42 never jumped to the exit of the code block starting at line 15
  (return/exit path).
- Every `[from_line, to_line]` in `missing_branches` whose `from_line` appears
  in `executed_lines` is a **frontier branch**: execution reached `from_line`
  but never took the edge to `to_line`.

### TypeScript / JavaScript (`vitest`, `jest`, `c8`, `nyc`, Node V8)

**Where to find the tool:**
- Check `package.json` (`scripts`, `devDependencies`) and lockfiles (`pnpm-lock.yaml`,
  `package-lock.json`, `yarn.lock`, `bun.lockb`) plus `node_modules/.bin/`.
- **Vitest** requires a coverage provider package in `node_modules/@vitest/coverage-v8`
  or `node_modules/@vitest/coverage-istanbul`. If neither is installed, run with
  `npx c8` wrapping `vitest run` or use `NODE_V8_COVERAGE`.
- **Jest** includes coverage out of the box (`--coverage --coverageProvider=v8`
  or `babel`).
- **Standalone / Node `node:test` / Mocha**: use `node_modules/.bin/c8`,
  `node_modules/.bin/nyc`, or Node's built-in `NODE_V8_COVERAGE` env var.
- **Bun**: `bun test --coverage --coverage-reporter=lcov` writes `coverage/lcov.info`.

**Commands:**

```bash
# Vitest (v8 or istanbul provider)
npx vitest run path/to/target.test.ts --coverage.enabled=true \
  --coverage.provider=v8 --coverage.reporter=json \
  --coverage.include="path/to/target.ts"

# Jest (no extra packages needed with v8 provider)
npx jest path/to/target.test.ts --coverage --coverageProvider=v8 \
  --collectCoverageFrom="path/to/target.ts" --coverageReporters=json

# c8 wrapping any test command (Node/tsx/mocha)
npx c8 --include="path/to/target.ts" --reporter=json npx tsx --test path/to/target.test.ts

# Zero-dependency fallback: Node built-in V8 coverage
NODE_V8_COVERAGE=.concolic-v8 node --test path/to/target.test.js
```

**Reading the output:**
- `coverage/coverage-final.json` (Istanbul JSON format emitted by Vitest, Jest,
  `c8 --reporter=json`, and `nyc --reporter=json`):
  - `statementMap` + `s`: statement locations and execution counts.
  - `branchMap[id]` gives `{ line, type, locations: [{ start, end }, ...] }`
    where `type` is `"if"`, `"cond-expr"` (ternary), `"binary-expr"` (`&&`/`||`/`??`),
    `"switch"`, or `"default-arg"`.
  - `b[id]` gives hit counts per arm, e.g. `[4, 0]` means arm 0 ran 4 times and
    arm 1 ran 0 times → frontier branch at `branchMap[id].line`, arm 1.
- Raw `NODE_V8_COVERAGE` JSON files in `.concolic-v8/*.json`:
  - `result[].url` matches the file path; `result[].functions[].ranges` lists
    `{ startOffset, endOffset, count }` byte-offset blocks. Any inner range with
    `count == 0` nested inside a parent range with `count > 0` is an unexecuted
    branch arm.

### Rust (`cargo-llvm-cov`, `llvm-cov`, `cargo-tarpaulin`)

**Where to find the tool:**
1. Check `command -v cargo-llvm-cov` (typically `~/.cargo/bin/cargo-llvm-cov`).
   Also check `rustup component list --installed | rg llvm-tools`.
2. If `cargo-llvm-cov` is not installed, check `command -v cargo-tarpaulin`.
3. If neither cargo subcommand is installed, check the Rust sysroot for bundled
   LLVM coverage binaries:
   ```bash
   SYSROOT="$(rustc --print sysroot)"
   HOST="$(rustc -vV | sed -n 's/^host: //p')"
   LLVM_BIN="$SYSROOT/lib/rustlib/$HOST/bin"
   # Contains llvm-profdata and llvm-cov when llvm-tools-preview is installed:
   # rustup component add llvm-tools-preview
   ```

**Commands:**

```bash
# 1. Preferred: cargo-llvm-cov (stable Rust: region/segment coverage)
cargo llvm-cov --test target_test --json --output-path .concolic-coverage.json

# 1b. Nightly Rust with true MC/DC or branch coverage enabled
cargo +nightly llvm-cov --branch --test target_test --json --output-path .concolic-coverage.json

# 2. Fallback without cargo-llvm-cov: raw rustc + sysroot llvm-cov
RUSTFLAGS="-C instrument-coverage" \
  LLVM_PROFILE_FILE=".concolic-%p-%m.profraw" \
  cargo test --test target_test
"$LLVM_BIN/llvm-profdata" merge -sparse .concolic-*.profraw -o .concolic.profdata
# Find the compiled test binary path from `cargo test --no-run --message-format=json`
"$LLVM_BIN/llvm-cov" export --format=text --instr-profile=.concolic.profdata \
  --object path/to/test_binary --sources src/target.rs > .concolic-coverage.json
rm -f .concolic-*.profraw .concolic.profdata
```

**Reading the output:**
- In `.concolic-coverage.json` (`llvm.coverage.json.export`):
  - `data[0].files[]` has `filename`, `segments`, and (on nightly `--branch`) `branches`.
  - Each `segments[]` entry is `[line, col, count, hasCount, isRegionEntry, isGapRegion]`.
    Even on stable Rust without `--branch`, LLVM emits separate region-entry
    segments for each arm of `if`/`else`, `match` patterns, `?` early returns,
    and `&&`/`||` operands (inspect the column offset `col` on the same `line`
    with `count == 0` while the preceding segment on `line` has `count > 0`).

### Go (`go test -coverprofile`)

```bash
go test -covermode=count -coverpkg=./path/to/pkg -coverprofile=.concolic-coverage.out ./path/to/pkg -run TestTarget
```

- Each line in `.concolic-coverage.out` has format:
  `file:startLine.startCol,endLine.endCol numStmt count`.
- Basic blocks with `count == 0` immediately following a conditional whose
  enclosing or sibling block has `count > 0` form the branch frontier.

### Julia (`--code-coverage`, `CoverageTools`, `LocalCoverage`)

**Where to find the tool:**
- Line coverage instrumentation is **built directly into the `julia` runtime** via
  the `--code-coverage` CLI flag (no package installation needed to generate
  `.cov` files or LCOV tracefiles).
- For programmatic LCOV / summary parsing, check whether `CoverageTools` or
  `Coverage` or `LocalCoverage` is installed in the global environment or
  `~/.julia/packages/` (`julia -e 'using Pkg; println(Base.find_package("CoverageTools"))'`).
  If not installed, parse the plain-text `.cov` files directly or use Julia
  1.10+'s built-in LCOV output `--code-coverage=@.concolic-lcov.info`.

**Commands:**

```bash
# Built-in: emit per-file <source>.jl.<pid>.cov files next to src/*.jl
julia --project=. --code-coverage=user -e 'include("test/runtests.jl")'

# Built-in (Julia 1.8+): emit a single LCOV file directly with zero packages
julia --project=. --code-coverage=.concolic-%p.info -e 'include("test/runtests.jl")'
```

**Reading the output and handling single-line branches:**
- `.cov` files are line-by-line mirrors of the `.jl` source prefixed by execution
  count (`        -` for non-executable lines, `        0` for unexecuted lines,
  `        N` for executed lines).
- LCOV `.info` files contain `DA:<line>,<count>` records per `SF:<filepath>`.
- **Gotcha**: Julia's runtime coverage tracks **lines**, not sub-line column
  regions. Single-line conditionals (`x > 0 && return y`, `a ? b : c`,
  `if cond; body; end` on one line) show as covered (`count > 0`) as soon as the
  condition evaluates, even if the consequence never ran.
  - When analyzing a Julia target function, scan for single-line `&&`, `||`, `? :`,
    and one-line `if` expressions; either trace them with a temporary print or
    temporarily expand the body onto its own line while running coverage, then
    restore formatting afterward.
- Always delete generated `src/*.cov` and `.concolic-*.info` files after each
  measurement so counts do not accumulate across runs.

### C / C++ (`gcov` / `llvm-cov`)

```bash
llvm-cov export --format=text -instr-profile=default.profdata ./test_bin path/to/target.c > .concolic-coverage.json
```

---

## 2. Tracing Concrete Values When Static Inspection Is Ambiguous

When a loop, hash table, state machine, or arithmetic chain makes it hard to
express `P` in terms of entry inputs `I` by reading the code alone:

1. Add a temporary one-line trace print or assertion log immediately before
   `location` that prints the concrete values of the variables inside `P` when
   running `T_seed`.
2. Run `T_seed` once, read the concrete values at `location`, and immediately
   revert the trace line from the production file.
3. Never leave instrumentation in production files after the step finishes.

---

## 3. LLM Path-Condition Inversion Patterns

### Compound Booleans and Short-Circuiting

A source line `if A && B && C:` has up to four branch outcomes:

| Path | `A` | `B` | `C` | Overall |
|---|---|---|---|---|
| 1 | `False` | (not evaluated) | (not evaluated) | `False` |
| 2 | `True` | `False` | (not evaluated) | `False` |
| 3 | `True` | `True` | `False` | `False` |
| 4 | `True` | `True` | `True` | `True` |

- If the `True` branch of the `if` is uncovered and `T_seed` failed at `B == False`,
  your path condition for the `True` branch is `Prefix ∧ A ∧ B ∧ C`.
- If the `False` branch is covered only via `A == False`, check whether `A ∧ ¬B`
  or `A ∧ B ∧ ¬C` guards distinct side effects or error messages; if `B` or `C`
  is pure, flipping the overall `if` outcome suffices unless branch coverage
  tracks each sub-condition.

### Loops (`while`, `for`, recursion)

When the target branch `P` is inside a loop body:

- **Iteration 0 vs. Iteration $k$**: if `T_seed` enters the loop and reaches `P`
  on iteration 1 with accumulator `acc = f(x_0)`, check whether `¬P` can be
  satisfied on iteration 1 by changing `x_0`, or whether `P` is a threshold
  condition (e.g. `steps >= max_steps` or `carry > 0`) that requires an input
  of length $k$ so the accumulator crosses the threshold on iteration $k$.
- **Zero-trip path**: if the loop body is covered but skipping the loop (`0`
  iterations) is uncovered, negate the loop entry guard while preserving prefix
  constraints before the loop.

### Data Structures, Strings, and Parsers

Symbolic execution tools struggle with string operations, regexes, hash maps,
and recursive types; LLMs handle them directly if you decompose the constraints
in stage order:

1. List each validation/parsing stage `C_1, C_2, ..., C_{k-1}` and the slice or
   property of the input it constrains (e.g. `C_1`: `len(s) >= 4`, `C_2`:
   `s.startswith("v1:")`, `C_3`: `int(s[3:])` is valid base-10).
2. Pin the prefix slices that satisfy `C_1 ... C_{k-1}` and mutate only the
   substring or structural element inspected by `P` (e.g. `P`: `val > 0xFFFF` →
   set `s = "v1:65536"`).

### Floating-Point and Boundary Conditions

- Check `NaN`, `-0.0`, `Inf`, `-Inf`, and subnormals when a branch checks
  `!(x <= y)` vs `x > y` (`NaN` makes all standard comparisons `False`).
- For integer comparisons (`<`, `<=`, `==`, `>=`, `>`), choose exact off-by-one
  boundary values (`bound - 1`, `bound`, `bound + 1`) rather than arbitrary
  large numbers so off-by-one bugs surface immediately.

### Detecting Infeasible Paths (Unsatisfiable Constraints)

Before synthesizing a test, check for structural contradiction between
`C_1 ... C_{k-1}` and `¬P`:

1. **Redundant guard**: an outer check `if x == nil { return }` dominates an
   inner check `if x == nil { ... }`. The inner true-branch is unsatisfiable.
2. **Type / constructor invariant**: a value constructed via a smart constructor
   that clamps `0 <= p <= 1` cannot trigger a downstream `if p < 0` branch
   through the public API.
3. **Mutually exclusive state flags**: `C_1` requires `mode == READ_ONLY` and
   `¬P` requires `can_write == true`, where `can_write` is derived as
   `mode != READ_ONLY`.

When a branch is infeasible along `T_seed`'s prefix, search the call graph or
CFG for an **alternate entry path** to `location` that does not pass through the
contradictory `C_i`. Only classify `location` as dead/infeasible when every
path to `location` enforces `P`.
