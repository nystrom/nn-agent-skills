# Check catalog

One entry per check in `scripts/scan.mjs`. Each entry gives the rule, the reason
for it, the bounds of what the scan sees, and what it does not report. A check
without a stated reason is a guess about the codebase, and a guess that fires is
a bug report against correct code.

The scan reads text with regular expressions. It has no parser and no module
resolver. Imports are found in static `import` and `export ... from`,
`import()`, and `require()` forms, after block comments and `//`
comments are blanked. A `//` counts as a comment only when an even number of
quote characters precede it on the line. A string that looks like an import inside code is a false
match. Files over 2 MB, unreadable files, symlinks, and the directories
`node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.turbo`,
`.claude`, and `target` are not scanned. Skipped files that failed to read are
listed in `skipped_files`.

Packages come from the root manifest `workspaces` field or `pnpm-workspace.yaml`
when present, and from every `package.json` outside the ignored directories
otherwise. Workspace patterns support `*`, `**`, and `!` exclusions. Brace
alternatives are not supported. The YAML reader handles only a `packages:` list
of `- pattern` lines. Files that fail to read are not scanned by any check. When member packages exist, the root manifest is not a package.

## `test-import`

A non-test module imports a module whose specifier ends in `.test`, `.spec`, or
contains `/__tests__/`.

- Why: layering rules and lint zones commonly skip test files, on the premise
  that a test is a sink that nothing imports. A production import of a test
  module breaks that premise and reaches whatever the test reaches, with no
  zone in the way.
- Refused: a file under a directory named `test`, `tests`, `__tests__`, or
  `testing`. Such a file is test support and re-exports test helpers on
  purpose. It is reported with severity `low` and `refused: true`.
- Bound: relative specifiers only. A package that imports another package's
  test entry through a bare specifier is not found.

## `unchecked-source`

A `.js`, `.jsx`, `.mjs`, or `.cjs` file under a package's `src/`, in a package
whose nearest `tsconfig.json` (searched upward from the package) does not
contain `"allowJs": true`.

- Why: `tsc` reads only the extensions it is configured for, and lint scripts
  often target `.ts` only. An import inside such a file is checked by neither.
- Severity: `medium` when another scanned file imports it, `low` otherwise.
- Bound: the scan tests `allowJs` with a text match on the nearest
  `tsconfig.json`. A value inherited through `extends` is not seen, so a
  package that enables `allowJs` in a base config gets a false report. It does
  not read lint config. Packages with no `tsconfig.json` are skipped. Test
  files are skipped.

## `undeclared-package-dep`

A package imports a workspace package that its manifest does not list in
`dependencies`, `devDependencies`, `peerDependencies`, or
`optionalDependencies`.

- Why: workspace hoisting puts every package in the root `node_modules`, so the
  import resolves inside the repo. It fails when the package is published and
  installed on its own.
- Production and test use are separate. A package imported only from tests
  belongs in `devDependencies`, and the proposal says so. When production code
  also imports it, only the production finding is reported.
- Bound: the check asks whether an edge is declared, not whether it points the
  right way. A declared edge that inverts the intended package order passes.
  Only names that match another workspace package's `name` are checked; an
  undeclared third-party package is not.

## `foreign-barrel-reexport`

An `index.{ts,tsx,js,mjs,cjs,...}` file with `export * from`, `export * as x
from`, or `export { ... } from` a specifier that starts with `../`.

- Why: every consumer of the barrel then depends on the other directory, and
  the barrel misstates which directory owns the symbol.
- Bound: files named `index` only. A barrel with another name is not found. A
  comment may justify the re-export, for example to keep a published surface
  after a symbol moved. A reviewer weighs that argument, so report it as a
  question and do not decide.

## `dependency-doc-drift`

A dependency-table document that omits an edge the code has.

- Discovery: files named `DEPENDENCIES.md`, `LAYERS.md`, `LAYERING.md`, or
  `ARCHITECTURE.md` (any case), or the file given with `--doc`. The skip is
  recorded in `skipped_checks` when no document exists or no row matches.
- Rows: a table row `| name | a, b |` is a row when `name` (without `*`, `_`,
  or backticks) is a directory that sits next to the document. The second cell
  lists the directories it may import, separated by commas. `_(none)_` means
  none. Rows under a heading that contains "test" are skipped. When a directory
  has several rows, their entries are united.
- Method: each relative specifier in a production file under that directory is
  resolved against the importing file, then reduced to its first directory next
  to the document. A specifier such as `../binding/x` inside `language/typing`
  resolves to `language/binding`, which is the same directory as the importer's
  and not an edge.
- Bound: one direction only. A row that lists an edge the code no longer has is
  not reported. A table that over-declares does not mislead readers about what
  is allowed, and fixing it is a judgment about intent. A table layout that
  differs from the row shape above is not read. A document in prose is not read.
- The imports are the fact and the table is the summary. The proposal is to
  update the row, or to move the import when the edge should not exist.

## Repo-specific rules without a check

Some layering rules exist in one repo only and have no generic form. Examples:
a rule that a code-generation helper must not wrap a composed template literal,
and a rule that every lint disable for one named project rule carries a reason.
The scan has no check for such rules. Add one through the extension point below
when the repo writes the rule down.

## Extension point

A repo rule that nothing enforces can become a check. Add a function to the
`CHECKS` array in `scripts/scan.mjs`. It takes the scan context and returns
findings.

The context has `root`, `files` (all root-relative POSIX paths), `sourceFiles`,
`texts` (path to file text), `imports` (path to `[{specifier, line}]`),
`packages` (`{dir, name, declared, manifestPath}`), and `options`. A finding
needs `check`, `severity`, `file`, `signal`, `evidence`, and `proposal`; use the
`finding()` helper to add `id` and `refused`.

Cite the document that states the rule in `evidence`. A rule with no written
source is a guess. Test the new check in `scripts/scan.test.mjs` with a fixture
that has one violation and one lookalike that must not fire.

## Not checked here

- The layer stack itself. When a repo enforces it with lint zones, a second
  implementation that reads prose would be a weaker answer to a solved
  question.
- Circular imports. Use the repo's own cycle tool (`madge --circular` or
  similar).
- Whether a package-level edge points the right way.
