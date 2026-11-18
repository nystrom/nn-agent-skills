# TypeScript Toolchain Reference

Covers the compiler (`tsc` and the Go-native `tsgo`), the `tsconfig.json` options
that most change behavior, the critical split between type-checking and
transpilation, and type-aware linting. Tool commands and options are
version-sensitive — cross-check with `references/versions.md`.

---

## `tsc` and `tsgo`

`tsc` is both the **type checker** and an **emitter** (it can output JavaScript
and `.d.ts` files). As of TypeScript 7.0 the native compiler is `tsgo` — the same
CLI surface and semantics, 8–12× faster.

```bash
tsc                     # type-check and emit per tsconfig.json
tsc --noEmit            # type-check only (the common CI gate)
tsc -b                  # build mode: honor project references, incremental
tsc --watch             # incremental re-check on change
```

Diagnosing checker behavior (no extra package needed):

```bash
tsc --noEmit --explainFiles      # why each file is included
tsc --traceResolution            # module resolution steps
tsc --generateTrace out/         # performance trace for slow builds
```

In an editor, hovering shows the inferred type — the fastest way to see what the
checker actually concluded.

---

## Type-Checking vs Transpilation (Critical)

Many build pipelines **transpile** TypeScript with tools that **do not
type-check**: esbuild, swc, Babel, and Node's built-in type stripping all *erase*
types without verifying them. In such setups, `tsc --noEmit` is the only thing
that catches type errors.

- **Never** assume a build passing under esbuild/swc means the types are sound.
- Keep a separate `tsc --noEmit` step in CI even when a faster transpiler emits
  the JavaScript.
- `--isolatedModules` (and `--verbatimModuleSyntax`) constrain code to what
  single-file transpilers can handle correctly (e.g. no `const enum` across
  files, explicit `import type`).
- `--erasableSyntaxOnly` (5.8+) rejects constructs that emit runtime code
  (`enum`, namespaces), guaranteeing pure type-erasure compatibility.

---

## `tsconfig.json` — Options That Change Behavior

### Strictness

`"strict": true` enables the whole family; the individually important members:

- `strictNullChecks` — `null`/`undefined` are not in every type; the single most
  consequential flag. Without it, `string` silently includes `null`.
- `noImplicitAny` — untyped positions become errors instead of silent `any`.
- `strictFunctionTypes` — contravariant parameter checks (function-property form).
- `strictPropertyInitialization` — class fields must be assigned.
- `useUnknownInCatchVariables` — `catch (e)` gives `unknown`, not `any`.

### Beyond `strict` (opt-in, recommended)

- `noUncheckedIndexedAccess` — array/record access yields `T | undefined`
  (see `sharp-edges.md`).
- `exactOptionalPropertyTypes` — distinguishes "missing" from "present but
  `undefined`".
- `noImplicitOverride` — require the `override` keyword.
- `verbatimModuleSyntax` — predictable, transpiler-safe import/export emit.

### Modules and target

- `module` / `moduleResolution` — use `nodenext`/`node16` for Node ESM/CJS
  interop, or `bundler` when a bundler resolves. Legacy `node10`/`classic` were
  removed in 6.0.
- `target` — output JS level; ES5 emit was removed in 6.0 (minimum ES2015).
- `lib` — which built-in type declarations are available (`DOM`, `ES2023`, …).

### Performance / DX

- `skipLibCheck` — skip checking `.d.ts` files (common, faster; can hide
  dependency type bugs).
- `incremental` / `-b` build mode — cache and rebuild only what changed.
- `isolatedDeclarations` (5.5+) — require enough annotations to emit `.d.ts`
  without full type inference, enabling parallel/fast declaration emit.

---

## Declaration Files

`.d.ts` files describe the types of JavaScript with no implementation. `tsc
--declaration` emits them from source; `DefinitelyTyped` (`@types/*`) supplies
them for untyped packages. From 6.0, `@types` are **not** auto-included — list
them in `"types"` or import directly.

---

## Type-Aware Linting

TypeScript is a type checker, **not** a linter — it does not flag unused
variables' style, floating promises, or `any` usage on its own. Use
`typescript-eslint` for that, with type information enabled
(`parserOptions.project`). High-value rules:

- `@typescript-eslint/no-floating-promises` — unawaited promises.
- `@typescript-eslint/no-explicit-any`, `no-unsafe-*` — contain `any` leakage.
- `@typescript-eslint/no-misused-promises` — promises in boolean/void positions.

Type-aware rules require a real type-check pass, so they are slower than syntactic
lint rules.

---

## Running TypeScript Directly

- `tsx` / `ts-node` — run `.ts` without a separate build (transpile-only by
  default; add `tsc --noEmit` for checking).
- Node's native type stripping — runs TypeScript by erasing types; performs **no**
  type-checking and rejects runtime-emitting syntax (pairs with
  `--erasableSyntaxOnly`).

---

## What an Agent May Safely Infer

- `tsc --noEmit` is the authoritative type check; transpilers (esbuild/swc/Babel/
  Node strip) do not type-check.
- `strictNullChecks` off means `null`/`undefined` hide inside every type.
- `tsgo` (7.0) is the native `tsc` — same behavior, much faster.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are not in `strict`;
  enable them explicitly.

## What an Agent Must Not Infer Without Evidence

- That a green bundler/transpiler build means the types check — it usually does not.
- That `skipLibCheck` is safe for correctness — it can mask dependency type errors.
- That `@types` packages are auto-loaded on 6.0+ — they must be listed or imported.
- That ESLint alone type-checks, or that `tsc` alone lints — they are separate tools.

## What Requires Whole-Program Analysis

- Whether a project's real strictness matches assumptions (read the resolved
  `tsconfig`, including `extends`).
- Whether module resolution succeeds under the configured `moduleResolution` for a
  given import.
- Whether a transpile-only pipeline is silently shipping type-unsafe code.
