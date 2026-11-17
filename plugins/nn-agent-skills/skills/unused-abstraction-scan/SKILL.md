---
name: unused-abstraction-scan
description: >-
  Find indirection that no code reads, in any programming language: a
  configuration or options field whose own comment says it has no effect, a
  parameter or type with zero readers, an options or config type with no
  members threaded through signatures, and wrappers or pass-through options
  that nothing needs. The model uses a language server when one is available
  (find-references, diagnostics) and falls back to text search and reading,
  with small text-based helper scripts. Every finding carries evidence, a
  judgment from reading the code, and a concrete proposed change; a symbol
  that may be used outside its package is reported as a refusal. The skill
  reports and proposes; it never edits files. It reviews a change set or a
  whole repo. Use when asked to find unused abstractions, inert options, dead
  configuration, pointless parameters, or over-built interfaces, or as a review
  lens under run-review-lenses.
---

# Unused Abstraction Scan

Some indirection has no consumer: a field nothing reads, an options type with
no members, a parameter the implementation ignores. This skill finds it and
proposes the smallest change, with the evidence that no code needs it.

## Invocation and scope

This skill is a review lens. Read
`../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md`, and follow them. Two modes:

- **Standalone** (the user invoked the skill): resolve the scope mode
  (`diff` default, `repo`, or `paths`), state it in one line, and return the
  compact markdown report the protocol describes, with the summary in the
  Report step below.
- **Fan-out** (the prompt says "structured findings" or names the wire format):
  use the scope the orchestrator passed and never re-derive it. Return only the
  structured finding list and a one-line headline, `needs-attention` or
  `approve`. See the wire-format table in the Report step.

Scope limits **candidates**. It never limits **evidence**: reader counts,
callers, and consumer verdicts are always computed over the whole repository.

| Mode | Candidates | How |
| ---- | ---------- | --- |
| `diff` (default) | Files, symbols, and neighbors the change adds, moves, or touches. | `--diff [--base <ref>] [--working-tree]` on `inert`, `empty-types`, and `ignored`. `diff-scope` prints the changed paths. `--working-tree` uses the net change from the merge base to the working tree, plus untracked files. A range or pull request is passed as `--base <base>..<head>` with its two refs. Add neighbors by reading: callers of changed symbols, types a changed signature uses. |
| `repo` | The whole tree. | No scope flag. Work through logical areas and say what you skipped. |
| `paths` | Only the named paths. | `--scope <path>` (repeatable). With `--diff`, a file must satisfy both. |

`refs` and `verdict` take no scope option, because narrowing the evidence to
the diff would make a field read elsewhere look unread. A change that removes
the last reader of a field is a candidate even when the field's file is not in
the diff: read the removed lines and search the symbols they used.

## Contract

The output is findings. Each finding has a concrete proposed change: what to
change, where, and the check that verifies it, written as text or as a patch
snippet in the report. The skill does not edit files, commit, or open or
comment on pull requests or issues. The user, or a separate task, applies the
proposals.

The helper scripts do not write to the repository. The only file they write is
the findings file you name with `--out`. Name a path outside the repository.

## Checks

Each check is defined without reference to a language. `references/languages.md`
gives the forms in each language.

| Check | A finding when |
| ----- | -------------- |
| `inert-doc` | A comment on a configuration or options field, or on a parameter, says it is not implemented or has no effect, and nothing reads it. |
| `unread-param` | A parameter, or a type used only by such parameters, has zero readers. The language's unused-parameter convention (`_name`, `_`, a lint rule) often marks it. |
| `empty-options` | An options or config type has no members and is threaded through signatures. |
| `reviewer` | Indirection found by reading: wrappers that only forward, options passed through layers and read at none, interfaces with one implementation that exist by habit. |

## Method

### 1. Choose the evidence source

Record which source backs each claim, per finding: `lsp`, `text`, or `read`.

1. **Language server (`lsp`).** Check whether one is configured in your
   harness or startable for the language (`references/languages.md` lists
   common servers; test with `command -v`). Prefer it for every semantic
   fact: references to a symbol (find-references), where it is declared
   (document and workspace symbols), who calls it (call hierarchy), unused
   diagnostics and code actions. A language server resolves aliases,
   re-exports, and shadowing that a text search cannot.
2. **Text (`text`).** When no server exists or it fails, use
   `scripts/survey.mjs` or `rg` and `git grep`. A text count proves that a name
   has no match, not that nothing uses the thing.
3. **Reading (`read`).** Open the declaration, its callers, and the code that
   receives the value. Every finding needs this, whatever else backs it.

Say in the findings which sources were used. If you tried a server and it
failed, say that too.

### 2. Find candidates

Run from inside the target repository. Node 20 or later, no packages. The
scripts are text-based and work on any language. They print JSON.

```bash
node <skill-dir>/scripts/survey.mjs inert          # comments saying "has no effect"
node <skill-dir>/scripts/survey.mjs empty-types    # empty type declarations (listed forms)
node <skill-dir>/scripts/survey.mjs ignored        # _options-style identifiers
node <skill-dir>/scripts/survey.mjs refs NAME      # text matches, production vs test
node <skill-dir>/scripts/survey.mjs verdict SYMBOL FILE   # does it leave its package
```

Options: `--scope`, `--diff`, `--base`, and `--working-tree` limit candidates
(see Invocation and scope), `--ext .x` adds a source extension, `--phrase` and
`--pattern` change what `inert` and `ignored` look for. Every candidate command
prints the resolved `scope`.
Every command lists `skippedFiles`: source files and directory symlinks it
could not read (a symlink outside the tree, a file over 2 MB, an unreadable
file). It also lists `excludedDirs`: source trees it did not scan, such as
`vendor` and `build`. Search the ones that matter before you report. Candidates come from
these helpers, from lint and compiler diagnostics for unused parameters, and
from reading.

### 3. Consumer verdict

A deletion is safe only if the symbol stays inside its package. `verdict`
finds the nearest manifest, names the package, and answers:

| Verdict | Meaning |
| ------- | ------- |
| `internal-only` | The package is private (or the user passed `--assume-unpublished`) and no other package in the repository names the symbol. |
| `exported-with-hits` | Another package in the repository names the symbol, or `gh search code` finds it in another repository. |
| `exported-no-hits` | The package is published and `gh search code` found nothing. The code index is incomplete, so this is a refusal. |
| `unknown` | The question could not be asked: `--offline`, no `gh`, no login, an unnamed package, or more than 10 queries. This is a refusal. |

Only `internal-only` clears a proposal. `verdict` knows manifests for
`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`, and
`Project.toml`, and a Go `internal/` directory. For any other build system,
reason about visibility from the code and the build files, and say so.

The verdict covers a symbol's name. A caller can pass a field in an object
literal or a keyword argument to a public function without naming the type, so
the proposal's verifying check (the build, type check, or tests) decides.

### 4. Judgment pass

The helpers and any single tool give candidates. Do this before you report. A
script verdict alone never justifies a proposal.

1. **Check every candidate and every refusal against the code.** Open the
   declaration, its readers, and its callers. Record `confirmed`,
   `downgraded`, or `dropped`, with the reason in one line. A refusal can be
   wrong: a field read only by a no-op copy is inert, and a hit that is an
   unrelated name in another package is false. To overturn a refusal, you need
   `lsp` or `read` evidence, written in `judgmentReason`. Report the result as
   a `source: reviewer` finding with `refused: false`.
2. **Survey what the helpers cannot see.** See the table below, and look for
   other indirection that nothing reads: wrappers that only forward, options
   passed through layers and read at none, interfaces with one implementation
   that exist by habit. Weigh each against a documented reason for the shape:
   a seam, a published contract, a test double, or a file comment or design
   doc that argues for it. Report only what the code supports.
3. **Read the files in `skippedFiles`** that you can open, and search them for
   reads of every symbol you report. If you cannot establish that a skipped
   file holds no reader, keep the refusal.

If a design document, README, or the file's leading comment argues for the
shape, quote it in `evidence` and weigh it. It does not decide the finding.

What the helpers cannot see:

| Check | Where to look |
| ----- | ------------- |
| all | Callers in other packages or other languages that pass the value without naming the type. Reads through reflection, serialization, dynamic lookup, or a framework that wires by name. Generated code. Files in `skippedFiles`. |
| `inert-doc` | Inert fields with no comment, or a comment in other words. A comment that is wrong: read the code that receives the options. |
| `unread-param` | Function bodies. The helpers do not parse them. Read each function to see whether it uses the parameter or passes it on. Parameters not named like options. |
| `empty-options` | Each use of the type: a parameter, a field, or a generic argument. A marker type may be intentional. |

### 5. Report

Compose the findings as JSON and pipe them to `report`, which validates and
summarizes them. Do not create the input file inside the repository.

```bash
node <skill-dir>/scripts/survey.mjs report - <<'EOF'
{"skippedFiles": [], "excludedDirs": [], "findings": [ ... ]}
EOF
```

`report` checks the shape, counts, and ranks. It writes a file only when you
pass `--out <path>`: add it in standalone mode when the user wants a findings
file, with a path outside the repository, and omit it in fan-out mode. It
refuses to replace a file that is not an earlier findings file. It exits 1 when
at least one finding is reported, 0 when none, 2 on invalid input.

Each finding has `id`, `source` (`script` for a candidate that a helper
produced and you confirmed, `reviewer` for one you found or changed), `check`,
`severity`, `file`, `line`, `symbol`, `evidenceSource` (`lsp`, `text`, `read`,
or a list), `evidence`, `proposal`, `refused`, `judgment`, and
`judgmentReason`. A refusal also has `reason`, and its `proposal` is `"none"`.
A refusal worth a reader's time also has `worthALook: true` and, when useful,
`confirm`: what to check.

Every `proposal` states a concrete change: what to delete or change, where,
and the check that verifies it. Use a patch snippet when it is short. Name the
tests that mention the symbol: a test that asserts an inert field may record
intended behavior, so the user decides whether to change or drop it. When a
change leaves a type with no members, propose that removal as a separate
finding, because it changes the signatures typed by it.

The summary to the user (standalone mode) has:

- a one-line verdict (`needs-attention` or `approve`) and the scope mode,
- the counts,
- each candidate with its judgment and the reason,
- the reported findings, ranked by severity then path, each with the
  evidence sources, file, line, and proposal,
- the `source: reviewer` findings in the same form,
- the refusals worth a look. A comment that says "no effect" next to code that
  reads the field is one: the comment and the code disagree and a person
  decides which is wrong.

### Wire format (fan-out)

Add `--wire` to `report` to print the review-lens JSON array on stdout and the
headline on stderr (`headline: needs-attention` when the array is not empty,
else `headline: approve`). Omit `--out`. Return the array and the headline, and
nothing else.

| Wire field | Value |
| ---------- | ----- |
| `source` | `unused-abstraction-scan` |
| `path`, `line` | The finding's `file` and `line`. |
| `severity` | `high`, `medium`, or `low` as in the finding. This lens does not use `blocker`. A refusal is `low`. |
| `title` | `<check>: <symbol>`. |
| `body` | The `evidence`, then `finding source: script` or `reviewer`, the judgment, and its reason. |
| `suggested_fix` | The `proposal`. For a refusal, `Confirm: ` and the `confirm` text (or the `reason`). |
| `evidence` | `Verified: ` when `lsp`, or both `text` and `read`, backed it, else `Inferred: `. Then the sources, `finding source: ...`, and the evidence. |

Refusals are not findings in fan-out. Only a refusal marked `worthALook` is
listed, as `low`, and at most 5.

## Overlap with other lenses

This skill covers inert options (documented as no effect), unread parameters,
and empty options types. Its sibling skill `single-use-abstraction-scan`
covers abstractions that can collapse because one caller uses them. The
`dead-code-code-review` lens covers symbols and branches nothing calls. The
`ai-slop-code-review` lens covers generated residue and needless wrappers. One
symbol can match more than one: an options field that nothing reads is dead
code and an inert option. Report it under this skill when a comment or a
parameter convention marks it as an option, and put the symbol name in the
`title` so the merge can deduplicate by path, line, and symbol.

## Refuse when

- The verdict is anything but `internal-only`.
- Code reads the field, and the judgment pass does not show the read to be a
  no-op.
- One function ignores an option that other functions read. That function does
  not need it, and the option is live.
- The only readers are tests. A test that asserts an inert field is a finding
  for test review, not for this skill. Name the test in the proposal.
- The same change is already proposed elsewhere in the run.
- The shape exists to isolate a seam. A wrapper with one caller is not a
  candidate: the indirection is the point, and the file or its docs usually
  say so.
- A skipped file might hold a reader and you cannot open it.
- The judgment pass overturns the finding.
