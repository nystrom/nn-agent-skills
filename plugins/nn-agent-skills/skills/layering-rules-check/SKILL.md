---
name: layering-rules-check
description: >-
  Check layering and abstraction rules that lint and the type checker do not
  enforce in a TypeScript or JavaScript repo, mostly a monorepo. Finds a
  production module that imports a test module, an importable .js, .mjs or
  .cjs file under src that tsc skips, a package that imports a workspace
  package its package.json does not declare, a barrel (index file) that
  re-exports another directory's module, and a dependency-table document that
  no longer matches the imports. Scans the tree with a bundled script, writes a
  JSON findings file with a short ranked summary, and proposes edits. Edits
  only when asked. Use when asked to check layering, module boundaries,
  workspace dependencies, barrel exports, or whether a dependency document is
  accurate.
---

# Layering Rules Check

Repos state layering rules in lint zones, in style guides, and in documents
such as a dependency table. Lint and `tsc` enforce only some of them. This
skill finds code that breaks the rest and reports it with the evidence.

The scan is `scripts/scan.mjs` in this skill's directory. It needs Node 20 or
newer and the files of the target repo. It installs nothing and reads no
TypeScript compiler. Run it from the target repo; with no `--out` it prints the
findings JSON.

```bash
node <skill-dir>/scripts/scan.mjs --out layering-findings.json
node <skill-dir>/scripts/scan.mjs --scope packages/core --out /tmp/findings.json
node <skill-dir>/scripts/scan.mjs --doc docs/DEPENDENCIES.md
```

| Option | Meaning |
| ------ | ------- |
| `--root <dir>` | Repo root. Default: git top level, else the working directory. |
| `--scope <path>` | Keep findings whose file is under this path, relative to the root. A manifest or table finding also stays when an import it summarizes (its `sources`) is under the path. Repeatable. |
| `--doc <file>` | Dependency-table document. Default: found by file name. |
| `--out <file>` | Write the JSON here and print a ranked summary. |

Exit status: 0 when nothing is reported, 1 when findings are reported, 2 when
the scan cannot run. Refusals do not set status 1.

## Workflow

1. Read the repo's own statement of the rules first: the style guide, the
   contributor notes, the lint config, and any dependency document. The scan
   checks generic rules. A repo rule you find there can need a check of its own
   (`references/checks.md`, "Extension point").
2. Check machine load, then run the scan on the whole repo, or on `--scope` for
   a large one.
3. Read each reported finding in the code. The scan matches text; it does not
   parse. Confirm the import is real and apply the refusal rules below.
4. Report the findings, ranked, with the file, the line, the rule, and the
   proposed change. Put the JSON path in the report.
5. Edit only when the user asks. Fix one finding per change, because the
   findings have little in common. Run the repo's lint, type check, and tests
   on the touched packages afterward.

## Checks

| Check | Fires on |
| ----- | -------- |
| `test-import` | A non-test module that imports a `*.test.*`, `*.spec.*`, or `__tests__` module. |
| `unchecked-source` | A `.js`, `.jsx`, `.mjs` or `.cjs` file under a package's `src/`, in a package whose nearest `tsconfig.json` does not set `allowJs`. |
| `undeclared-package-dep` | A package that imports a workspace package its manifest does not declare. |
| `foreign-barrel-reexport` | An `index` file with `export ... from "../..."`. |
| `dependency-doc-drift` | A row of a dependency table that omits a directory its production modules import. |

Each check, its bounds, and what it leaves out are in `references/checks.md`.
Read it before you trust a result or report "no findings".

## Evidence

Report a finding as a problem only when its check fired and no refusal rule
applied. Each
finding has an `evidence` field with the reason the rule exists. State that
reason in your report, not only the match. If a rule comes from a repo
document, cite the document.

A scan that finds nothing proves little when a check was skipped. The JSON lists
`skipped_checks` and `skipped_files`. Name them in the report.

## Refuse when

The scan already marks the first case as `refused`. Check the others by hand.

- The importing file sits in a test directory and exists to publish test
  helpers to other packages' tests. This is the intended shape of a test-support
  barrel.
- A document next to the code says the indirection is deliberate. Cite it and
  report nothing.
- A barrel re-export keeps a public API stable after a symbol moved, and a
  comment says so. Report it as a question for the maintainer, with the
  alternative.
- The edge stays inside one top-level directory of a dependency table. The scan
  does not count it. Do not add it by hand.

List each refusal in a separate part of the report, with its reason.

## Output

The JSON file has `counts`, `skipped_checks`, `skipped_files`, and `findings`.
Each finding has:

| Field | Meaning |
| ----- | ------- |
| `id` | Stable key: check, location, and a detail. |
| `check` | Check name from the table above. |
| `severity` | `high`, `medium`, `low`, or `nit`. |
| `file`, `line` | Location. `line` is absent when the finding is about a whole file or manifest. |
| `signal` | What the scan saw. |
| `evidence` | Why the rule exists. |
| `proposal` | The suggested change, or `none`. |
| `refused`, `reason` | A refused finding states its reason. |
| `sources` | Manifest and table findings only: the `file:line` imports they summarize. |

The summary lists reported findings by severity, then notes skipped checks.
