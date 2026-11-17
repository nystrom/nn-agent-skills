# Check catalog

One entry per check in `scripts/scan.mjs`, with the rule it applies, what it
sees, and where the model must look instead. A tool that proposes deletions and
fires on a guess asks for working code to be deleted, so each bound errs toward
refusal. The scan is text based and has no language parser.

## Reference index

Every identifier token in every text file git lists (tracked, or untracked and
not ignored), in any language: `[\p{L}_$][\p{L}\p{N}_$]*` over the file text.

- Comments and strings count as references. The scan over-counts references and
  under-reports dead code.
- Docs, templates, schemas, and config files count, because they can name a
  symbol.
- Ignored paths (dependencies, build output, nested worktrees) are not read.
  Stale copies of the repository would make every symbol look live.
- Symlinks are skipped, and `--out` may not be a symlink or sit inside the
  repository, so the scan cannot write through a link into the code under review.
  Binary files (a NUL byte in the first 8000 bytes) are
  counted by extension in `binary_file_types`. Files over `--max-file-bytes` are
  listed in `skipped_files`. A file the scan cannot read stops the run, because
  a missing file lowers counts.
- A token is the name only. A qualified use (`pkg.Name`), a renamed import, and
  a name built at run time are not tied to a declaration. A name shared by two
  unrelated symbols counts as used for both.

## `dead-export`

A declaration line whose name occurs exactly once in the index, which is its own
declaration.

- Declaration pattern: optional modifiers, then one of `function`, `def`, `fn`,
  `func`, `fun`, `class`, `struct`, `interface`, `trait`, `enum`, `type`,
  `typedef`, `typealias`, `const`, `let`, `var`, `val`, `object`, `module`,
  `macro`, `mutable struct`, `abstract type`, `primitive type`, `record`,
  `union`, `protocol`, `extension`, then the name. A Go receiver is skipped.
- Out of reach: declarations with no keyword on the line (C and C++ functions,
  Java methods, Go declarations inside a `type (` block, Julia short-form
  functions) and declarations that continue from a previous line. The model
  reads for these.
- Whole repository, not only other files: a name used in its own file occurs
  twice and is not a candidate. An interface named by a union in the same file
  is the case this rule exists for, because the union is what leaves the package.
- Visibility hint from the line alone, by language of the file extension:

  | Language | `exported` | `private` (not a candidate) |
  | -------- | ---------- | --------------------------- |
  | TypeScript, JavaScript | `export` modifier | no `export` |
  | Rust | `pub` | no `pub` |
  | Go | column 0, capitalized name | otherwise |
  | Python | `public-by-convention`: column 0, no leading `_` | otherwise |
  | Java, Kotlin, Scala, C#, Swift, Dart | `public`, `open`, `protected`, `internal`; `unknown` with no modifier | `private` |
  | C, C++ | column 0 in a header | other files |
  | Others | `unknown` at column 0 | indented |

  The hint is not a visibility verdict. A package can publish less (an exports
  map, a build visibility rule) or more (a re-export) than the line says.
  Private declarations are not candidates: the compiler or a linter reports
  unused ones in most languages (`noUnusedLocals`, `unused` lints, `go vet`,
  `-Wunused`). Check that the project enables one.
- Default exports are not candidates: the importer picks the name.

## `dead-reexport`

A re-export line (`export {` / `export *` / `export type {`, `pub use`,
`from M import`, `__all__`, `module.exports`) naming a token that occurs in
exactly two files, two times in all: the re-exporting file and one other.

- It is separate from `dead-export` because the name occurs twice there. The
  proposed change is smaller: delete the re-export and keep the declaration.
- The scan does not check that the other file declares the name. The model does.
- Glob re-exports (`export *`, `pub use x::*`, `from x import *`) carry every
  name and say nothing about which of them anyone wants.

## Roots

A root is a place code is entered from. The scan lists those it recognizes in
`roots.found` and `roots.unresolved`.

Found (the text of these is in the reference index, so every name they use
counts as a reference):

| Id | Source |
| -- | ------ |
| `manifests` | Package and build manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `build.gradle*`, `Project.toml`, `Package.swift`, `*.csproj`, and others) |
| `package-entry` | Strings under `main`, `module`, `types`, `bin`, `exports` in `package.json`. Other manifest formats are listed under `manifests` and read by the model. |
| `main-entry` | Lines that look like a `main` function, an `if __name__ == "__main__"` guard, or a script shebang |
| `build-and-ci-references` | Source and shell files whose path appears in a manifest, Makefile, script, or CI file |
| `tests` | Test files by name and directory convention, and test setup files |
| `tool-configs` | Files such as `*.config.js`, `conftest.py`, `build.rs` |
| `docs-and-data` | Every other readable text file |
| `other-repositories` | The cross-repository search, or the caller's assertion that there are none |

Unresolved (cannot be evaluated by counting names, so each blocks the candidates
it may load):

| Id | Blocks | Detected by |
| -- | ------ | ----------- |
| `framework:<name>` | Files at that framework's load paths | A manifest names the framework (Next, Nuxt, Remix, SvelteKit, Astro, Gatsby, Storybook, serverless, Django, Rails, Spring) and files match its paths |
| `convention-directory:<dir>` | Files under `migrations`, `seeds`, `plugins`, `handlers`, `commands`, `routes`, `api`, or `middleware` | The directory exists |
| `dynamic-loading` | Files in the same package directory as the loader | Computed `import`/`require`, `import.meta.glob`, `importlib`, `Class.forName`, `ServiceLoader`, `plugin.Open`, `MethodByName`, `dlopen`, `LoadLibrary`, Julia `include` with a computed path, `const_get` |
| `ffi-exports` | The file with the attribute | `#[no_mangle]`, `extern "C"`, `//export`, `@JvmStatic`, `JNIEXPORT`, `dllexport`, `visibility` attributes, `@ccallable`, `#[pyfunction]`, `#[wasm_bindgen]` |
| `manifest` | Files with no manifest or build file (`Makefile`, `CMakeLists.txt`, `BUILD`, `justfile`, `meson.build`) in their directory or an ancestor | A source file the nearest manifest does not own |
| `unread-files` | Every candidate | A file over `--max-file-bytes`, so its references are not counted |
| `other-repositories` | Nothing by itself; every candidate is `unknown` | `gh` missing, not authenticated, or the owner unknown |

`--accept-root <id>` moves an unresolved root to found, with the detail marked
as accepted by the caller. `--accept-root <id>:<path>` lifts the block only for
files under `<path>` and leaves the root unresolved for the rest. Use it only
after the user said what the root loads. `--accept-root other-repositories`
means `--no-external`.

The lists are fixed. A framework, build system, or loader outside them is
invisible to the scan, so the model reads for it (step 1 and 3 in SKILL.md).
Package directories come from the nearest manifest. Mapping build output to
source (for example `dist/` to `src/`) is not attempted; the model reads the
build configuration when it matters.

## Cross-repository search

For each distinct candidate name that no local rule refused:

- `gh search code <name> --owner <owner> --json repository,path --limit 100`.
  The owner is `--org` or the owner of the `origin` remote. Hits in the current
  repository are ignored. Any other hit gives `exported-with-hits`.
- Only repositories of that one owner are searched. A consumer under another
  owner is invisible, and `external: none` says only that the owner has none.
- Code search matches tokens, so a hit can be a different symbol with the same
  name. That refuses more and never less.
- A result of 100 rows is capped. A capped result whose rows all belong to the
  current repository gives `unknown`, because other repositories can lie beyond
  the cap.
- A failure (no `gh`, not authenticated, unknown owner, a rate limit after two
  retries, the `--max-external` limit) gives `unknown`. A failed search never
  reads as "no hits".

## Local refusals

Applied before the search, in this order. The first match is the recorded
category. See SKILL.md for the table. Two are text heuristics:

- `side-effect-initializer` fires when a `const`, `let`, `var`, `val`, or
  `static` line has a call on its right-hand side (after removing arrow and
  function expressions) or declares several names on one line. It does not see
  effects in languages where a plain declaration runs code (static initializers,
  decorators, annotations, macros, `init` functions, constructors of globals).
  The model reads those.
- `doc-in-directory` and `test-support` use directory names only.

## Not checked

- Non-exported unused declarations: compilers and linters own them.
- Unreachable code inside a function and unused parameters: these need
  control-flow analysis, which a language server or compiler gives.
- A file nothing imports: the sum of this scan's findings for the symbols in the
  file. A separate report would count each twice.
- Dead tests, and fixtures only a dead test uses.
- Unused dependencies in a manifest: another signal with another consumer
  question.
- Dead cycles: two symbols that reference only each other occur twice or more.
  The model finds these with call hierarchy or find-references.
