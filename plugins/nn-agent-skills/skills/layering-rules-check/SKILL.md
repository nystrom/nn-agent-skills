---
name: layering-rules-check
description: >-
  Check layering and abstraction rules that lint and the compiler do not
  enforce, in a repo written in any programming language. Finds a production
  module that imports a test module, a layer that imports a layer the rules
  forbid, a package that imports a package it does not declare, a barrel or
  re-export file that re-exports another directory's module, and source files
  that the repo's checkers skip. Builds a layering rules file from the repo's
  docs and lint config, checks import edges from a language server (or text
  search) against it, and reports ranked findings with a proposed change for
  each. It does not edit files. Use when asked to check layering, module
  boundaries, dependency direction, package dependencies, barrel exports, or
  whether an architecture document matches the imports.
---

# Layering Rules Check

Repos state layering rules in lint zones, style guides, contributor notes, and
architecture documents. Lint and the compiler enforce only some of them. This
skill finds code that breaks the rest and reports it with evidence.

Contract: the output is findings. Each finding has a concrete proposed change
(what to change, where, and the check that verifies it), written as text or a
patch snippet in the report. The skill never edits files, commits, or opens or
comments on pull requests or issues. The user, or a separate task, applies the
changes. The scripts never write to the repo under review. They write only the
file named with `--out`, and they refuse an `--out` path inside the repo
(also through a symlink). Name a path outside the repo, for example under the
system temp directory.

## Method

The method is language-neutral. Language facts (import syntax, manifests, test
naming, re-export idioms, language servers) are in `references/languages.md`.

1. **Read the rules.** Read the repo's own statement of its layering: style
   guide, contributor notes, architecture and dependency documents, lint and
   build config. Note every rule, enforced or not.
2. **Write the rules file.** Turn the rules into data (`references/rules.md`):
   layers, allowed directions, packages and their declared dependencies, test
   and barrel classification, files the checkers skip, known intended
   exceptions. Show the file to the user and get it confirmed before you rely
   on it. A rule you cannot find written down is a guess; leave it out.
3. **Get import edges.** Check whether a language server is configured or
   startable for the language. Prefer it over text search: use find-references,
   document and workspace symbols, and diagnostics to list which module imports
   which. Write the edges in the edge-list format (`references/rules.md`) with
   `evidence_source: "lsp"`. When no server exists, run `scripts/edges.mjs`
   (text-based, optional, a table of import patterns per language) or use
   `rg`/`git grep` and read the code. Say in the findings which evidence source
   each result used: `lsp`, `text`, or `read`.
4. **Run the check.** `scripts/check.mjs` evaluates the edges against the rules
   file. Check machine load first.
5. **Judge each result.** Read the code around every reported finding and every
   refusal, and read its callers. Confirm, downgrade, or drop each one, and
   write down which and why. A script verdict alone never justifies a proposed
   change.
6. **Survey what the script cannot see.** Read the rules in docs, lint config,
   and contributor notes that no check enforces, then look for violations. Read
   dynamic imports and runtime-built module names, the files in
   `skipped_files`, and the neighborhood of each finding. Each result is a
   reviewer finding.
7. **Report.** Rank the findings. For each give the file, the line, the rule,
   `source` (`script` or `reviewer`), `evidence_source`, the judgment
   (confirmed, downgraded, dropped) with its reason, the proposed change, and
   the check that verifies it. Name skipped checks and skipped files.

```bash
node <skill-dir>/scripts/edges.mjs --out /tmp/edges.json
node <skill-dir>/scripts/check.mjs --rules /tmp/rules.json --edges /tmp/edges.json --out /tmp/findings.json
```

`check.mjs` extracts edges itself when `--edges` is absent. Options: `--root`
(default git top level), `--scope <path>` (repeatable, relative to the root),
`--out`. Exit status: 0 when nothing is reported, 1 when findings are reported,
2 when the check cannot run. Refusals do not set status 1. Both scripts need
Node 20 or newer and nothing else.

## Checks

| Check | Fires on | Evidence it uses |
| ----- | -------- | ---------------- |
| `test-import` | A non-test module with an edge to a test module. | Edges (`lsp` or `text`); test classification from the rules file or name patterns. |
| `layer-direction` | An edge from one layer to a layer its `allow` list omits. | Edges and the rules file. |
| `undeclared-package-dep` | An edge between packages where the source package lists no such dependency. | Edges, and the package list in the rules file (built from manifests by reading). |
| `foreign-barrel-reexport` | A re-export edge in a barrel file whose target is outside the barrel's directory. | Re-export edges (`lsp` or `text`). |
| `unchecked-source` | A file that matches an `unchecked` entry of the rules file. | The rules file (built by reading lint and build config). |

Each check and its bounds are in `references/checks.md`. A check whose data is
absent from the rules file is skipped and named in `skipped_checks`.

## What the scan cannot see

Look here yourself.

| Check | Not seen by the scan |
| ----- | -------------------- |
| `test-import` | Imports built at run time; another package's test entry reached through a package name; test helpers in files that no pattern marks as tests. |
| `layer-direction` | Edges the extractor cannot resolve to a file (`to: null`); imports through generated code, macros, or reflection; paths no layer claims. |
| `undeclared-package-dep` | Whether a declared edge points the right way; third-party packages; package edges the rules file lacks. |
| `foreign-barrel-reexport` | Barrels not named in the defaults or `barrel_globs`; a deep import that skips the owning directory's barrel; re-exports through a local alias. |
| `unchecked-source` | Anything the rules file does not list; checker settings inherited through config chains you did not read. |

The scan also does not see rules that exist only in docs, lint config, or
contributor notes; files it skipped; or code in ignored directories (`.git`,
`node_modules`, `vendor`, `target`, `build`, `dist`, and similar).

## Evidence and refusal

Report a script finding as a problem only when its check fired, no refusal
applied, and your reading of the code confirmed it. Report a reviewer finding
only with the code you read and the rule it breaks. State the rule's reason, and
cite the document when the rule comes from one.

Refuse (list separately, with the reason) when:

- The importing file sits in a test-support directory and exists to publish test
  helpers. The script marks this case `refused`.
- A document next to the code says the indirection is deliberate.
- A re-export keeps a public API stable after a symbol moved, and a comment says
  so. Report it as a question for the maintainer, with the alternative.
- The edge stays inside one layer or one top-level directory of a dependency
  table.

A finding resting on `text` evidence in a language whose import syntax the
extractor does not cover is a guess. Confirm it by reading before you report it.

## Output

The JSON file has `counts`, `skipped_checks`, `skipped_files`, and `findings`.
Each finding has:

| Field | Meaning |
| ----- | ------- |
| `id` | Stable key: check, location, and a detail. |
| `check` | Check name. |
| `source` | `script`. Reviewer findings use `reviewer` in the report. |
| `evidence_source` | `lsp`, `text`, or `read`. |
| `severity` | `high`, `medium`, `low`, or `nit`. |
| `file`, `line` | Location. `line` is absent for a whole-file finding. |
| `signal` | What the check saw. |
| `evidence` | Why the rule exists. |
| `proposal` | The proposed change, or `none`. |
| `verify` | The check that shows the change worked. |
| `refused`, `reason` | A refused finding states its reason. |
| `sources` | Package findings only: the `file:line` imports they summarize. |

The summary lists reported findings by severity, then skipped checks. Reviewer
findings and the judgments appear in the report, not in the JSON.
