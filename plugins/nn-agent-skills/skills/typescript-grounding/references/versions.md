# TypeScript Version Differences: 5.x–7.0

TypeScript ships a minor release roughly every three months; there is no semver
"major = breaking" guarantee — minor releases can introduce breaking changes to
the checker. The headline event of this range is the **7.0 native port**: the
compiler was rewritten in Go (Project *Corsa*), giving ~10× faster builds while
keeping type-checking semantics identical. **6.0 is the last release built on the
JavaScript codebase** and exists mainly to deprecate legacy options that 7.0
removes.

Use this reference to verify whether a construct or compiler option is valid for a
given target version, and when migrating.

---

## TypeScript 5.x — Selected Milestones

Not exhaustive; the features most likely to matter when reading or writing 5.x
code, with the minor that introduced each.

**5.0** — `const` type parameters (`function f<const T>(x: T)`), standard
(Stage 3) decorators without `--experimentalDecorators`, all enums treated as
union enums, and `--verbatimModuleSyntax` (explicit type-only imports/exports).

**5.2** — Explicit resource management: `using` and `await using` declarations
backed by `Symbol.dispose`/`Symbol.asyncDispose` (ES proposal); decorator
metadata.

**5.3** — Import attributes (`import x from "./y" with { type: "json" }`),
`switch (true)` narrowing.

**5.4** — `NoInfer<T>` utility type; narrowing preserved in closures following the
last assignment.

**5.5** — Inferred type predicates (a function returning a boolean guard is
inferred as `x is T` when its body proves it); `--isolatedDeclarations`; regex
syntax checking.

**5.8** — `--erasableSyntaxOnly` (rejects run-time–emitting constructs like
`enum` and namespaces so tools that merely strip types, such as Node's
type-stripping, stay correct).

Throughout 5.x, `strict` remains **opt-in** (off by default) — a project without
`"strict": true` gets weak null checking and implicit `any`.

---

## TypeScript 6.0 — The Last JavaScript-Based Release

6.0 is a transition release that aligns behavior with the upcoming native
compiler by deprecating and removing legacy options. Options it deprecates keep
working **only** if you set `"ignoreDeprecations": "6.0"` — and **7.0 removes them
entirely**.

**Removed / no longer valid compiler options:**
`--target es5`; `--module amd | umd | systemjs | none`;
`--moduleResolution classic | node (node10)`; `--outFile`;
`--downlevelIteration`; `--baseUrl` as a module-resolution root;
`--esModuleInterop false`; `--allowSyntheticDefaultImports false`;
`--alwaysStrict false`.

**Removed language features:** the legacy `module` keyword for namespaces, the
`asserts`-style import assertion syntax (replaced by `with`), and the
`no-default-lib` directive.

**New defaults in 6.0** (a stricter, ESM-first baseline):
`"strict": true`, `"module": "esnext"`, `"target": "es2025"`, `"types": []`
(no longer auto-loads every `@types` package), `"rootDir": "."`,
`"noUncheckedSideEffectImports": true`, `"libReplacement": false`.

**CLI change:** running `tsc` with file arguments while a `tsconfig.json` exists
is now an error unless you pass `--ignoreConfig`.

Minimum output target rises to **ES2015** (ES5 emit is gone).

---

## TypeScript 7.0 — The Native (Go) Compiler

Went GA on **8 July 2026**. 7.0 is a **port, not a rewrite**: the compiler and
language service are reimplemented in Go with shared-memory multithreading.

**What changes:**
- **Speed/memory:** typically 8–12× faster full builds and large editor-startup
  and memory improvements; the binary/command is `tsgo` (the native `tsc`).
- **Removed options:** every option 6.0 deprecated is **deleted** — code relying
  on `--ignoreDeprecations` must be migrated first.
- **`--stableTypeOrdering`:** a deterministic internal object ordering that makes
  parallel type-checking reproducible (introduced to bridge 6.0→7.0).
- **Programmatic API:** a new compiler API; full stabilization is slated for
  **7.1**, which is the practical gate for tools/plugins (ts-patch, transformers,
  some ESLint/type-aware setups) that depend on internals.

**What does NOT change:** **type-checking semantics are identical.** Practically
any code that compiles cleanly under 6.0 compiles identically under 7.0. Do not
expect different inference, narrowing, or error messages from the port itself —
only speed.

---

## Migration Notes

### 5.x → 6.0

- Turn on `"strict": true` explicitly if you were not already (6.0 makes it the
  default, which *adds* errors to previously-loose code).
- Replace removed options: `es5`→`es2015`+; `--outFile`→bundler/project refs;
  `classic`/`node10` resolution→`bundler`/`node16`/`nodenext`.
- Set `"types"` explicitly — 6.0 no longer auto-includes all `@types`.
- Silence remaining deprecations temporarily with `"ignoreDeprecations": "6.0"`,
  but treat them as must-fix before 7.0.

### 6.0 → 7.0

- Remove every option that only survived via `ignoreDeprecations` — 7.0 deletes them.
- Switch the build to `tsgo`; expect identical type results, far faster runs.
- Do **not** upgrade internals-dependent tooling (custom transformers, some
  type-aware ESLint plugins) until they support the native API — target 7.1.

---

## What an Agent May Safely Infer

- 7.0's speedup does not change type-checking results — semantics match 6.0.
- Options like `--target es5`, `--outFile`, and `--moduleResolution node10` are
  invalid in 6.0+ and removed in 7.0.
- `strict` is off by default through 5.x but on by default from 6.0.
- `const` type parameters and standard decorators require 5.0+; `using`/`Symbol.dispose` require 5.2+.

## What an Agent Must Not Infer Without Evidence

- That the native port (7.0) changes inference, narrowing, or error text — it does
  not; report bugs as behavior differences only with evidence.
- That a `tsconfig` written for 5.x is valid under 6.0/7.0 — legacy options were
  removed.
- That internals-based tools (custom transformers, ts-patch) work on 7.0 before
  the 7.1 API stabilization.
- That a project is strict — check the `tsconfig`; strictness gates many behaviors.

## What Requires Whole-Program Analysis

- Whether removing a deprecated option changes module resolution or emit for a
  specific project.
- Whether a codebase relies on ES5 emit or `--outFile` bundling that 6.0+ no
  longer supports.
- Whether a given plugin/transformer depends on compiler internals that the
  native port has not yet stabilized.
