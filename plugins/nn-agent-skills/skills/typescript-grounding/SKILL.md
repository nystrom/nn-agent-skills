---
name: typescript-grounding
description: >-
  Authoritative grounding in real TypeScript (5.x–7.0) semantics for coding
  agents: structural typing, the type-vs-value world, control-flow narrowing,
  generics and conditional/mapped/template-literal types, the toolchain (tsc,
  the Go-native tsgo, tsconfig, typescript-eslint), what changed across versions
  through the 7.0 native port, and the type system's footguns and unsound spots.
  Read before reasoning about, explaining, or editing TypeScript — types are
  erased at runtime, so grounding in what the checker actually proves (and what
  it does not) prevents both runtime surprises and version confusion. Pull the
  topic reference that matches the question.
---

# TypeScript grounding

Ground yourself in what the TypeScript checker actually proves — and in which
version — before editing or explaining TypeScript. Types are **erased** before
execution: they constrain the compiler, not the runtime. A construct that
type-checks can still throw, and TypeScript's type system is deliberately unsound
in specific, known places. Read the reference that matches your question:

| Question | Read |
|----------|------|
| What does this mean to the checker? (structural typing, type vs value space, narrowing, declaration merging, assignability, `this`, erasure) | `references/semantics.md` |
| Generics, variance, conditional types, `infer`, mapped types, template literal types, key utility types | `references/types.md` |
| Footguns: `any` vs `unknown`, excess-property checks, enum quirks, `as`/`as const`, `{}` and `object`, array covariance, `this` typing, `NaN` | `references/sharp-edges.md` |
| What changed across 5.x, 6.0, and the 7.0 native port; removed options; migration | `references/versions.md` |
| tsc, the Go-native `tsgo`, key `tsconfig` options, `typescript-eslint`, project references | `references/toolchain.md` |

## Grounding the Active Version

Whenever writing, editing, or explaining TypeScript code, you **MUST** first determine the active TypeScript compiler/runtime version to ensure compatibility with config options and type features.

To detect the active TypeScript version and environment:
1. Check `package.json` under `dependencies` or `devDependencies` (look for `"typescript"`).
2. Look at the lockfile (`package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`).
3. If still unresolved, run:
   ```bash
   npx tsc --version
   # or when using tsgo:
   tsgo --version
   ```

## What an agent must not infer

Do not assume TypeScript behaves like Java, C#, or Flow, and do not assume types
exist at runtime — there is no reflection over erased types, and `instanceof`
works on values, not interfaces. Do not assume a compiler option or syntax valid
in one version is valid in another: 6.0 removed a batch of legacy options and 7.0
deleted them. Each reference has a "What an agent may/must not infer" section —
consult it rather than pattern-matching across languages or versions.
