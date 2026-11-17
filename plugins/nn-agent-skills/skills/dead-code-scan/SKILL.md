---
name: dead-code-scan
description: >-
  Scan a whole repository, in any programming language, for dead code:
  declarations that nothing reaches from any root (entry points, public API,
  tests, build targets, plugin and FFI exports, other repositories). A text
  scan lists candidates, the model confirms each one from a language server,
  text search, or reading, surveys what the scan cannot see, and reports
  findings with a proposed change per finding. It never edits files, commits,
  or opens pull requests. Use when asked to find unused exports or functions,
  prune dead code across a repository, or check whether a symbol can be
  removed. To review the dead code in one diff, use dead-code-code-review.
---

# Dead Code Scan

A symbol is dead only if it is unreachable from every root of the dependency
graph. The scan lists candidates and roots. The model decides.

**Contract.** The output is findings. Each finding has a concrete proposed
change: what to change, where, and the check that would verify it, as text or a
patch snippet in the report. This skill does not edit files, commit, push, or
open or comment on pull requests or issues. The user, or a separate task,
applies the change. The script writes only the findings file named by
`--out`, and that file must be outside the repository under review.

## Evidence sources

Use the strongest source available for each finding and record it in
`evidence_source`:

| Value | Source | Use for |
| ----- | ------ | ------- |
| `lsp` | Language server: find-references, workspace and document symbols, call hierarchy, diagnostics, code actions | References, definitions, callers, overrides, expression types, unused and exhaustiveness diagnostics |
| `text` | `rg` or `git grep`, and the scan's token counts | When no language server exists. Names in comments and strings count as references. |
| `read` | Reading the code and its callers | Everything the other two cannot show: dynamic access, generated code, conventions |

Check at the start whether a language server is configured or startable for
each language in the repository (an editor or agent LSP tool, or a server such
as `gopls`, `rust-analyzer`, `pyright`, `jdtls`, `clangd`, `typescript-language-server`,
`LanguageServer.jl`). Prefer it over text search for reference counts. Say in
the report which languages had one. `references/languages.md` lists, per
language, how to find roots and public API. Only the scan's declaration
patterns are tested for TypeScript, Python, Go, Rust, Java, C, and Julia, and
the root detection for a subset of them (see the top of that file). Everything
else in that file is guidance.

## Requirements

- Node 20 or later and a git repository. The scan needs no other package.
- Optional: a language server for each language, and `gh` (authenticated) for
  the cross-repository search.

## Procedure

1. **Find the roots.** Read what the project documents first (README,
   CONTRIBUTING, manifests, build files, CI). Then list every root class that
   applies, from `references/languages.md`:
   - entry points: `main` functions, binaries, CLI and server entry files;
   - the public API of libraries and packages;
   - build targets and scripts, and CI steps that run files directly;
   - test entry points and test setup files;
   - build and tool configs that import code, plugin or loader registries;
   - framework conventions: file-based routes, handlers, migrations, stories,
     annotation or decorator wiring;
   - FFI and export attributes (symbols named from other languages or binaries);
   - dynamic loading: computed imports, reflection, string-keyed registries;
   - non-code consumers: docs, templates, schemas, config naming symbols;
   - other repositories and published consumers.
2. **Run the scan** from the repository root:

   ```bash
   node <skill-dir>/scripts/scan.mjs --out "$(mktemp -d)/dead-code-scan.json"
   ```

   Check machine load first on a large repository. `--scope <path>` limits the
   declaration scan; the reference index always covers the whole repository.
   `--help` lists the rest.
3. **Settle the roots.** Read `roots.found` and `roots.unresolved` in the JSON.
   If any of these hold, ask the user before reporting anything as dead, and do
   not proceed on a guess:
   - `roots.unresolved` is not empty;
   - no manifest or build file exists, or the repository is a monorepo whose
     consumers are unclear;
   - a framework or convention in the repository is not in `roots.found` or
     `roots.unresolved` (the scan knows a fixed list);
   - the project documents no entry points and you cannot find them.

   Ask, after reading the project's own docs, only about what stays open. One
   message, in this form: "The scan could not evaluate these roots: `<ids and
   detail>`. For each, which files or symbols does it load or call, or is it
   not used here?" When the user answers, pass `--accept-root <id>:<path>`
   (the root is evaluated for the files under that path) or `--accept-root <id>`
   (all files) and rerun, or keep the candidate refused. `--accept-root
   other-repositories` means `--no-external`. A candidate reachable only from a root the
   scan did not evaluate is a refusal with category `unevaluated-root`.
4. **Judgment pass.** For every script finding, candidate or refusal, read the
   code around it and its callers, and confirm or overturn the script. Establish
   from the language server, text search, or reading whether the symbol is
   published (library API, exports map, public header, `pub`, capitalized Go
   name, `__all__`), reachable from any root in step 1, and named in other
   repositories. Set on each finding `judgment` to `confirmed` (for a refusal:
   the refusal stands), `downgraded`, `dropped`, or `overturned` (a refusal that
   is in fact dead), with `judgment_reason` and the `evidence_source` used. A script verdict alone
   never justifies a proposed change.
5. **Survey.** Read what the script cannot analyze, and report each defect as
   a finding with `source: reviewer` (the script's own have `source: script`):
   - files in `skipped_files`, and file types in `binary_file_types`;
   - readable files in `unlisted_file_types` (languages the scan has no
     declaration pattern for), and declarations the pattern misses (see below);
   - dynamic access: string keys, reflection, plugin and config loading,
     generated code;
   - the neighborhood of each finding: siblings with the same shape (other
     members of the same enum or set, other re-exports in the same file, other
     files in the same directory).
6. **Write the report.** Write the findings JSON (script and reviewer
   findings together) and run
   `node <skill-dir>/scripts/scan.mjs validate <findings.json>`. Then give a
   short ranked summary: findings first, by severity, each with its
   `source`, `evidence_source`, judgment, and proposed change; then refusal
   counts by category; then the open roots, if any. Say which languages used
   which evidence source.

## What the scan sees and does not see

| Check | The scan sees | The model must cover |
| ----- | ------------- | -------------------- |
| `dead-export` | A declaration line, in a supported language, whose name occurs once in all readable text files. | Names that occur more than once but are all dead (a cycle, a helper used only by a dead function, a use only in a comment or string). Declarations with no keyword on the line (C functions, methods, Java methods, Go `type (` blocks, Julia short functions). Languages not in the table. |
| `dead-reexport` | A re-export line whose name occurs in exactly two files, two times. | Whether the second file declares the name. Re-exports the line pattern misses. Glob re-exports, which carry every name. |
| Visibility | A hint from the declaration line (`exported`, `public-by-convention`, `unknown`). | Whether the package publishes the file: manifests, export maps, public headers, module systems, build visibility. |
| Roots | Manifests, `main` functions, files named in build and CI files, tests, tool configs, docs and data read by name, framework paths from a fixed list, directories that usually load by path, computed loads, FFI attributes. | Everything else in step 1, including frameworks outside the list and how a build maps output to source. |
| Other repositories | `gh search code` hits for the symbol name under one GitHub owner. | Consumers under other owners, binary consumers, and consumers that import a renamed alias. |
| Binary and large files | Reports them. Files over the size limit block every candidate (`unread-files`) until read or accepted. | Reading them if they can name symbols. Binary files are not tokenized. |

The scan reads every text file up to `--max-file-bytes`. Symlinks are skipped.
A name in a comment or a string counts as a reference, so the scan reports
less than the full dead set. A name used only in a binary file or in a file the
scan does not recognize as text is not counted.

## Refusals

The scan refuses a candidate, with a category, when:

| Category | Rule |
| -------- | ---- |
| `kept-by-caller` | The name is in `--keep`. Pass names of deliberately unreferenced symbols: coverage exemptions, deprecation tables, registries. |
| `underscore-name` | A leading `_` marks a name as intentionally unreferenced. |
| `side-effect-initializer` | The declaration line calls code or declares several names, so removal may remove an effect. |
| `test-support` | The file is under a fixture, sample, mock, or example directory. |
| `doc-in-directory` | The directory holds a README, DESIGN, or ARCHITECTURE file. A symbol that completes a documented set is not dead because nothing uses it yet. |
| `unevaluated-root` | A root the scan could not evaluate may load the symbol, including `manifest` (no manifest or build file above the file) and `unread-files` (files over the size limit). |
| `exported-with-hits` | Another repository names the symbol. |
| `unknown` | The cross-repository search could not run or failed (no `gh`, not authenticated, unknown owner, rate limit, a full page of own-repository hits, or the `--max-external` limit). |

`--no-external` skips the cross-repository search. Use it only when the user
states that the repository has no consumers elsewhere, and say so in the
report. Without `gh` and without `--no-external`, nothing is a candidate: say
that outright instead of calling the repository clean. The search waits
`--pace-ms` between calls, because GitHub rate-limits code search.

A refusal is a prompt to read the code, not a verdict. When the judgment pass
overturns one, say why in `judgment_reason`.

## Output

The scan JSON has `tool`, `scope`, `generated_at`, `counts`, `roots`,
`skipped_files`, `binary_file_types`, `unlisted_file_types`, and `findings`.
`roots` has `found` and `unresolved`, each a list of `{id, kind, detail}`.

| Finding field | Value |
| ------------- | ----- |
| `id` | `dc-N` |
| `source` | `script` or `reviewer` |
| `evidence_source` | `lsp`, `text`, or `read` |
| `severity` | `low` for `dead-export`, `nit` for `dead-reexport`, `question` for a refusal. The model may change it. |
| `check`, `file`, `line`, `symbol`, `language` | The candidate |
| `visibility_hint`, `external` | The scan's hint, and `none`, `hits`, `unknown`, `skipped`, or `not-run` |
| `evidence` | What was checked and found |
| `proposal` | The proposed change: where, what, and the check that verifies it |
| `judgment`, `judgment_reason` | The model's decision on a script finding |
| `refused`, `category`, `reason` | Present for refusals |

A `reviewer` finding has the same fields, with `source: reviewer` and no scan
verdict fields. Exit status of the scan: 0 when it found no candidates, 1
when there are candidates or refusals for the judgment pass, 2 when it could
not run. `validate` exits 2 and lists the problems when a finding lacks a
source, an evidence source, a proposal, or (for a script finding) a judgment
with its reason.

## Final check

Each reported finding needs a root story (which roots were considered and why
none reaches the symbol), an evidence source, and a proposed change with its
verification. Do not report a symbol as dead while a root that could reach it
is unevaluated.
