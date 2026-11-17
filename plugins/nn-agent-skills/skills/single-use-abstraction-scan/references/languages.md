# Language guide

What is verified and what is guidance:

- **Verified** means `scripts/scan.mjs` is exercised on a fixture in
  `scripts/scan.test.mjs`. Verified for TypeScript and JavaScript (tested as
  TypeScript), Python, Go, Rust, Java, Kotlin, C and C++ (tested as C++ and C),
  and Julia: every declaration form in the table below is found and counted
  once; comment lines are skipped in both comment families; the visibility hint
  of each language. Verified for single languages: the `single-impl` pattern in
  TypeScript, Rust, Java, and Julia; the multi-line import list and the
  `export { .. } from` re-export in TypeScript; the C prototype rule; the Julia
  `!` suffix; manifest reading for `package.json`; the Go `internal/` rule.
  Not verified: the import rules of Python, Go, Rust, Java, Kotlin, and Julia;
  the `single-impl` patterns of Python, Kotlin, and C++; the privacy flags of
  `Cargo.toml`, `pyproject.toml`, and the other manifests.
- **Guidance** means the row is advice for the model. No test or run in this
  skill covers it. In particular, no language server was run: the server names
  below are guidance. Check them in the target repository.

For a language not listed, fill the same columns from the language's conventions
and say that you did. Pass its declaration form with `--decl`, for example
`--decl '^\s*def\s+(?<name>\w+)'` for Ruby. The script then lists those
declarations as `custom`, with no visibility, import, or body rules beyond the
generic ones.

## Declaration forms in the table

`scan.mjs forms` prints the regular expressions. The table row says which
declarations each language lists.

| Language | Listed forms | Visibility hint | Import and export lines not counted as uses |
| -------- | ------------ | --------------- | -------------------------------------------- |
| TypeScript, JavaScript | `function`, `const f = (..) =>`, `class`, `interface`, `type X =`, indented methods ending in `{` | `export` is exported; `private` or `#` is private | `import`, `export {..}`, `export * from`, multi-line lists |
| Python | `def`, `class` (nested `def` in a class is a method) | leading `_` is private | `import`, `from x import`, multi-line `( .. )` lists |
| Go | `func`, methods with a receiver, `type X interface`, `type X struct`, `type X <type>` | uppercase is exported | `import` lines |
| Rust | `fn`, `struct`, `enum`, `trait`, `type X =` | `pub` is exported; `pub(crate)` and none are private | `use`, `pub use`, multi-line `{ .. }` lists |
| Java | `class`, `interface`, `enum`, `record`, methods with a return type | `private` is private; `public` and `protected` are exported | `import` |
| Kotlin | `fun` (with receivers), `class`, `interface`, `object`, `typealias` | `private` and `internal` are private | `import` |
| C, C++ | column-0 function definitions, `struct`, `class`, `union`, `enum`, `using X =` | `static` is private; a header is exported | `#include`, prototypes |
| Julia | `function f(`, short form `f(x) =` at column 0, `struct`, `abstract type` | a name in `export` or `public` is exported | `using`, `import`, `export` |

Forms that the table does not list: Go grouped `type ( .. )`, Rust declarations
in macros, TypeScript `enum` and `namespace`, Kotlin `fun interface`, C and C++
function definitions that start indented or span the name across lines,
Julia functions defined with `Base.name`, and declarations in any language not
in the table.

## Test-file rules

The script treats these as tests: a directory named `test`, `tests`, `spec`,
`__tests__`, `__mocks__`, `e2e`, or `testing`; `src/test/`; `*.test.*`,
`*.spec.*`, `*_test.*`, `*_spec.*`, `test_*.py`, `*Test.java`, `*Tests.java`,
`*IT.java`, the same for Kotlin, Scala, and C#; `test_*` and `*_test` in C and
C++; `runtests.jl`. Verified: `*.test.ts` and the `test/` directory rule. The
other rules are guidance. Inline Rust tests (`#[cfg(test)]` modules) count as
production code, so a use from them looks like a production use.

## Language servers (guidance)

Check configuration first, then startability (`command -v <server>`). A server
gives find-references, find-implementations, call hierarchy, and document and
workspace symbols.

| Language | Server |
| -------- | ------ |
| TypeScript, JavaScript | `typescript-language-server`, `vtsls` |
| Python | `pyright-langserver`, `pylsp`, `ruff server` (no find-implementations in the last) |
| Go | `gopls` (find-implementations covers structural implementations) |
| Rust | `rust-analyzer` |
| Java | `jdtls` |
| Kotlin | `kotlin-language-server` |
| C, C++ | `clangd` |
| Julia | `LanguageServer.jl` (no call hierarchy) |
| Others | search the language's documentation for its server, then `command -v` it |

If the server's find-references result disagrees with a text search, trust the
server for resolved symbols, and read the code for the difference.

## Notes for the gates (guidance)

- **Go:** an unexported (lowercase) identifier does not leave its package, so
  `public-api` does not apply to it. A Go interface is satisfied structurally:
  use `gopls` find-implementations, because the script finds no implementers.
  Small interfaces at a consumer are an idiom for a seam.
- **Rust:** an item without `pub`, or `pub(crate)`, does not leave the crate. A
  trait with one implementation can be a seam for tests or a bound for generic
  code. Check for generic functions that take `impl Trait` or `T: Trait`.
- **Python:** a leading underscore marks a name private by convention. A
  module can still be imported. Decorated functions are registered by name:
  the `dynamic` gate applies. An abstract base class with one subclass can be a
  plugin point.
- **Java, Kotlin:** `private` and package-private stay inside the package or
  class. A framework (Spring, JUnit, Jackson) can reach `public` and annotated
  members by reflection. An interface with one implementation is common
  because of dependency injection and mocking: look for a mock or a second
  bean before you report.
- **TypeScript, JavaScript:** `export` makes a name importable. Whether it
  leaves the package depends on the package entry point and on `"private"`. A
  single-use interface can be a structural type for object literals in tests.
  Class methods called through a decorator or a framework lifecycle are
  `dynamic`.
- **C, C++:** a name declared in a header may be included by other targets. A
  virtual method with one override is a `override-or-interface-contract` case.
  Macros can hide uses.
- **Julia:** a name is public only if exported or marked `public`; any name is
  reachable through its module. Methods share one name across signatures, so
  the script lists such a name as `ambiguous`. An abstract type with one
  subtype can serve dispatch: read the method signatures.
