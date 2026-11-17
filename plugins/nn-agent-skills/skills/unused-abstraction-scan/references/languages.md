# Language guide

What is verified and what is guidance:

- **Verified** means `scripts/survey.mjs` is exercised on a fixture in
  `scripts/survey.test.mjs`. Verified: `//` and `#` comment detection in
  TypeScript, Python, and Go fixtures; the test-file rule for `*.test.ts`; the
  empty-type forms marked below; manifest reading for `package.json`,
  `Cargo.toml`, `pyproject.toml`, and `go.mod`; the Go `internal/` rule. The
  test-file rules for other languages, and comment markers other than `//` and
  `#`, are guidance.
- **Guidance** means the row is advice for the model. No test or run in this
  skill covers it. In particular, no language server was run: the server names
  and the diagnostics below are guidance. Check them in the target repository.

For a language not listed, fill the same columns from the language's
conventions and say that you did.

## Forms by language

| Language | Options or config type | Unused-parameter convention | Test files (helpers treat as tests) | Manifest and privacy |
| -------- | ---------------------- | --------------------------- | ----------------------------------- | -------------------- |
| TypeScript, JavaScript | `interface X {}` (verified), object type, `type X = {}` | `_name`, lint `argsIgnorePattern` | `*.test.*`, `*.spec.*`, `__tests__/` | `package.json`, `"private": true` (verified) |
| Python | `class X: pass` (verified), `@dataclass` with no fields | `_name`, `_` | `test_*.py`, `*_test.py`, `tests/` | `pyproject.toml`, classifier `Private :: Do Not Upload` (verified) |
| Go | `type X struct{}` (verified) | `_` | `*_test.go` | `go.mod`, `internal/` directory (verified) |
| Rust | `struct X;` and `struct X {}` (verified) | `_name` | `tests/`, inline `#[cfg(test)]` (guidance) | `Cargo.toml`, `publish = false` (verified) |
| Java, Kotlin | `class X {}` (verified for braces), `record X()`, Kotlin `class X` with no body (guidance) | none standard; static analysis | `src/test/`, `*Test.java`, `*Test.kt` | `pom.xml`, `build.gradle(.kts)`; no private flag (guidance) |
| C, C++ | `struct X {};` (verified) | unnamed parameter, `[[maybe_unused]]` | `*_test.cc`, `test_*.cpp`, `tests/` | `CMakeLists.txt`, `Makefile`; none read (guidance) |
| Julia | `struct X end` (verified) | `_name`, `_` | `test/`, `runtests.jl` | `Project.toml`; no private flag (guidance) |

The `empty-types` command lists only the forms marked verified. A form it does
not list needs a manual search.

## Language servers (guidance)

Check configuration first, then startability (`command -v <server>`). A server
gives find-references, document and workspace symbols, call hierarchy, and
diagnostics for unused parameters and variables.

| Language | Server | Unused diagnostics (guidance) |
| -------- | ------ | ----------------------------- |
| TypeScript, JavaScript | `typescript-language-server`, `vtsls` | "declared but never used" (code 6133) when `noUnusedParameters` is on |
| Python | `pyright-langserver`, `pylsp`, `ruff server` | unused variable and argument rules |
| Go | `gopls` | `unusedparams` analyzer |
| Rust | `rust-analyzer` | `unused_variables` warning |
| Java | `jdtls` | unused variable and parameter warnings |
| Kotlin | `kotlin-language-server` | unused parameter warning |
| C, C++ | `clangd` | `-Wunused-parameter`, clang-tidy |
| Julia | `LanguageServer.jl` | unused argument and variable lints |

If the server's find-references result disagrees with a text search, trust the
server for resolved symbols, and read the code for the difference.

## Visibility notes (guidance)

- **Go:** an unexported (lowercase) identifier does not leave its package.
- **Rust:** an item without `pub`, or `pub(crate)`, does not leave the crate.
- **Python:** a leading underscore marks a name private by convention. A
  module can still be imported.
- **Java, Kotlin:** `private` and package-private stay inside the package or
  class. `public` and `protected` can be used outside it.
- **TypeScript:** `export` makes a name importable. Whether it leaves the
  package depends on the package entry point and on `"private"`.
- **C, C++:** a name declared in a header may be included by other targets.
- **Julia:** a name is public only if exported or marked `public`; any name is
  reachable through its module.

`verdict` reads manifests, not visibility keywords. Apply these notes by
reading the declaration.
