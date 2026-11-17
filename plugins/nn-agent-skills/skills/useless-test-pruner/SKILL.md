---
name: useless-test-pruner
description: >-
  Find test cases that run and cannot fail, in a repository written in any
  programming language, and propose a concrete change for each. Covers a case
  with no assertion, an assertion that holds for every input (the same
  expression on both sides, a constant, a matcher that accepts any value), a
  case that asserts without reaching any code the repo owns, a mock that
  asserts on itself, and duplicate cases. Uses the language server for symbol
  facts when one is available and text search and reading otherwise, and
  states which source backed each finding. Refuses snapshot-backed cases,
  skipped cases, and cases that assert through a helper. Reports findings and
  proposed changes; never edits files. Use when asked to find useless, vacuous,
  tautological, or always-passing tests across a codebase, to prune a test
  suite, or to audit test quality tree-wide. For a diff, use
  test-coverage-code-review.
---

# Useless Test Pruner

A test that cannot fail costs what every test costs and reports nothing. This
skill finds them across a tree, in any language, and proposes a change for each.

## Contract

The skill identifies changes and does not make them. It never edits a file in
the repository, never commits, and never opens or comments on a pull request or
an issue. Its output is findings. Each finding carries a proposed change: what
to change, where, and the check that would verify it, written as text or as a
patch snippet in the report. The user or a separate task applies it.

`scripts/scan.mjs` reads the repository and writes nothing to it. The only file
it writes is the one named with `--out`, and it refuses an `--out` path inside
the repository. Write your own report files (`reviewed.json`) outside the
repository too, in the system temp directory or at a path the user names.

## Method

Three checks, in the order of cost. Their definitions do not depend on a
language.

- **A, no assertion.** A case whose body, and the helpers it calls, contain no
  assertion. It can fail only by throwing.
- **B, assertion for any input.** An assertion whose truth does not depend on
  the code under test: the same expression on both sides, two equal constants,
  a constant `true`, a matcher that accepts any value (`anything`, `any`,
  `is not null` on a value that cannot be null), a mock that asserts on its
  own setup.
- **C, no repo code reached.** A case that asserts, but whose body and helpers
  reach no function, type, or value the repo owns. Dependencies, the standard
  library, and the case's own constants do not count.

Also look for cases that differ from another case only in their names.

`references/checks.md` states what each check means, what the script sees, and
what it cannot see. `references/languages.md` holds the per-language facts: test
runners, file names, case forms, assertion forms, snapshot and skip markers, and
mock idioms.

## Evidence sources

Symbol facts come from the language server when one is available. The facts are
what a name resolves to, where a helper is defined, what a helper asserts, what
calls a function, and whether a symbol belongs to the repo.

1. Check whether a language server is configured or can start for the language
   (an editor integration, the host's code-intelligence tool, or the server
   binary: `gopls`, `rust-analyzer`, `pyright`, `jdtls`, `clangd`,
   `typescript-language-server`, `LanguageServer.jl`, and others). Prefer it.
   Use document symbols to list cases and helpers, definition and
   find-references to resolve a call, and call hierarchy to follow a helper.
2. With no server, use `rg` or `git grep` for definitions and references, and
   read the code.
3. Record the source on every finding as `evidence_source`: `lsp`, `text`, or
   `read`. The script writes `text`. Raise it to `lsp` or `read` only when you
   confirmed the fact that way. If you could not start a server, say so in the
   summary.

## Run the script

The script is a lead generator. It is table-driven, has no dependency beyond
Node 20 or later, and reads text. A language needs one row in
`scripts/languages.mjs`.

```bash
node <skill-dir>/scripts/scan.mjs --out "$(mktemp -d)/findings.json"
node <skill-dir>/scripts/scan.mjs --scope pkg/core --exempt pkg/core/tree_test.go
node <skill-dir>/scripts/scan.mjs --list-languages
node <skill-dir>/scripts/scan.mjs --table my-language.json
```

| Option | Meaning |
| ------ | ------- |
| `--root <dir>` | Repository root. Default: git top level, else the cwd. |
| `--scope <path>` | Scan only this file or directory. Repeatable. |
| `--exempt <path>` | Refuse every case in this file. Repeatable. |
| `--languages <ids>` | Scan only these language ids. |
| `--table <file.json>` | Add or replace language rows. See `languages.mjs` for the fields. |
| `--out <file>` | Write the findings JSON here and print a ranked summary. Without it, the JSON goes to stdout. |

Exit codes: 0 no findings reported, 1 findings reported, 2 the scan could not
run (no test file matched a language row, no case was recognized, bad argument,
a scope outside the root, an unexpected error). Refusals alone give 0.

Built-in rows with a fixture in `scripts/scan.test.mjs`: TypeScript (a `.ts`
file with jest-style cases), Python (pytest and unittest), Go, Rust, Java
(JUnit), C++ (a googletest `.cc` file), and Julia. The same rows also match
JavaScript, C, and the other extensions in their `files` pattern, and that part
is guidance. Kotlin has a row and no fixture, so treat its output as guidance.
A row passed with `--table` is always reported as not fixture-tested. For any
other language, add a row, or skip the script and apply the method by
reading. The JSON
`languages` object says how many files and cases each row matched and whether a
fixture covers it. A row that matches files and zero cases is a row that does
not fit the repo's test style.

The script finds cases with line patterns and ends them by braces, indentation,
a call's parentheses, or `end`, after it blanks comments and string contents.
It runs on any language with one of those shapes. It does not parse. The JSON
lists `skipped_files`: files over 2 MiB, unreadable paths, and cases whose block
did not close. Check it before you trust a zero.

Check machine load before a scan of a large tree.

## What the script cannot see

Look here yourself. `references/checks.md` has the per-check detail.

- **A.** It matches assertion patterns. It cannot tell whether a called helper
  asserts, unless the helper is declared in the same file. Every call it cannot
  place makes the finding a `question`, and the finding lists those calls. A
  case that fails by throwing on purpose is reported.
- **B.** It reads the assertion forms in the language row. Other libraries,
  weak matchers on wide values, and mocks that assert on themselves are not
  reported. A repeated expression is a `medium` lead: equality can fail to be
  reflexive (NaN, an overloaded operator) and a getter can change between
  reads.
- **C.** The script does not run it. It needs symbol resolution.
- **Everything.** Duplicate cases, test files in a language with no row, tests
  under names the row does not match, and files in `skipped_files`.

## Judgment pass

Run it after the script, and for every language the script does not cover. A
script verdict alone never justifies a proposed deletion.

1. Read the code around every reported finding and every refusal group. Read
   the case, the code it calls, and the callers of any helper. Use the
   evidence sources above. Confirm or overturn each from that code.
2. Mark each finding `confirmed`, `downgraded`, or `dropped`, with one line of
   reason and its `evidence_source`. Overturn a refusal only with a reason from
   the code.
3. Run check C yourself. For each case that asserts, resolve what its body
   reaches. A case that reaches only dependencies, the standard library, or
   its own constants is a `question` finding.
4. Survey the same defect class where the script cannot look: cases that assert
   only through helpers, weak matchers on wide values, mocks that assert on
   themselves, cases that differ only in their names, test files in other
   languages, and files in `skipped_files`. Inspect each candidate. A shape
   alone is not a defect. Report a reviewer finding only when you confirm the
   case cannot fail.
5. For each proposed deletion, state what behavior the test was meant to pin,
   and confirm that another test or the type system covers it. If neither does,
   propose a repaired assertion, not a deletion.

## Refusals

A refused candidate is not a finding. The JSON keeps it with its reason, and
`counts.refused_by_reason` totals them. Report the totals.

- A snapshot-backed case. The stored file is the assertion. Never a candidate,
  even when the case also holds a tautology.
- A skipped, disabled, or `todo` case. "Does not run" is a different argument
  from "runs and cannot fail".
- A case that asserts through a helper declared in the same file.
- A case that holds nested cases. Each nested case is judged on its own.
- A case in a file passed with `--exempt`.

Refuse these yourself when you find them by reading: a case that pins a
dependency's behavior on purpose, a whole-tree check that reads the source and
compares it to a list, an aggregate guard over state other cases write, a
placeholder case that a test runner requires, and a deliberate does-not-throw
check.

## Output

`findings.json` is the script's output. Each finding has `source: "script"` and
`evidence_source: "text"`. Keep it as written. Write the judgments and your own
findings to a separate `reviewed.json`: a copy of the findings with a
`judgment`, a `reason`, and an `evidence_source` on each script finding, plus
the reviewer findings. A reviewer finding has `source: "reviewer"` and the same
fields as a script finding.

Script findings carry `change`, `where`, and a generic `verify` as provisional
text. In `reviewed.json`, make them specific. Every finding that is not dropped
has a proposed change with three parts:

- `change`: what to change, as text or a patch snippet.
- `where`: file, line, and case.
- `verify`: the check that shows the change is right, such as the command that
  runs the changed test, and a mutation of the code under test that the new
  assertion must catch.

Give a short ranked summary: the counts line, then each finding as `severity
[source/evidence_source] file:line`, the defect, the judgment with its reason,
and the proposed change, then the refusal totals and the languages and evidence
sources used. Rank `high`, `medium`, `question`.

Proposed changes by shape:

- Same expression on both sides: assert the subject against the value the case
  is about, which is a different expression than the one on the left.
- A repeated call or a value that varies: compare two independently
  constructed values, or assert the form the case title claims.
- A constant assertion or a matcher that accepts any value: assert the value
  the code under test produces.
- No assertion: restore the assertion the title names, or delete the case.
- No repo code reached: confirm the case covers nothing the repo owns, then
  delete it.

Restore an assertion in preference to deleting a case whose title names a
property. The title shows someone meant to check it. Delete when a sibling case
already checks the property. Deleting the last case in a file deletes the file;
name any test file that imports a helper from it.
