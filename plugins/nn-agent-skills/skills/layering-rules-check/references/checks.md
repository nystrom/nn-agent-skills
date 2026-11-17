# Check catalog

One entry per check in `scripts/check.mjs`. Each entry gives the rule, the reason
for it, the bounds of what the check sees, and what it does not report. A check
without a stated reason is a guess about the codebase, and a guess that fires is
a bug report against correct code.

A script result is a candidate. It shows that a supplied or extracted edge, taken as
correct, breaks the rules file. Text extraction and file resolution are
approximations, an edge list is accepted as given, and the rules file can be
wrong. None of this shows that the edge matters. The model reads the code and the callers to confirm,
downgrade, or drop each candidate, and reads what the "Bound" lines below leave
out (`SKILL.md`, "What the scan cannot see").

The checks read an edge list and a rules file (`references/rules.md`). They have
no parser and no knowledge of any language. Edges from a language server carry
`evidence_source: "lsp"`. Edges from `scripts/edges.mjs` carry `text`: a regex
read of import statements with comments blanked (a `//` counts as a comment only
when an even number of quote characters precede it on the line). Files over
2 MB, unreadable files, symlinks, and the directories `.git`, `node_modules`,
`dist`, `build`, `out`, `coverage`, `target`, `vendor`, `__pycache__`, `.venv`,
`.next`, `.turbo`, and `.claude` are not read. Skips that failed are listed in
`skipped_files`. A file that is symlinked or skipped yields no edges and no
findings.

In diff mode (`--diff`, `--changed-file`) the checks run on all edges, and a
finding is kept when its file, its `target`, or an import it summarizes is in
the changed set. A finding whose cause is a deleted file or a moved module has
no changed file on either side and is not kept; read the importers of old paths
yourself.

## `test-import`

A non-test file has an edge to a test file. A file is a test file when it
matches `test_globs`, or the default name patterns when the rules file has none
(`*.test.*`, `*.spec.*`, `__tests__/`, `test_*.py`, `*_test.py`, `*_test.go`,
`*_test.rs`, `*Test.java`, `*Tests.java`, `*Test.kt`, `*Tests.kt`,
`*_test.{c,cc,cpp}`, `runtests.jl`).

- Why: layering rules commonly skip test files, on the premise that a test is a
  sink that nothing imports. A production import of a test file breaks that
  premise and reaches whatever the test reaches, with no rule in the way.
- Refused by the script: a file under a directory named `test`, `tests`, or
  `testing`. Such a file is test support and publishes helpers on purpose. It is
  reported with severity `low` and `refused: true`.
- Bound: needs `to`. An edge with `to: null` is not seen. A test directory
  convention that is not a name pattern needs `test_globs`.

## `layer-direction`

A non-test file in one layer has an edge to a file in another layer, and the
`allow` list of the first layer omits the second.

- Why: this is the rule a layer diagram or dependency table states. Lint zones
  may already enforce it; run this check when they do not, or to find where lint
  config and the document disagree.
- Rows of a dependency table in a document become `layers` and `allow` entries.
  A table row that omits an edge the code has is reported here, with the rules
  file standing for the document. Update the table when the code is right.
- Bound: files that no layer claims are not checked. A layer may always import
  itself. Test files are skipped. The check does not report an `allow` entry
  that no code uses, because an over-declared table does not mislead readers
  about what is allowed.

## `undeclared-package-dep`

An edge between two packages of the rules file where the source package's
`depends` omits the target. The target is found by `to` (the package whose
`root` contains it) or, when `to` is `null`, by `specifier` matching an
`import_names` entry of a package.

- Why: path or workspace setup can make an undeclared import resolve inside the
  repo. It fails when the package is built or installed on its own.
- Production and test use are separate. A package imported only from tests
  needs a development dependency, and the proposal says so. When production code
  also imports it, only the production finding is reported, and its `sources`
  list both.
- Bound: the check asks whether an edge is declared, not whether it points the
  right way. A declared edge that inverts the intended order passes. Packages
  absent from the rules file are not checked. The rules file holds the declared
  dependencies because manifest formats differ by language; the model builds
  that list by reading the manifests.

## `foreign-barrel-reexport`

A `reexport` edge in a barrel file whose target is outside the barrel's
directory. Barrel files are `barrel_globs`, or `index.{ts,tsx,js,jsx,mjs,cjs}`,
`__init__.py`, and `mod.rs` by default.

- Why: every consumer of the barrel then depends on the other directory, and the
  barrel misstates which directory owns the symbol.
- Bound: needs a `reexport` edge with `to`. `edges.mjs` marks `export ... from`
  in TypeScript and JavaScript, `pub use` in Rust, and every import in a Python
  `__init__.py` as a re-export. Other languages need edges from a language
  server or the model's reading. A comment may justify the re-export, for
  example to keep a published surface after a symbol moved. Report it as a
  question and do not decide.

## `unchecked-source`

A file that matches an `unchecked` entry of the rules file and is not a test
file.

- Why: an import inside a file that the type checker or linter skips is checked
  by neither tool.
- Bound: the check lists files that the model already found by reading the
  repo's checker config (type checker `include` and `exclude`, lint file
  patterns, build target lists). It finds nothing the rules file does not name.
  Settings inherited through config chains are easy to miss; read them.

## Repo-specific rules without a check

Some layering rules exist in one repo only and have no generic form. Examples:
a rule that a code-generation helper must not wrap a composed template literal,
and a rule that every lint disable for one named project rule carries a reason.
The scripts have no check for such rules. Add one through the extension point
below when the repo writes the rule down, or report violations as reviewer
findings.

## Extension point

A repo rule that nothing enforces can become a check. Add a function to the
`CHECKS` array in `scripts/check.mjs`. It takes the context (`rules`, `edges`,
`files`, and helpers) and returns findings, or `{skipped: reason}` when the
rules file lacks its data. A finding needs `check`, `severity`, `file`,
`signal`, `evidence`, `proposal`, and `verify`; use the `finding()` helper to
add `id`, `source`, `evidence_source`, and `refused`. Put its data in the rules
file and add the key to `RULE_KEYS`.

Cite the document that states the rule in `evidence`. A rule with no written
source is a guess. Test the new check in `scripts/check.test.mjs` with a fixture
that has one violation and one lookalike that must not fire.

## Not checked here

- Circular imports. Use the repo's own cycle tool.
- Whether a package-level edge points the right way.
- Symlinked files, files over 2 MB, and files in ignored directories. A
  symlinked path given directly (for example a dependency document) is not read.
