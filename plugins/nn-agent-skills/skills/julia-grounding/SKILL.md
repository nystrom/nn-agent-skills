---
name: julia-grounding
description: >-
  Authoritative grounding in real Julia (1.6–1.13) semantics for coding agents:
  multiple dispatch and method selection, the type system and type stability,
  scoping and macros, toolchain (Pkg/JET/Revise), what changed across versions,
  error taxonomy, packaging, and footguns. Read before reasoning about,
  explaining, or editing Julia — it blocks analogical hallucination from other
  languages and version confusion. Pull the topic reference that matches the
  question.
---

# Julia grounding

Ground yourself in what Julia actually does — and in which version it does it —
before editing or explaining Julia code. Julia is not Python: dispatch, scoping,
1-based column-major arrays, and the mutation convention all differ. Read the
reference that matches your question:

| Question | Read |
|----------|------|
| What does this code actually do? (multiple dispatch, method selection, hard vs soft scope, closures, macros, broadcasting, modules) | `references/semantics.md` |
| Type hierarchy, abstract vs concrete, parametric types, `Union`, `where` clauses, type stability, constructors | `references/types.md` |
| Base and stdlib function names, mutation convention (`!`), what needs `using`, what is **not** in stdlib | `references/stdlib.md` |
| Pkg.jl, JuliaFormatter, JET.jl, Aqua.jl, Revise.jl, Cthulhu.jl, BenchmarkTools | `references/toolchain.md` |
| What changed in 1.6–1.13; package extensions, native code caching, ScopedValues, redefinable types, FieldError; compat bounds | `references/versions.md` |
| Why did this fail? (MethodError, BoundsError, UndefVarError, InexactError, OverflowError) | `references/errors.md` |
| Footguns: type instability from globals, soft scope, 1-based indexing, column-major arrays, integer overflow, broadcasting | `references/sharp-edges.md` |
| Pkg.jl programmatic API — never write UUIDs by hand; add/rm/update/develop, Project.toml compat, environments | `references/packages.md` |

## Grounding the Active Version

Whenever writing, editing, or explaining Julia code, you **MUST** first determine the active Julia version to reference the correct version-specific features and syntax.

To detect the active Julia version and environment:
1. Check `Project.toml` or `JuliaProject.toml` in the workspace for the `[compat]` section (e.g. `julia = "1.10"`).
2. If the files are missing or the version is ambiguous, check `Manifest.toml`.
3. If still unresolved, run:
   ```bash
   julia --version
   ```

## What an agent must not infer

Do not assume Julia behaves like Python, MATLAB, or any language you were trained
on, and do not assume a feature exists in every version. Each reference has a
"What an agent may/must not infer" section — consult it rather than
pattern-matching across languages or Julia versions.
