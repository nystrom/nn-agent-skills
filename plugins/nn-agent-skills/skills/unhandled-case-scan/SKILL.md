---
name: unhandled-case-scan
description: >-
  Find places in any programming language where a case can go unhandled: a
  dispatch over a finite set of cases (enum, sum type, union, sealed
  hierarchy, tagged variants) that does not fail the build when a case is
  added, and a failure handler that neither acts nor states why it does not
  (empty catch, `except: pass`, discarded error, `rescue nil`). Uses the
  language server for types and diagnostics when one is available, falls back
  to text search and reading, and reads the code itself to confirm or overturn
  every candidate and to survey what pattern matching cannot see. Reports
  findings, each with a concrete proposed change and the check that verifies
  it; it never edits files. Use when asked about exhaustive switches or
  matches, unhandled enum or union cases, `assert_never` or `assertNever`
  helpers, swallowed errors, or empty catch blocks.
---

# Unhandled Case Scan

The rule has two parts:

- A dispatch over a finite set of cases handles every case, or fails the build
  when a case is added to the set.
- A failure handler acts on the failure, or states why it does not.

This skill finds the sites that break the rule and that the compiler does not
already report. It works for any language. The output is findings. Each
finding has a proposed change and a check that verifies it. The skill never
edits files, commits, or opens or comments on pull requests or issues. The
user, or a separate task, applies the changes.

Most sites that look like gaps are not. Many compilers report a new case in
some forms of dispatch and not in others, and a partial dispatch over a large
set is often the design. Ask the compiler before you report.

## Evidence sources

Label each finding with the source of its evidence:

- `lsp`: a language server answered. Use hover or type info for the type of
  the switched-on value and whether it is a finite set, diagnostics for what
  the compiler already reports, definitions and references for declared return
  types and callers.
- `text`: `rg` or `git grep` found it.
- `read`: you read the code.

Prefer `lsp` over `text`. Check whether a language server is configured for
the language (an LSP tool in the session, an editor config, or a server binary
on the path) or startable. When none is, fall back to `rg` or `git grep` plus
reading the code, and say so in the summary.

Test whether the compiler already flags a missing case; do not assume it. Add
a case to the set in a scratch copy of the file (a copy in the system temp
directory, or a scratch worktree), then read the diagnostics or compile the
copy. Never make this edit in the repository under review.

## Inputs

- **Scope**: the whole repository (default), or one or more subtrees.
- **Languages**: those the repository uses. `references/languages.md` lists
  what the table covers and what is guidance only.

## Signal

`scripts/candidates.mjs` is Node ESM, runs on Node 20 or later, and needs no
packages. It matches patterns from a per-language table
(`scripts/languages.mjs`) and verifies nothing. Every result is a candidate.
It reads the repository and writes only the findings file. Run it from inside
the repository.

```bash
node <skill-dir>/scripts/candidates.mjs --scope src/lib --out /tmp/findings.json
```

| Option | Meaning |
| ------ | ------- |
| `--scope <path>` | Restrict to a subtree. Repeatable. A scope outside the repository, or one that matches no scanned file, exits 2. |
| `--language <name>` | Restrict to one table entry. Repeatable. |
| `--out <file>` | Findings file. Its directory must exist, and its real path must be outside the repository. Default: a new file under the system temp directory; the path is printed to stderr. |

Exit codes: 0 when there are no candidates, 1 when candidates are reported, 2
when the scan could not run. The script does not run if no file has a table
entry; use the survey below.

| Check | Candidate |
| ----- | --------- |
| `dispatch-no-default` | A `switch` or `match` with no catch-all arm, in a language where a missing catch-all is how a new case goes unreported. |
| `dispatch-wildcard` | A `match`, `when`, or `switch` with a catch-all arm, in a language where the compiler checks exhaustiveness and the catch-all hides a new case. |
| `empty-handler` | A handler with no statements, or one that discards the failure. |

Files in a language with no table entry are counted under
`extensions_without_entry`. Test paths are not scanned and are counted in
`excluded_test_files`. Files over 1 MiB, binary files, and symbolic links are
not scanned and are listed in `skipped`.

## Findings document

A JSON object with `counts`, `languages_scanned`, `extensions_without_entry`,
`closing_markers`, `skipped`, `excluded_test_files`, and `findings`. Candidates come first, ranked by
severity, then commented handlers. Each finding has `id`, `check`, `file`,
`line`, `language`, `severity`, `signal`, `evidence`, `refused`, `source`,
`proposal`, and, unless refused, `verify`. The script writes `source: script`
and `evidence: text`. A refused finding also has a `reason`, and its
`proposal` begins with "none".

`closing_markers` lists the constructs the repository already uses to close a
dispatch, counted per language, such as `assert_never(` or `@unknown default`.
A proposal names the most-used marker for its language. The scan finds markers
by pattern. Confirm that a marker takes the value as its argument and fails at
build time before you propose it.

## Judgment pass

The script is the first pass. A script verdict alone never justifies a
proposed change. Do these steps yourself, and do them when the script reports
nothing.

1. **Confirm or overturn each candidate.** Read the code around every
   candidate and every refusal, and its callers. Establish with `lsp`, a
   scratch compile, or reading: the type of the switched-on value, that it is
   a finite set, that the compiler does not already report a missing case, the
   declared return type, and who uses the result. Mark each candidate
   `confirmed`, `downgraded`, or `dropped`, with the reason. A refusal can be
   wrong too. Overturn it when the code shows that.
2. **Survey what the script cannot see.** Read the code listed under "What
   the script cannot see". Start with the neighborhood of each finding and
   the `skipped` files. When the script reports nothing, run the searches
   below over the requested scope. Report each defect as a reviewer finding.
3. **Label the source.** Script findings carry `source: script`. Mark yours
   `source: reviewer` in the summary. Reviewer findings are not written to the
   JSON.

Searches for a clean run, adapted to the languages in use: `rg -n
'\b(switch|match|when)\b'` for dispatches, `rg -n 'catch|except|rescue|\b_ =
|unwrap_or_default'` for handlers, `rg -n 'else if|elif|elseif'` for chains
over a finite set. Read each hit that dispatches on a tag, kind, type, or
enum value.

Summary format: counts, the closing marker found, then one ranked list. Each
line has the source, severity, `file:line`, the evidence source (`lsp`,
`text`, or `read`), the verdict for script findings, the defect in one
sentence, the proposed change, and the verifying check. List a refusal the
pass overturned as a finding. Give the count of refusals left standing and
offer the file.

## What the script cannot see

| Check | Not seen | Where to look |
| ----- | -------- | ------------- |
| Dispatch | `if`/`else if`/`elif`/`elseif` chains over a finite set that end in an unchecked `else`, or in no `else`. | Chains on a `kind`, `type`, or enum field whose last branch assumes the remaining case. |
| Dispatch | Dispatch the type system cannot model: string-keyed lookup tables, map or dictionary indexing with a cast, enum-like constants typed as strings, dispatch on a runtime class name. | Tables keyed by a tag, and switches over a value typed as a string. |
| Dispatch | Whether the switched-on value is a finite set, and whether the compiler already reports a missing case. | Language server type info and diagnostics, or a scratch compile. |
| Dispatch | A nested dispatch: a catch-all arm in an inner dispatch hides a missing one in the outer. | Each dispatch read on its own. |
| Handler | Handlers that swallow a failure without an empty block: a handler that only logs and continues, a named no-op handler, a handler that returns a default value, a promise or future whose result is never awaited or checked. | Every handler and every ignored result near a finding. |
| Both | Languages with no table entry, test-like paths, large and binary files, symbolic links, and generated code. | Each `extensions_without_entry` and `skipped` entry, and the test files counted in `excluded_test_files` (find them with `git ls-files`). |

## Proposed changes

Each finding states, as text or a patch snippet in the report:

- **What** to change and **where**: the file, the line, and the new code.
- **The check that verifies it**: the diagnostic the build must report when a
  case is added (name the case), plus the tests that cover the file.

For a dispatch, the change is to close it: an exhaustiveness marker in the
catch-all arm, or the language's exhaustive form with the remaining cases
listed. For a handler, the change is to act on the failure, or to write the
reason it is not worth reporting.

Do not propose a catch-all that returns an empty value to silence a
dispatch finding. It keeps the gap and removes the diagnostic the change
exists to add.

When the marker takes the switched-on value, pass the value the compiler has
narrowed to the empty case. For `switch (shape.kind)` over a tagged union that
is `shape`, because `shape.kind` is not valid once `shape` has narrowed to
nothing.

## Refuse when

Each refusal appears in the report with its reason. For a dispatch:

- **The switched-on type is not a finite set.** An open domain. Falling
  through is the design.
- **A closing marker follows the dispatch.** It closes the set as a catch-all
  arm would.
- **Control continues past the dispatch.** An arm that breaks or falls out, a
  last empty arm, or a statement after the dispatch makes the dispatch a
  partial one with a fallback behind it.
- **The enclosing function declares a return type that already makes the
  compiler report the new case.** A new case is reported there.
- **The dispatch is a callback whose expected return type already reports a
  new case.**
- **The language already requires exhaustiveness for this form** and no
  catch-all hides it.

For a handler: the body holds a comment that states why the failure is
ignored.

Proposed changes depend on `references/languages.md` for each language's
forms. Read `references/checks.md` for the bound of each check.
