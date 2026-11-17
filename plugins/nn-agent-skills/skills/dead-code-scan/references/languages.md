# Languages

Per-language facts for finding roots, public API, and references. Fill in the
same facts for any language not listed.

**Verified:** `scripts/scan.test.mjs` runs the scan on fixtures. It checks the
declaration pattern and the visibility hint for TypeScript, Python, Go, Rust,
Java, C, and Julia, `main` detection for Go and Python, the dynamic-loading
pattern for Python, and the FFI pattern for Rust. **Guidance:** everything else
here, including JavaScript (same patterns as TypeScript, not tested apart) and
every language-server use, which no test exercised.

Ask the language server first for references, definitions, callers, overrides,
types, and unused diagnostics. Fall back to `rg` or `git grep` and reading.

| Language | Manifest and entry points | Public API marker | Test entry points | Language server |
| -------- | ------------------------- | ----------------- | ----------------- | --------------- |
| TypeScript, JavaScript | `package.json` `main`, `module`, `types`, `bin`, `exports`; `scripts`; build output maps to source by the bundler config | `export`; reachable from an entry through re-exports; no `exports` map means any file is importable | `*.test.*`, `*.spec.*`, `__tests__/`, jest, vitest, mocha configs and setup files | `typescript-language-server`, `tsserver` |
| Python | `pyproject.toml` `[project.scripts]` and entry points, `setup.py`, `__main__.py`, `if __name__ == "__main__"` | No underscore, listed in `__all__`, imported in `__init__.py`; the package is public if published | `test_*.py`, `*_test.py`, `conftest.py`, `tox.ini`, `noxfile.py` | `pyright`, `pylsp`, `ruff server` |
| Go | `go.mod`; `package main` with `func main`; `cmd/*` | Capitalized name in a non-`internal` package; `internal/` is private to the module | `*_test.go`, `TestMain` | `gopls` |
| Rust | `Cargo.toml` `[[bin]]`, `[lib]`, `src/main.rs`, `src/lib.rs`, `examples/`, `benches/`, `build.rs` | `pub`, and reachable through `pub use` and `pub mod` from the crate root; `pub(crate)` is private | `#[test]`, `tests/`, `#[cfg(test)]` modules | `rust-analyzer` |
| Java, Kotlin | `pom.xml`, `build.gradle(.kts)`, `public static void main`, `fun main`, `META-INF/services`, `module-info.java` | `public`, `exports` in `module-info.java`; annotation wiring (Spring, JPA, Jakarta) calls code by reflection | `src/test`, JUnit and TestNG annotations | `jdtls`, `kotlin-language-server` |
| C, C++ | `Makefile`, `CMakeLists.txt`, `meson.build`, `BUILD`; `main`; targets list the sources | Declared in a public header; exported by a symbol-visibility attribute or a linker script; `static` is private | `ctest`, `*_test.c*`, test targets | `clangd` |
| Julia | `Project.toml`, `src/<Package>.jl`, `runtests.jl`, `@main`, `PROGRAM_FILE` guard | `export`, `public`, and qualified use `Pkg.name`; methods extend generic functions defined elsewhere | `test/runtests.jl` | `LanguageServer.jl` |
| C#, Swift, Kotlin/Native, Dart, Scala, Ruby, PHP, Elixir | The project file (`*.csproj`, `Package.swift`, `pubspec.yaml`, `build.sbt`, `Gemfile`, `composer.json`, `mix.exs`) | The language's visibility keywords and its export or module list | The framework's test directory and runner configuration | The language's standard server (`omnisharp`, `sourcekit-lsp`, `metals`, `solargraph`, `intelephense`, `elixir-ls`) |

## Roots beyond the table

- **FFI and export attributes.** The name is used from another language or a
  binary: Rust `#[no_mangle]` and `extern "C"`, Go `//export`, C `__attribute__((visibility))`
  and `dllexport`, Java `native` and JNI, Julia `@ccallable`, Python C
  extensions, `wasm_bindgen`. The scan lists these under `ffi-exports`.
- **Reflection, plugins, string-keyed registries.** Java `Class.forName` and
  `ServiceLoader`, Go `reflect` and `plugin`, Python `importlib` and
  `getattr` on strings, Ruby `const_get`, JavaScript computed `import()`,
  Julia `include` with a variable. The scan lists these under `dynamic-loading`.
  Search for the registry keys when the scan flags one.
- **Annotation and decorator wiring.** A class that is never named but is
  registered by an annotation (Spring beans, dependency-injection modules, ORM
  entities, Angular and NestJS decorators, Python framework decorators, Rust
  attribute macros). The scan sees only the frameworks it lists.
- **Generated code.** Code generated from a schema or template, and the schema
  that names symbols the generator emits. Treat a generated file as a root for
  the names it contains, and the generator input as a root for the files it
  produces.
- **Build targets.** A source file listed in a build target is part of that
  target even when no source file names it. Read the build file.

## Notes by language

- **Go:** an exported name in `package main` is still unreachable from outside.
  Names in `_test.go` files count as test roots.
- **Rust:** a `pub` item in a private module is private. Check `pub use` from
  the crate root and `#[doc(hidden)]`.
- **Python:** there is no declared export list. Treat `public-by-convention` as
  published when the package is distributed, and read `__init__.py` and
  `__all__`.
- **Java:** package-private classes have no modifier; the scan marks them
  `unknown`. Methods are not scanned. Use find-references.
- **C and C++:** only keyword declarations in headers are scanned. Find unused
  functions with the linker (`-Wl,--gc-sections` map, `-Wunused`) or clangd
  references, and read the build file for what is compiled.
- **Julia:** methods on a function from another module add to its method table,
  so a method with one textual occurrence can still be called. Use the language
  server or read callers.
