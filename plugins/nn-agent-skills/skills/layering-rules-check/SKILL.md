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
  each. It does not edit files. Reviews a change set or a whole repo. Use when
  asked to check layering, module boundaries, dependency direction, package
  dependencies, barrel exports, or whether an architecture document matches
  the imports, or as a review lens under run-review-lenses.
---

# Layering Rules Check

Repos state layering rules in lint zones, style guides, contributor notes, and
architecture documents. Lint and the compiler enforce only some of them. This
skill finds code that breaks the rest and reports it with evidence.

This is a review lens. Read `../run-review-lenses/references/lens-protocol.md`
and `../run-review-lenses/references/review-scope.md` and follow them. They
define the two invocation modes and the scope modes used below.

Contract: the output is findings. Each finding has a concrete proposed change
(what to change, where, and the check that verifies it), written as text or a
patch snippet in the report. The skill never edits files, commits, or opens or
comments on pull requests or issues. The user, or a separate task, applies the
changes. The scripts never write to the repo under review. They write only the
file named with `--out`, and they refuse an `--out` path inside the repo
(also through a symlink). Name a path outside the repo, for example under the
system temp directory.

## Invocation and scope

**Standalone** (the user invoked this skill): resolve the scope, run the method,
and return the compact markdown report from the lens protocol (verdict
`needs-attention` or `approve`, mode and scope in one line, a summary, ranked
findings).

**Fan-out** (the prompt says "structured findings" or names the wire format, or
`run-review-lenses` loaded you): use the scope the orchestrator passed and do
not re-derive it. Return only the structured list (below) and a one-line
headline, `needs-attention` or `approve`. No other prose.

Scope mapping. In every mode, evidence is computed repo-wide: import edges,
package lists, layer membership, and the rules file cover the whole tree. Only
the candidates narrow. Never narrow the evidence search to the diff.

| Mode | Candidates | How |
| ---- | ---------- | --- |
| `diff` (default) | Findings in a changed file, findings whose target is a changed file, and package findings summarizing an import in a changed file. | `check.mjs --diff <base>` (changed files from `git diff --name-only <base>...HEAD`), plus `--working-tree` when asked or the tree is dirty. `--changed-file <file>` reads the changed paths from a list when the orchestrator gave them or git is not the VCS. |
| `repo` | The whole tree. | No scope flag. |
| `paths` | Findings under the named paths. | `--scope <path>`, repeatable. |

A moved or deleted file has no current path, so its old importers appear as
unresolved edges (`to: null`) or not at all. For a change that deletes or moves
modules, also read the importers of the old paths with `rg` and report them as
reviewer findings. The `candidate_scope` field of the JSON records the mode and
the number of changed files.

## Method

The method is language-neutral. Language facts (import syntax, manifests, test
naming, re-export idioms, language servers) are in `references/languages.md`.

1. **Read the rules.** Read the repo's own statement of its layering: style
   guide, contributor notes, architecture and dependency documents, lint and
   build config. Note every rule, enforced or not.
2. **Write the rules file.** Turn the rules into data (`references/rules.md`):
   layers, allowed directions, packages and their declared dependencies, test
   and barrel classification, files the checkers skip, known intended
   exceptions. In a standalone run, show the file to the user and get it
   confirmed before you rely on it. In a fan-out run, do not wait: derive each
   rule from a cited document or config line, name the rules file and its
   sources in the evidence, and leave out any rule you cannot cite. A rule you cannot find written down is a guess; leave it out.
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
`--diff <base>`, `--working-tree`, `--changed-file <file>`, `--format
findings|wire`, `--out`. Exit status: 0 when nothing is reported, 1 when findings are reported,
2 when the check cannot run. Refusals do not set status 1. Both scripts need
Node 20 or newer and nothing else.

## Overlap with other lenses

- `dead-code-code-review` finds symbols with no callers. This skill finds
  imports that cross a layer, test, package, or barrel boundary. A test-only
  production helper can appear in both; keep the dead-code finding and cite this
  one as the boundary view.
- `test-coverage-code-review` judges whether tests cover the change. This
  skill reports only production code that imports test code.
- `ai-slop-code-review` finds generated-code residue, including needless
  re-export wrappers. A barrel finding here rests on a written rule and an
  import edge, not on style.

What this skill adds: whole-tree edge evidence from a script or a language
server, a rules file confirmed by the user, and a judgment gate per finding. If
another lens reports the same file and line, the merge can keep one and link
the other.

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
  so. Report it as a question, with the alternative.
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

## Wire format

`check.mjs --format wire` prints a JSON array of review-lens findings (to
standard output, or to `--out`) and the headline on standard error. Map each
reported finding as follows. Add your reviewer findings in the same shape.

| Wire field | Value |
| ---------- | ----- |
| `source` | `layering-rules-check` (the skill slug) |
| `path` | `file` |
| `line` | `line`, or `null` for a whole-file finding |
| `severity` | `high`, `medium`, `low`; `nit` becomes `low`. Use `blocker` only when you judged that the change cannot ship with the violation. |
| `title` | `<check>: <signal>` |
| `body` | `signal`, the reason from `evidence`, and `(source: script)` or `(source: reviewer)` |
| `suggested_fix` | `proposal` and the `verify` check |
| `evidence` | `Verified: ...` when `evidence_source` is `lsp` or `read`; `Inferred: ...` when it is `text`. Name the evidence source. |

The headline is `needs-attention` when any finding is reported, else `approve`.
Refusals are not findings in fan-out. Add at most the refusals worth a look as
`low`, with `suggested_fix` saying what to confirm. No material finding is
success: return an empty list and `approve`.
