---
name: dead-code-scan
description: >-
  Dead-code review of a change set or a whole repository, in any programming
  language. Finds declarations that nothing reaches from any root (entry
  points, public API, tests, build targets, plugin and FFI exports, other
  repositories). A text scan lists candidates, the model confirms each one
  from a language server, text search, or reading, surveys what the scan
  cannot see, and reports findings with a proposed change per finding. It
  never edits files, commits, or opens pull requests. Use when asked to find
  unused exports or functions, prune dead code across a repository or a
  branch, check whether a symbol can be removed, or as a review lens under
  run-review-lenses.
---

# Dead Code Scan

A symbol is dead only if it is unreachable from every root of the dependency
graph. The public API of the repository is itself a root: other repositories
that use this one as a library reach every symbol the API exposes, with zero
references inside this repository. The scan lists candidates and roots. The
model decides.

Read `../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md` and follow them. This skill is
a review lens: it works standalone and under `run-review-lenses`.

**Contract.** The output is findings. Each finding has a concrete proposed
change: what to change, where, and the check that would verify it, as text or a
patch snippet in the report. This skill does not edit files, commit, push, or
open or comment on pull requests or issues. The user, or a separate task,
applies the change. The script writes only the findings file named by
`--out`, and that file must be outside the repository under review.

## Invocation modes

- **Standalone.** Resolve the scope (below), run the procedure, and return the
  compact markdown report from the lens protocol: a one-line verdict
  (`needs-attention` or `approve`), the mode and scope in one line, a short
  summary, and findings ranked by severity with file, line, impact, and
  proposed change. Add the roots considered and the open roots. Write no
  `review.json`.
- **Fan-out.** When the prompt says "structured findings" or names the wire
  format, return only the structured list and a one-line headline
  (`needs-attention` or `approve`). Use the scope the orchestrator passed. Do
  not re-derive or widen it. A fan-out run cannot ask the user, so unresolved
  roots keep their candidates refused, and the questions go into one `low`
  finding (see "Wire format"). Ask in standalone mode only.

### Scope

Reachability, roots, public API, and consumer evidence are always computed over
the whole repository at HEAD. The scope limits only which declarations become
candidates. Never narrow the evidence search to the diff.

| Mode | Candidates | How |
| ---- | ---------- | --- |
| `diff` (default) | Declarations in files the change touches, and declarations the change orphans | `scan.mjs --base <base>`; add `--working-tree` for uncommitted work |
| `repo` | Every declaration | `scan.mjs` |
| `paths` | Declarations under the named paths | `scan.mjs --scope <path>` (repeatable) |

An orphaned symbol is one named in removed lines whose last reference the diff
removes: the diff removes more occurrences than it adds, and only its
declaration remains at HEAD. The scan finds these by comparing counts from the
diff. `scan.mjs diff-scope --base <base>` prints the touched files, the
orphaned symbols, and the symbols named only in removed lines (gone at HEAD:
check that nothing still needs them, such as a string or a doc). The default
base is `origin/main`. `--base` and `--scope` combine. A named range
(`A..B`, `A...B`) is diffed as given. Resolve a pull request to its base ref
before the call, for example with `gh pr view --json baseRefName`. The scan reads
the working tree, so with `--base` and no `--working-tree` it warns (in
`warnings` and on stderr) when the tree has uncommitted changes: the evidence
then reflects those changes, not HEAD.

### Overlap with dead-code-code-review

`dead-code-code-review` reviews a diff by reading. This skill adds a
script-backed reference index over the whole tree, explicit root and public-API
accounting, and named refusal reasons. Both can flag the same symbol. The
orchestrator's merge dedupes on `path` and symbol. Findings from this skill
carry `source: dead-code-scan` and name the evidence in `evidence`.

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
   - the public API of libraries and packages, discovered at run time (see
     "Public API" below). Every symbol reachable from it is live, including
     types a public function takes or returns;
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

   Check machine load first on a large repository. Pick the scope flags from the
   scope table above. `--scope <path>` and `--base <ref>` limit the candidates;
   the reference index and the roots always cover the whole repository.
   `--help` lists the rest.
3. **Settle the roots.** Read `roots.found` and `roots.unresolved` in the JSON.
   If any of these hold, ask the user before reporting anything as dead, and do
   not proceed on a guess:
   - `roots.unresolved` is not empty;
   - no manifest or build file exists, or the repository is a monorepo whose
     consumers are unclear;
   - the repository is a library, or its publication status is unclear: no
     manifest, a manifest that does not say whether the code is published
     (`publication-status:<dir>` in `roots.unresolved`), or a mix of published
     and internal packages (`public-api-scope`). Ask which packages or
     directories are public API and which other repositories consume them,
     unless the project's docs answer it;
   - a framework or convention in the repository is not in `roots.found` or
     `roots.unresolved` (the scan knows a fixed list);
   - the project documents no entry points and you cannot find them.

   Ask, after reading the project's own docs, only about what stays open. One
   message, in this form: "The scan could not evaluate these roots: `<ids and
   detail>`. For each, which files or symbols does it load or call, or is it
   not used here?" For publication, the question is: "Which packages or
   directories are public API, and which other repositories consume them?" Pass
   the answer as `--public-api <path>` and `--not-public <path>`. For other
   roots, when the user answers, pass `--accept-root <id>:<path>`
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
   `node <skill-dir>/scripts/scan.mjs validate <findings.json>`. In fan-out
   mode, return the wire format (see "Wire format") and stop. Otherwise give a
   short ranked summary: findings first, by severity, each with its
   `source`, `evidence_source`, judgment, and proposed change; then refusal
   counts by category; then the open roots, if any. Say which languages used
   which evidence source.

## Public API

The public API is the set of names other repositories can use. Discover it at
run time from the language's rules (`references/languages.md`): manifest entry
points and export maps, `__all__` and non-underscore names in a distributed
Python package, capitalized names in a Go package outside `internal/`, `pub`
items reachable from the crate root, public and protected members of public
types in Java and Kotlin, headers that the build installs or lists, exported
and `public` names in a Julia module.

A symbol is also in the API when a public signature exposes it: a type that a
public function takes or returns, a base type of a public type, a type in a
public field. Trace these with the language server (references and type
hierarchy) or by reading.

When the repository is a published library, an exported symbol with no consumer
found is a refusal (`public-api`), not a finding. Other-repository evidence
(`gh search code`, repositories the user names) supports the verdict and never
replaces this root: finding no consumer does not make a public symbol dead. Only
the user can say that a package or directory is not public API. Do not guess.
Separately, the model may overturn the refusal for one symbol, as described
below.

The scan marks a package public from its manifest (`package.json` without
`private: true`, a Cargo library target without `publish = false`, a Go module
outside `internal/`, a Julia `Project.toml` with a name), private from the
opposite, and unclear for every other manifest and build file. The model
overturns a `public-api` refusal for one symbol only after it shows, from the
language server or reading, that no public entry point reaches it, directly or
through a signature. A user's answer that a path is not public API settles the
whole path and needs no per-symbol trace.

The paths named with `--public-api` and `--not-public` are relative to the
current directory, so run the scan from the repository root. The most specific
path wins, and the same path on both sides is an error. One answer settles the
question for the paths it names. Ask about each package that is still open.

## What the scan sees and does not see

| Check | The scan sees | The model must cover |
| ----- | ------------- | -------------------- |
| `dead-export` | A declaration line, in a supported language, whose name occurs once in all readable text files. | Names that occur more than once but are all dead (a cycle, a helper used only by a dead function, a use only in a comment or string). Declarations with no keyword on the line (C functions, methods, Java methods, Go `type (` blocks, Julia short functions). Languages not in the table. |
| `dead-reexport` | A re-export line whose name occurs in exactly two files, two times. | Whether the second file declares the name. Re-exports the line pattern misses. Glob re-exports, which carry every name. |
| Visibility | A hint from the declaration line (`exported`, `public-by-convention`, `unknown`). | Whether the package publishes the file: manifests, export maps, public headers, module systems, build visibility. |
| Public API | A package-level status from the manifest (`public`, `private`, `unclear`), and the exported hint of each declaration. | Which exported symbols a public entry point reaches, including through signatures. Packages whose manifest says nothing about publication. |
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
| `public-api` | The package is published as a library and the symbol is exported (hint `exported`, `public-by-convention`, or `unknown`). Searched in other repositories too, for evidence. |
| `unevaluated-root` | A root the scan could not evaluate may load the symbol, including `manifest` (no manifest or build file above the file), `publication-status:<dir>` (the manifest does not say whether the code is published), and `unread-files` (files over the size limit). |
| `exported-with-hits` | Another repository names the symbol. |
| `unknown` | The cross-repository search could not run or failed (no `gh`, not authenticated, unknown owner, rate limit, a full page of own-repository hits, or the `--max-external` limit). |

`--public-api <path>` and `--not-public <path>` record the user's answer about
which paths are public API. `--accept-root <id>` takes the full id, and
`--accept-root <id>:<path>` limits it to a path (`framework:next:pages/a`). `--no-external` skips the cross-repository search. Use it only when the user
states that the repository has no consumers elsewhere, and say so in the
report. Without `gh` and without `--no-external`, nothing is a candidate: say
that outright instead of calling the repository clean. The search waits
`--pace-ms` between calls, because GitHub rate-limits code search.

A refusal is a prompt to read the code, not a verdict. When the judgment pass
overturns one, say why in `judgment_reason`.

## Output

The scan JSON has `tool`, `scope`, `generated_at`, `counts`, `roots`,
`skipped_files`, `binary_file_types`, `unlisted_file_types`, `diff` (in diff
scope), and `findings`.
`roots` has `found` and `unresolved`, each a list of `{id, kind, detail}`.

| Finding field | Value |
| ------------- | ----- |
| `id` | `dc-N` |
| `source` | `script` or `reviewer` |
| `evidence_source` | `lsp`, `text`, or `read` |
| `severity` | `medium` for `dead-export`, `low` for `dead-reexport`, `question` for a refusal. The model may change it to `blocker`, `high`, `medium`, or `low`. |
| `check`, `file`, `line`, `symbol`, `language` | The candidate |
| `diff_reason` | In diff scope: `touched` (the file is in the diff) or `orphaned` (the diff removed its last reference) |
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

## Wire format

In fan-out mode, report the findings that survive the judgment pass as
`{ source, path, line, severity, title, body, suggested_fix, evidence }`.
`node <skill-dir>/scripts/scan.mjs wire <findings.json>` prints that array from
a judged findings file, and `scan.mjs --format wire` prints it straight from a
scan. Those findings are unjudged candidates: severity `low`, title prefixed
`Candidate:`, `evidence` reads `Inferred`, and the body says to confirm before
acting. Return them only as input to the judgment pass, not as the final
fan-out answer. Both write only to
stdout or `--out` and print the headline on stderr.

| Wire field | From |
| ---------- | ---- |
| `source` | `dead-code-scan`. The finding's own `script` or `reviewer` goes in `body` (`Finding source: ...`). |
| `path`, `line` | `file`, `line` (`.` and `null` for open roots) |
| `severity` | `blocker`, `high`, `medium`, `low` as set; `nit` and `question` map to `low` |
| `title` | `Remove unused <symbol>`, `Remove re-export <symbol>`, or a short heading |
| `body` | `signal`, the judgment and its reason, the finding source |
| `suggested_fix` | `proposal` |
| `evidence` | `Verified: <lsp or read> evidence; <evidence>; roots considered: <ids>` when the model confirmed it from a language server or by reading, else `Inferred: ...` (text only, or unjudged) |

Refusals (`public-api`, `unevaluated-root`, `unknown`, and the rest) are not
findings in fan-out. A refusal the judgment pass overturned is a finding. Roots
the scan could not evaluate become one `low` finding whose `suggested_fix` says
to ask the user which files each root loads, which packages are public API, and
which repositories consume this one. Add at most a few more refusals worth a
look as `low`, with a `suggested_fix` that says what to confirm. The headline
is `needs-attention` when any finding is `medium` or above, else `approve`. An
empty list with `approve` is a valid result.

## Final check

Each reported finding needs a root story (which roots were considered and why
none reaches the symbol), an evidence source, and a proposed change with its
verification. Do not report a symbol as dead while a root that could reach it
is unevaluated.
