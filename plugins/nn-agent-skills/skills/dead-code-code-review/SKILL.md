---
name: dead-code-code-review
description: >-
  Dead-code code review of a change set or a whole repository, in any
  programming language. Finds code that nothing reaches from any root (entry
  points, public API, tests, build targets, plugin and FFI exports, other
  repositories): unused exports and functions, orphaned modules, stale
  re-exports, dead branches and flags, commented-out blocks. A script builds a
  whole-tree reference index and lists candidates, roots, and public-API
  status; the model confirms each finding from a language server, text search,
  or reading, and treats public API and other repositories' callers
  conservatively. Reports findings with a proposed change and never edits
  files, commits, or posts. Use when asked to find dead code, prune unused
  symbols, check whether a symbol can be removed, or as a review lens under
  run-review-lenses.
---

# Dead Code Code Review

Find code that nothing needs anymore, and propose deleting it. A symbol is dead
only if it is unreachable from every root of the dependency graph. The public
API of the repository is itself a root: other repositories that use this one as
a library reach every symbol the API exposes, with zero references inside this
repository. Prefer evidence of zero callers over impressions.

Read `../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md` and follow them. This skill
is a review lens. It works standalone and under `run-review-lenses`.

**Contract.** The output is findings. Each finding has a concrete proposed
change: what to change, where, and the check that would verify it, as text or a
patch snippet in the report. The skill does not edit files, commit, push, or
open or comment on pull requests or issues. The user, or a separate task,
applies the change. The script writes only the findings file named by `--out`,
and that file must be outside the repository under review.

**Division of labor.** The script covers exported declarations and re-exports
that only two files name, with whole-tree evidence. The model covers everything
else by reading (chains of barrels, dead branches, flags, comments, unused
imports and locals, orphaned files, test-only symbols, code in languages the
script has no pattern for), using the same roots and visibility rules. The
model also confirms or overturns every script finding.

## Invocation modes

- **Standalone.** Resolve the scope (below), run the procedure, and return the
  compact markdown report from the lens protocol: a one-line verdict
  (`needs-attention` or `approve`), the mode and scope in one line, a short
  summary, and findings ranked by severity with file, line, impact, and
  proposed change. Add the roots considered, the open roots, and which
  languages used which evidence source. Write no `review.json`.
- **Fan-out.** When the prompt says "structured findings" or names the wire
  format, return only the structured list and a one-line headline
  (`needs-attention` or `approve`). Use the scope the orchestrator passed. Do
  not re-derive or widen it. A fan-out lens does not run `gh` (lens protocol),
  so pass `--no-gh`: candidates that need the cross-repository search become
  `unknown` refusals. Overturn one only when the judgment pass shows the code is
  not visible outside the repository (a private or unpublished package, no
  public path), and otherwise report it as a `low` finding whose `suggested_fix`
  names the search to run. A fan-out run cannot ask the user, so unresolved
  roots keep their candidates refused, and the questions go into one `low`
  finding (see "Wire format"). Ask in standalone mode only.

### Scope

Reachability, roots, public API, and consumer evidence are always computed over
the whole repository at HEAD. The scope limits only which declarations become
candidates, and which code the model reviews. Never narrow the evidence search
to the diff.

| Mode | Candidates and review surface | Script flags |
| ---- | ----------------------------- | ------------ |
| `diff` (default) | Code the change adds, moves, or stops calling; declarations in touched files; declarations the change orphans | `--base <base>`; add `--working-tree` for uncommitted work |
| `repo` | Every declaration, by logical area | none |
| `paths` | Declarations under the named paths | `--scope <path>` (repeatable) |

An orphaned symbol is one named in removed lines whose last reference the diff
removes: the diff removes more occurrences than it adds, and only its
declaration remains at HEAD. The script finds these by comparing counts from
the diff. `scan.mjs diff-scope --base <base>` prints the touched files, the
orphaned symbols, and the symbols named only in removed lines (gone at HEAD:
check that nothing still needs them, such as a string or a doc). The default
base is `origin/main`. `--base` and `--scope` combine. A named range (`A..B`,
`A...B`) is diffed as given, and must end at the checked-out revision, because
the index reads the checked-out files. Resolve a pull request to its base ref before the
call, for example with `gh pr view --json baseRefName`. The script reads the
working tree, so with `--base` and no `--working-tree` it warns (in `warnings`
and on stderr) when the tree has uncommitted changes: the evidence then
reflects those changes, not HEAD.

## Evidence sources

Use the strongest source available for each finding and record it in
`evidence_source`:

| Value | Source | Use for |
| ----- | ------ | ------- |
| `lsp` | Language server: find-references, workspace and document symbols, call hierarchy, diagnostics, code actions | References, definitions, callers, overrides, expression types, unused and exhaustiveness diagnostics |
| `text` | `rg` or `git grep`, and the script's token counts | When no language server exists. Names in comments and strings count as references. |
| `read` | Reading the code and its callers | Everything the other two cannot show: dynamic access, generated code, conventions |

Check at the start whether a language server is configured or startable for
each language in the repository (an editor or agent LSP tool, or a server such
as `gopls`, `rust-analyzer`, `pyright`, `jdtls`, `clangd`,
`typescript-language-server`, `LanguageServer.jl`). Prefer it over text search
for reference counts. When none exists, use `rg` or `git grep` and read the
code. Say in the report which languages had a server and which evidence source
each finding used. `references/languages.md` lists, per language, how to find
roots and public API. The script's declaration patterns are tested for
TypeScript, Python, Go, Rust, Java, C, and Julia, and its root detection for a
subset of them (see the top of that file). Everything else in that file is
guidance.

## Requirements

- Node 20 or later and a git repository. The script needs no other package.
- Optional: a language server for each language, and `gh` (authenticated) for
  the cross-repository search.

## Procedure

1. **Find the roots.** Read what the project documents first (README,
   CONTRIBUTING, manifests, build files, CI). Then list every root class that
   applies, from `references/languages.md`:
   - entry points: `main` functions, binaries, CLI and server entry files;
   - the public API of libraries and packages, discovered at run time (see
     "Public API"). Every symbol reachable from it is live, including types a
     public function takes or returns;
   - build targets and scripts, and CI steps that run files directly;
   - test entry points and test setup files;
   - build and tool configs that import code, plugin or loader registries;
   - framework conventions: file-based routes, handlers, migrations, stories,
     annotation or decorator wiring;
   - FFI and export attributes (symbols named from other languages or binaries);
   - dynamic loading: computed imports, reflection, string-keyed registries;
   - non-code consumers: docs, templates, schemas, config naming symbols;
   - other repositories and published consumers.
2. **Run the script** from the repository root:

   ```bash
   node <skill-dir>/scripts/scan.mjs --out "$(mktemp -d)/findings.json"
   ```

   Check machine load first on a large repository. Pick the scope flags from
   the scope table. `--scope <path>` and `--base <ref>` limit the candidates;
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
     `roots.unresolved` (the script knows a fixed list);
   - the project documents no entry points and you cannot find them.

   Ask, after reading the project's own docs, only about what stays open. One
   message, in this form: "The scan could not evaluate these roots: `<ids and
   detail>`. For each, which files or symbols does it load or call, or is it
   not used here?" For publication, the question is: "Which packages or
   directories are public API, and which other repositories consume them?" Pass
   the answer as `--public-api <path>` and `--not-public <path>`. For other
   roots, record the answer in two parts. Pass `--accept-root <id>:<path>` (or
   `--accept-root <id>` for all files) for paths the user says the root does not
   load; this only lifts the refusal. Pass the names of symbols the root does
   load with `--keep`, and treat the files it loads as live roots in the
   judgment pass. Then rerun, or keep the candidate refused. `--accept-root other-repositories`
   means `--no-external`. A candidate reachable only from a root the script did
   not evaluate is a refusal with category `unevaluated-root`.
4. **Judgment pass.** For every script finding, candidate or refusal, read the
   code around it and its callers, and confirm or overturn the script.
   Establish from the language server, text search, or reading whether the
   symbol is published (library API, exports map, public header, `pub`,
   capitalized Go name, `__all__`), reachable from any root in step 1, and
   named in other repositories. Set on each finding `judgment` to `confirmed`
   (for a refusal: the refusal stands), `downgraded`, `dropped`, or
   `overturned` (a refusal that is in fact dead), with `judgment_reason` and
   the `evidence_source` used. A script verdict alone never justifies a
   proposed change.
5. **Review what the script does not cover.** Read the surface in scope for
   the dead code of "What counts as dead" that the script does not list, and
   report each defect as a finding with `source: reviewer` (the script's own
   findings have `source: script`). Include:
   - files in `skipped_files`, file types in `binary_file_types`, and readable
     files in `unlisted_file_types` (languages with no declaration pattern),
     and declarations the pattern misses;
   - dynamic access: string keys, reflection, plugin and config loading,
     generated code;
   - the neighborhood of each finding: siblings with the same shape (other
     members of the same enum or set, other re-exports in the same file, other
     files in the same directory).
6. **Write the report.** Write the findings JSON (script and reviewer findings
   together) and run `node <skill-dir>/scripts/scan.mjs validate
   <findings.json>`. In fan-out mode, return the wire format (see "Wire
   format") and stop. Otherwise give the standalone report: findings first, by
   severity, each with its `source`, `evidence_source`, judgment, and proposed
   change; then refusal counts by category; then the open roots, if any.

## What counts as dead

Prioritize:

- **Unreachable functions, methods, and types**: no remaining in-repository
  callers from any root, not part of a required interface implementation, not
  named by a generated table or registry. The script lists exported
  declarations whose name occurs once (`dead-export`).
- **Stale re-exports**: barrels that still export a symbol nothing consumes
  (`dead-reexport`). The fix is to delete the re-export and keep the
  declaration.
- **Names that occur more than once but are all dead**: a cycle, a helper used
  only by a dead function, a use only in a comment or string. Find these with
  call hierarchy or find-references.
- **Unused imports, locals, and private helpers** the change leaves behind. A
  compiler or linter reports these in most languages (`noUnusedLocals`,
  `unused` lints, `go vet`, `-Wunused`). Check that the project enables one,
  and report them only when it does not.
- **Orphaned files and modules** that nothing imports or builds.
- **Dead branches**: `if (false)`, feature flags that are always off with no
  write path, call sites removed with a `TODO` that leave an unused
  implementation.
- **Commented-out code blocks** that the change adds or leaves next to live
  code.
- **Test-only production symbols**: production helpers only referenced from
  tests after the product path moved on. Tests are roots, so the script treats
  these as live. Propose moving them to test support. Propose deleting them
  only together with the affected test changes and a reason their coverage is
  not needed.

Do not flag as dead without extra care:

- **Public, exported, `pub`, or package-visible API.** See "Public API" and
  "Other repositories".
- **Symbols named by strings**: DI containers, routers, reflection,
  serialization, RPC schemas, plugin manifests, CI configs, infrastructure
  code, dashboards. The script counts a string that holds the name as a
  reference. Search for the dispatch mechanism when the repository has one.
- **Overrides** that implement an interface, trait, or protocol the type still
  needs.
- **Code behind a flag that is still toggled** in config or remote defaults.
- **Vendored or generated sources**, unless the generator input is also gone.

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
supports the verdict and never replaces this root: finding no consumer does not
make a public symbol dead. Only the user can say that a package or directory is
not public API. Do not guess. Separately, the model may overturn the refusal
for one symbol, as described below.

The script marks a package public from its manifest (`package.json` without
`private: true`, a Cargo library target without `publish = false`, a Go module,
a Julia `Project.toml` with a name), private from the opposite, and unclear for
every other manifest and build file. The model overturns a `public-api` refusal
for one symbol only after it shows, from the language server or reading, that
no public entry point reaches it, directly or through a signature. A user's
answer that a path is not public API settles the whole path and needs no
per-symbol trace.

The paths named with `--public-api` and `--not-public` are relative to the
current directory, so run the script from the repository root. The most
specific path wins, and the same path on both sides is an error. One answer
settles the question for the paths it names. Ask about each package that is
still open.

## Other repositories

Dead-code claims fail open for anything that might be used outside this
checkout. Before proposing removal of a symbol that is visible beyond the
package or private module:

1. **Classify visibility.**
   - *Internal*: file-private, module-private, or package-private with no
     escape hatch. In-repository evidence is enough.
   - *Public in the repository*: used by other packages of a monorepo. Search
     the whole workspace, not one package.
   - *Library or exported API*: `export`, `pub use`, published entry points,
     stable HTTP or RPC paths, CLI commands, shared protos. Assume external
     callers until shown otherwise.
2. **Search beyond the repository** when the surface is public. The script
   runs `gh search code <name> --owner <owner>` for each candidate (the owner
   is `--org` or the owner of the `origin` remote). Also search by import-path
   strings, route paths, event names, proto service methods, and CLI flag
   strings, and check sibling checkouts that exist locally. If `gh` is missing,
   not authenticated, or the owner is unknown, do not claim a search. The
   script gives the verdict `unknown`, a refusal. State that exported API is
   potentially callable.
3. **Let the target drive the search.** An application binary or private
   service: favor in-repository evidence and deploy configs. A shared library,
   SDK, or proto package: always search other repositories before proposing a
   deletion. A monorepo package: search every workspace member and any
   documented external consumer.

`--no-external` skips the cross-repository search. Use it only when the user
states that the repository has no consumers elsewhere, and say so in the
report. Without `gh` and without `--no-external`, nothing is a candidate: say
that outright instead of calling the repository clean. The search waits
`--pace-ms` between calls, because GitHub rate-limits code search.

## What the script sees and does not see

| Check | The script sees | The model must cover |
| ----- | --------------- | -------------------- |
| `dead-export` | A declaration line, in a supported language, whose name occurs once in all readable text files. | Names that occur more than once but are all dead. Declarations with no keyword on the line (C functions, methods, Java methods, Go `type (` blocks, Julia short functions). Languages not in the table. |
| `dead-reexport` | A re-export line whose name occurs in exactly two files, two times. | Whether the second file declares the name. Re-exports the line pattern misses. Glob re-exports, which carry every name. |
| Visibility | A hint from the declaration line (`exported`, `public-by-convention`, `unknown`). | Whether the package publishes the file: manifests, export maps, public headers, module systems, build visibility. |
| Public API | A package-level status from the manifest (`public`, `private`, `unclear`), and the exported hint of each declaration. | Which exported symbols a public entry point reaches, including through signatures. Packages whose manifest says nothing about publication. |
| Roots | Manifests, `main` functions, files named in build and CI files, tests, tool configs, docs and data read by name, framework paths from a fixed list, directories that usually load by path, computed loads, FFI attributes. | Everything else in step 1, including frameworks outside the list and how a build maps output to source. |
| Other repositories | `gh search code` hits for the symbol name under one GitHub owner. | Consumers under other owners, binary consumers, and consumers that import a renamed alias. |
| Branches, flags, comments, imports, locals, files | Nothing. | All of it, by reading. |
| Binary and large files | Reports them. Files over the size limit block every candidate (`unread-files`) until read or accepted. | Reading them if they can name symbols. Binary files are not tokenized. |

The script reads every text file up to `--max-file-bytes`. Symlinks are skipped.
A name in a comment or a string counts as a reference, so the script reports
less than the full dead set. A name used only in a binary file or in a file the
script does not recognize as text is not counted.

## Refusals

The script refuses a candidate, with a category, when:

| Category | Rule |
| -------- | ---- |
| `kept-by-caller` | The name is in `--keep`. Pass names of deliberately unreferenced symbols: coverage exemptions, deprecation tables, registries. |
| `underscore-name` | A leading `_` marks a name as intentionally unreferenced. |
| `side-effect-initializer` | The declaration line calls code or declares several names, so removal may remove an effect. |
| `test-support` | The file is under a fixture, sample, mock, or example directory. |
| `doc-in-directory` | The directory holds a README, DESIGN, or ARCHITECTURE file. A symbol that completes a documented set is not dead because nothing uses it yet. |
| `public-api` | The package is published as a library and the symbol is exported (hint `exported`, `public-by-convention`, or `unknown`). Searched in other repositories too, for evidence. |
| `unevaluated-root` | A root the script could not evaluate may load the symbol, including `manifest` (no manifest or build file above the file), `publication-status:<dir>` (the manifest does not say whether the code is published), and `unread-files` (files over the size limit). |
| `exported-with-hits` | Another repository names the symbol. |
| `unknown` | The cross-repository search could not run or failed (no `gh`, not authenticated, unknown owner, rate limit, a full page of own-repository hits, or the `--max-external` limit). |

`--accept-root <id>` takes the full id, and `--accept-root <id>:<path>` limits
it to a path (`framework:next:pages/a`). A refusal is a prompt to read the
code, not a verdict. When the judgment pass overturns one, say why in
`judgment_reason`.

## Severity

- `blocker`: only when the dead code is harmful: a security-sensitive dead path
  or a broken leftover. Never for an exported symbol that no one searched for
  outside this repository.
- `high` or `medium`: clear internal dead code with a root story and evidence
  from a language server or reading. The script sets `medium` for
  `dead-export`.
- `low`: public candidates pending verification (say what to confirm), the
  script's `dead-reexport`, and open roots.

If you only suspect dead public API, skip it or file `low` with the
verification steps.

## Output

The script's JSON has `tool`, `scope`, `generated_at`, `warnings`, `counts`,
`roots`, `skipped_files`, `binary_file_types`, `unlisted_file_types`, `diff` (in
diff scope), and `findings`. `roots` has `found` and `unresolved`, each a list
of `{id, kind, detail}`.

| Finding field | Value |
| ------------- | ----- |
| `id` | `dc-N` |
| `source` | `script` or `reviewer` |
| `evidence_source` | `lsp`, `text`, or `read` |
| `severity` | `medium` for `dead-export`, `low` for `dead-reexport`, `question` for a refusal. The model may change it to `blocker`, `high`, `medium`, or `low`. |
| `check`, `file`, `line`, `symbol`, `language` | The candidate |
| `diff_reason` | In diff scope: `touched` (the file is in the diff) or `orphaned` (the diff removed its last reference) |
| `visibility_hint`, `external` | The script's hint, and `none`, `hits`, `unknown`, `skipped`, or `not-run` |
| `evidence` | What was checked and found, including the searches run |
| `proposal` | The proposed change: where, what, and the check that verifies it. For a public candidate, the verification to run first. |
| `judgment`, `judgment_reason` | The model's decision on a script finding |
| `refused`, `category`, `reason` | Present for refusals |

A `reviewer` finding has the same fields, with `source: reviewer` and no
script verdict fields. Exit status of the script: 0 when it found no
candidates, 1 when there are candidates or refusals for the judgment pass, 2
when it could not run. `validate` exits 2 and lists the problems when a finding
lacks a source, an evidence source, a proposal, or (for a script finding) a
judgment with its reason.

## Wire format

In fan-out mode, report the findings that survive the judgment pass as
`{ source, path, line, severity, title, body, suggested_fix, evidence }`.
`node <skill-dir>/scripts/scan.mjs wire <findings.json>` prints that array from
a judged findings file. `scan.mjs --format wire` prints it straight from a scan.
Those findings are unjudged candidates: severity `low`, title prefixed
`Candidate:`, `evidence` reads `Inferred`, and the body says to confirm before
acting. Return them only as input to the judgment pass, not as the final
fan-out answer. Both write only to stdout or `--out` and print the headline on
stderr.

| Wire field | From |
| ---------- | ---- |
| `source` | `dead-code-code-review`. The finding's own `script` or `reviewer` goes in `body` (`Finding source: ...`). |
| `path`, `line` | `file`, `line` (`.` and `null` for open roots) |
| `severity` | `blocker`, `high`, `medium`, `low` as set; `nit` and `question` map to `low` |
| `title` | The finding's own `title` when it has one, else `Remove unused <symbol>` or `Remove re-export <symbol>`. For a candidate that needs verification first, set `title` to `Verify external callers before removing <symbol>`. |
| `body` | `signal`, the judgment and its reason, the finding source |
| `suggested_fix` | `proposal`: the delete or un-export steps. If it is not safe yet, the verification commands and the result that would allow removal. |
| `evidence` | `Verified: <lsp or read> evidence; <evidence>; roots considered: <ids>` when the model confirmed it from a language server or by reading, else `Inferred: ...` (text only, or unjudged). `<evidence>` names the searches run (`gh search code ...`, or `gh unavailable; treated exported as potentially callable`). |

Refusals (`public-api`, `unevaluated-root`, `unknown`, and the rest) are not
findings in fan-out. A refusal the judgment pass overturned is a finding. Roots
the script could not evaluate become one `low` finding whose `suggested_fix`
says to ask the user which files each root loads, which packages are public
API, and which repositories consume this one. Add at most a few more refusals
worth a look as `low`, with a `suggested_fix` that says what to confirm. The
headline is `needs-attention` when any finding is `medium` or above, else
`approve`. An empty list with `approve` is a valid result.

## Final check

Each reported finding must be about unneeded code, with a root story (which
roots were considered and why none reaches the symbol), an evidence source, the
caller and other-repository search that visibility requires, and a proposed
change with its verification. Do not report a symbol as dead while a root that
could reach it is unevaluated, and never propose deleting an export on faith.
