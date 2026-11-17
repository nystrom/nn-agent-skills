# Language facts

The method in `SKILL.md` does not depend on a language. This file holds the
facts that do. Fill in the same columns for a language not listed here.

## What is verified and what is guidance

- Verified: `scripts/edges.mjs` extracts and resolves imports for TypeScript and
  JavaScript, Python, Go, Rust, Java and Kotlin, C and C++, and Julia on the
  small fixtures in `scripts/edges.test.mjs`. Each fixture asserts a few forms:
  TypeScript and JavaScript relative imports, `require`, dynamic `import()`, and
  `export ... from`; Python `import`, `from a.b import c`, `from . import b`,
  and relative `from .x import y`; Go single and grouped imports with a
  `go.mod` prefix; Rust `use crate::`, `pub use`, and `mod x;`; Java `import` and
  `import static`, and Kotlin `import`; C quoted and angle includes; Julia
  `include` and `using .M`. Every other form in the table, and larger repos,
  are guidance and not tested.
- Verified: `scripts/check.mjs` is tested on fixtures built from Python import
  edges and on hand-written edge lists. It never reads source code.
- Guidance: every manifest, workspace, test-naming, and language-server entry
  below. Check each against the repo before you rely on it.
- Resolution is an approximation. Python and Java match a dotted name to the
  first repo file with that path suffix. Go matches an import path to the
  longest repo directory suffix. A repo with two modules of the same suffix can
  resolve to the wrong one. Confirm a surprising edge by reading.

## Table

| Language | Import forms the extractor reads | Manifest and workspace | Test conventions | Barrel and re-export idioms | Language server |
| -------- | -------------------------------- | ---------------------- | ---------------- | --------------------------- | --------------- |
| TypeScript, JavaScript | `import ... from "x"`, `import "x"`, `import("x")`, `require("x")`, `export ... from "x"`; relative paths resolve with extension and `index` search | `package.json` (`dependencies`, `devDependencies`, `peerDependencies`); `workspaces` field or `pnpm-workspace.yaml`; `tsconfig.json` (`include`, `allowJs`, `extends`) | `*.test.*`, `*.spec.*`, `__tests__/` | `index.ts` with `export * from`, `export { a } from` | typescript-language-server, vtsls |
| Python | `import a.b`, `from a.b import c`, `from .x import y`, `from ..x import y` | `pyproject.toml`, `setup.cfg`, `requirements*.txt`; workspace tools such as uv workspaces | `test_*.py`, `*_test.py`, `tests/` | `__init__.py` importing from submodules (an import in `__init__.py` counts as a re-export) | pyright, pylsp |
| Go | `import "path"`, `import ( "path" ... )`; module path from `go.mod` | `go.mod`, `go.work`; `internal/` directories restrict importers by the compiler | `*_test.go` | none by syntax; a package that aliases another's types | gopls |
| Rust | `use crate::a::b`, `use super::x`, `pub use`, `mod x;` | `Cargo.toml` (`[dependencies]`, `[workspace]`) | `#[cfg(test)]` modules inside files, `tests/`, `*_test.rs` | `pub use` in `lib.rs` or `mod.rs` | rust-analyzer |
| Java, Kotlin | `import a.b.C;`, `import static a.b.C.m;`, `import a.b.*;` | `pom.xml`, `build.gradle(.kts)`, `settings.gradle(.kts)` | `*Test.java`, `*Tests.kt`, `src/test/` | no syntax; a facade class that delegates | jdtls, kotlin-language-server |
| C, C++ | `#include "x.h"` (angle includes are skipped); local path first, then path suffix | `CMakeLists.txt`, `Makefile`, `meson.build`, `BUILD` files; include directories | `*_test.c`, `*_test.cc`, `test/` | a public header that includes another module's header | clangd |
| Julia | `include("x.jl")`, `using .M`, `import .M` (module found by `module M` in the repo) | `Project.toml` (`[deps]`), `Manifest.toml` | `test/runtests.jl`, `test/` | `export` lists and `using .Sub` in the top module | LanguageServer.jl |

## Examples of the same rule

A production module imports a test module:

- TypeScript: `import { helper } from "./util.test.js"` in `src/prod.ts`.
- Python: `from tests.helpers import make` in `app/service.py`.
- Go: not expressible across packages; `_test.go` files are not importable, so
  look for a test helper package imported by non-test code.
- Rust: `use crate::tests::fixtures` outside a `#[cfg(test)]` module.
- Java: `import com.acme.FooTest;` in `src/main/java`.
- C: `#include "util_test.h"` in a non-test `.c` file.
- Julia: `include("../test/helpers.jl")` in `src/`.

A barrel re-exports another directory's module:

- TypeScript: `export { x } from "../other/x.js"` in `feature/index.ts`.
- Python: `from ..other import x` in `feature/__init__.py`.
- Rust: `pub use crate::other::x;` in `feature/mod.rs`.
- Others: read the module's public surface for definitions that live elsewhere.

A package imports a package it does not declare:

- Node: a workspace name in `import` that `package.json` omits.
- Python: an import of a sibling distribution missing from `pyproject.toml`.
- Rust: a path crate missing from `[dependencies]` (the compiler already fails
  on this; check only when the build is not run).
- Go: an import of another module in the workspace missing from `go.mod`.
- Java and Kotlin: a project dependency missing from the build file.
- Julia: a `using` of a package missing from `Project.toml`.

## Using a language server

Check whether one is configured or startable (an editor or agent integration, or
the server binary on the path). With one, ask for references of each exported
symbol, or for the import list of each document, and write the edges. Use
diagnostics to find unresolved imports. Record `evidence_source: "lsp"`. Without
one, use `scripts/edges.mjs`, or `rg` and `git grep` for the import forms above,
and read the code. Record `text` or `read`.
