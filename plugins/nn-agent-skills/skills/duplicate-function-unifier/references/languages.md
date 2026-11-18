# Languages

Per-language facts for the scan and for your own reading. "Verified" means
`scripts/scan.test.mjs` runs the rule on a fixture in that language. Everything
else in this file is guidance: the model fills in languages not listed, and
treats any result in an unverified language as a lead.

## What the script reads

| Language | Extensions | Comments | Boundary rule | Verified |
| -------- | ---------- | -------- | ------------- | -------- |
| JavaScript, TypeScript | js jsx mjs cjs ts tsx mts cts | `//` `/* */` | braces: `function`, methods, `=> {` bound to a name | yes |
| Python | py | `#` | indentation after `def` | yes |
| Go | go | `//` `/* */` | braces after `func`, receivers skipped | yes |
| Rust | rs | `//` nested `/* */` | braces after `fn` | yes |
| Java | java | `//` `/* */` | braces, method-shaped headers | yes |
| C | c h | `//` `/* */` | braces, method-shaped headers | yes |
| Julia | jl | `#` nested `#= =#` | `function` to its `end` | yes |
| Ruby | rb | `#` | `def` to its `end` | yes |
| C++ | cc cpp cxx hpp hh | `//` `/* */` | braces, method-shaped headers | no |
| Kotlin | kt kts | `//` nested `/* */` | braces after `fun` | no |
| C# | cs | `//` `/* */` | braces, method-shaped headers | no |

Bodies compare only within one language. Lines of source that no rule above
covers (for example Swift, Scala, PHP, Lua, Elixir, Haskell, shell) are counted
in `unscanned` when the extension is common, and you read them yourself.

Known limits of the rules: a C++ constructor initializer list, a preprocessor
block that changes braces, and Python decorators are not modeled. Rust raw
strings (`r#"..."#`) and JavaScript regex-like divisions can unbalance brackets;
the file is then listed in `skipped`. A one-line definition is not compared.

## Visibility rules (used for the consumer verdict)

| Language | Exported when | Otherwise |
| -------- | ------------- | --------- |
| JavaScript, TypeScript | header has `export`, or an `export { name }`, `export default name`, or a CommonJS export appears in the file; a class or object method is `unknown` | internal |
| Python, Julia, Ruby | name does not start with `_` | internal |
| Go | name starts with an upper-case letter | internal |
| Rust | header has `pub`; a function indented inside a block (trait or impl) is `unknown` | internal |
| Java, Kotlin, C# | header has no `private` | internal |
| C, C++ | header has no `static` | internal |
| other | not known | `unknown` (refuses the group) |

A function nested inside another is internal. These rules ignore re-exports
under a different name, package-private access, and visibility set by a
separate declaration; the reviewer checks them.

## Manifests the script reads

| Manifest | Name and dependencies read | Dev dependencies |
| -------- | -------------------------- | ---------------- |
| `package.json` | `name`, `dependencies`, `peerDependencies` | `devDependencies` |
| `Cargo.toml` | `name`, `[dependencies]`, `[build-dependencies]` | `[dev-dependencies]` |
| `go.mod` | `module`, `require` paths | none |
| `Project.toml` | `name`, `[deps]` | none |
| `pyproject.toml` | `name`, `dependencies` array | none |

Other manifests (`pom.xml`, `build.gradle`, `CMakeLists.txt`, `*.csproj`,
`mix.exs`, `Gemfile`, `composer.json`, `Package.swift`) mark a package
boundary but their dependencies are not read, so a group across two such
packages is refused. Inside one package no manifest is needed.

## Test-file patterns

The script treats a path as a test when it matches `*_test.*`, `*.test.*`,
`*.spec.*`, `test_*.py`, `*Test.java`, `*Tests.cs`, `src/test/`, or a `test`,
`tests`, `spec`, or `__tests__` directory. Add the project's own convention
when you read the findings.

## Language servers

Common servers, for the evidence step in `SKILL.md`. Check what the
environment has configured before you assume one exists.

| Language | Servers |
| -------- | ------- |
| TypeScript, JavaScript | typescript-language-server, tsserver |
| Python | pyright, pylsp, jedi-language-server |
| Go | gopls |
| Rust | rust-analyzer |
| Java | jdtls |
| Kotlin | kotlin-language-server |
| C, C++ | clangd |
| C# | OmniSharp, csharp-ls |
| Julia | LanguageServer.jl |
| Ruby | solargraph, ruby-lsp |

## Language idioms to read for

Facts the model supplies when the script cannot:

| Topic | TypeScript | Python | Go | Rust | Java/Kotlin | C/C++ | Julia |
| ----- | ---------- | ------ | -- | ---- | ----------- | ----- | ----- |
| Same logic, different shape | `for` against `map` | comprehension against loop | `for range` against helper | iterator chain against loop | stream against loop | macro against function | broadcast against loop |
| Dispatch family | overloads, `switch` on a tag | `singledispatch`, per-type methods | per-type functions | trait impls per type | overloads, `when` | overloads, templates | methods on types |
| Type widening | union, generic | `Protocol`, `Union` | interface, generic | trait bound, generic | supertype, generic | template parameter | abstract type, parametric method |
| Where tests live | `*.test.ts` | `test_*.py` | `*_test.go` | `#[cfg(test)]`, `tests/` | `src/test/` | `tests/`, gtest files | `test/runtests.jl` |
