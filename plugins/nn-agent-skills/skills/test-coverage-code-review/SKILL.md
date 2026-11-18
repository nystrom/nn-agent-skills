---
name: test-coverage-code-review
description: >-
  Test-coverage code review of a change set or a whole repository, in any
  programming language. Finds missing, weak, or misleading tests for new and
  changed behavior: untested happy paths, untested failure and edge paths,
  assertions that do not lock the behavior, brittle snapshots that hide
  regressions, tests deleted or skipped without replacement, and coverage gaps
  at integration boundaries. Also finds useless tests (a case with no
  assertion, an assertion that holds for every input, a case that reaches no
  code the repo owns, tautologies, mocks that assert on themselves, duplicates,
  coverage theater) with a script-backed whole-tree scan, and proposes a change
  for each. Uses the language server for symbol facts when one is available and
  text search and reading otherwise, and states which source backed each
  finding. Reports findings and proposed changes; never edits files. Use when
  asked whether a PR is tested enough, for a test-coverage review, to find
  useless, vacuous, or always-passing tests, to prune a test suite, or as a
  review lens under run-review-lenses.
---

# Test Coverage Code Review

Review the change set, or the whole repository, for **whether the behavior it
has or introduces is actually locked down by tests**, and whether the tests it
adds or keeps are worth their cost. Coverage here means behavioral coverage:
the right paths and failure modes, not a line-percent number from a tool (use
that as a hint when present, never as the verdict). A suite that is green but
proves nothing is a coverage failure too; propose a change for those tests.

Read `../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md` and follow them.

## Division of labor

- **Missing and weak coverage** is a judgment about behavior. You do it by
  reading: list the behaviors, find the tests, judge what they assert. No
  script does this.
- **Useless tests** are found with `scripts/scan.mjs`, which gives candidates
  and whole-tree evidence, then you confirm or overturn each by reading. The
  script is a lead generator, not a verdict.
- Both produce findings of one shape, with a proposed change and the evidence
  source.

## Contract

This is a **review lens**. It returns findings and never acts: no file edits,
no tests written into the tree, no commits, no pull requests, no issues, no
comments. Each finding carries a proposed change: what to change, where, and
the check that would verify it, as text or a patch snippet in the report. The
user or a separate task applies it.

`scripts/scan.mjs` reads the repository and writes nothing to it. The only file
it writes is the one named with `--out`, and it refuses an `--out` path inside
the repository. Write your own report files outside the repository too, in the
system temp directory or at a path the user names.

**Standalone** (a user invoked the skill): resolve the scope, run the method,
and return the compact markdown report in "Output". **Fan-out** (the prompt says
"structured findings" or names the wire format): use the scope the orchestrator
passed and never re-derive it, return only the structured list and the one-line
headline, and do not act.

## Scope

Resolve the mode per `review-scope.md`:

| Mode | Behaviors and tests under review | Evidence |
| ---- | -------------------------------- | -------- |
| `diff` (default) | The net diff against `origin/main`, or the base the caller named, plus the working tree when asked. Production and test changes both. Useless-test candidates: test files the change touches and test files next to a touched file (`scan.mjs --diff <base> [--working-tree]`). | Repo-wide: helper definitions, reference counts, and other tests that cover the same behavior. Never narrow evidence to the diff. |
| `repo` | Every test file, queued by logical area. | Repo-wide. |
| `paths` | The named paths (`scan.mjs --scope <path>`). | Repo-wide. |

`--diff` and `--scope` together give the named paths within the diff. The
script's `scope` object counts candidate files against all test files in the
repo, so a narrowed scan is visible. The script does not follow callers or other
tests of changed code. For a changed source file, find the tests that cover it
with the evidence sources below and add them as candidates yourself.

- A change with no test file touched is a signal, not automatically a finding.
  Pure refactors with existing coverage can be fine.
- Find the project's test runner and conventions (paths, names, fixtures) so
  recommendations match how this repo tests. `references/languages.md` lists
  runners, file names, and assertion forms per language.
- Weight any focus area the caller names (a module, a failure mode), but still
  cover the rest.

## Evidence sources

Symbol facts come from the language server when one is available: what a name
resolves to, where a helper is defined, what a helper asserts, what calls a
function, and whether a symbol belongs to the repo.

1. Check whether a language server is configured or can start for the language
   (an editor integration, the host's code-intelligence tool, or the server
   binary: `gopls`, `rust-analyzer`, `pyright`, `jdtls`, `clangd`,
   `typescript-language-server`, `LanguageServer.jl`, and others). Prefer it.
   Use document symbols to list cases and helpers, definition and find-references
   to resolve a call and to find the tests of a behavior, and call hierarchy to
   follow a helper.
2. With no server, use `rg` or `git grep` for definitions and references, and
   read the code.
3. Record the source on every finding as `evidence_source`: `lsp`, `text`, or
   `read`. The script writes `text`. Raise it only when you confirmed the fact
   that way. If you could not start a server, say so in the summary.

## What to look for

Prioritize:

- **New behavior with no test.** A new branch, endpoint, flag, command, or
  public API path that nothing exercises.
- **Changed behavior with stale tests.** Tests that still pass while asserting
  the old contract, or that were updated only in fixtures or snapshots so they
  no longer pin the meaning of the change.
- **Happy path only.** Success tested; error, timeout, empty, auth failure,
  partial failure, and boundary inputs not tested where the code clearly has
  those paths.
- **Weak assertions.** Tests that call the code but check little (status 200
  only, "did not throw", snapshot of unrelated noise, a matcher that accepts a
  wide value). The test would pass if the bug shipped.
- **Missing negative and authorization cases.** Permission checks, tenant
  isolation, invalid input rejection that the code implements but does not test.
- **Integration and boundary gaps.** Unit tests mock away the seam the change
  actually risks (DB, network, clock, config); no smoke or contract test at that
  seam when the change is about it.
- **Removed or skipped tests.** Deleted, commented-out, or skipped without a
  replacement that covers the same risk.
- **Flaky or order-dependent tests** the change introduces: shared mutable
  fixtures, time dependence, reliance on test execution order.
- **Orphan test updates.** Large snapshot or golden-file rewrites that absorb a
  regression instead of asserting the intended delta.
- **Useless tests.** See the next section.

## Useless tests

Tests that add runtime, noise, or false confidence without locking a real
contract. In `diff` mode look first at tests the change adds or expands. In
`repo` mode look at the whole tree. Three checks find them; `references/checks.md`
states what each means, what the script sees, and what it cannot see.

- **A, no assertion.** A case whose body, and the helpers it calls, contain no
  assertion. It can fail only by throwing.
- **B, assertion for any input.** An assertion whose truth does not depend on
  the code under test: the same expression on both sides, two equal constants, a
  constant `true`, a matcher that accepts any value.
- **C, no repo code reached.** A case that asserts, but whose body and helpers
  reach no function, type, or value the repo owns. Dependencies, the standard
  library, and the case's own constants do not count. The script does not run
  this check; it needs symbol resolution (see the judgment pass).

Also flag, by reading:

- **Tests of the mock or test double.** The production path is fully stubbed, so
  the only thing under exercise is the harness. Or a mock is configured to
  return `v` and the case asserts it returned `v`.
- **Duplicate coverage.** Two or more tests that fail for the same reason and
  would all stay green under the same bug, including cases that differ only in
  their names. Keep the strongest, prune the rest.
- **Impossible or unreachable setups.** Scenarios the type system, guards, or
  constructors make unreachable in production.
- **Coverage theater.** A function called only to touch lines; no meaningful
  assertion on outcome, error, or state.
- **Change-detector noise without intent.** Brittle full-structure snapshots or
  string dumps that churn on every edit and document no deliberate contract.
  Prefer pruning or replacing with a narrow assert.
- **Obsolete tests.** Still pass after the behavior they guarded was removed or
  inverted.

For each useless test, the proposed change names the test to **delete** (or the
exact merge into a surviving test) and states what, if anything, still covers
that risk afterward. Prefer prune over "make it stricter" when no real behavior
is left to lock. Decide from the current contract and the actual coverage. When
the title names a property that is still a contract and nothing else covers it,
restore the assertion. When the contract is gone or another test covers it,
delete the case, and "none needed" is a valid statement of surviving coverage.
Deleting the last case in a file deletes the file; name any test file that
imports a helper from it.

### Refusals

The script refuses these, keeps them in the JSON with a reason, and counts them
in `counts.refused_by_reason`. Report the totals. A refused case is not a
finding.

- A snapshot-backed case. The stored file is the assertion, so the script never
  makes it a candidate, even when the case also holds a tautology. This keeps
  the lead list conservative. You can still report a snapshot that absorbs a
  regression, or an independent useless assertion in the same case, when you
  confirm it by reading.
- A skipped, disabled, or `todo` case. "Does not run" is a different argument
  from "runs and cannot fail". Skipped tests without a replacement are a
  separate coverage finding.
- A case that asserts through a helper declared in the same file.
- A case that holds nested cases. Each nested case is judged on its own.
- A case in a file passed with `--exempt`.

Refuse these yourself when you find them by reading: a case that pins a
dependency's behavior on purpose, a whole-tree check that reads the source and
compares it to a list, an aggregate guard over state other cases write, a
placeholder case a test runner requires, a deliberate does-not-throw check, and
the only test that locks a real failure mode (tighten or replace it).

## Do not flag

- Style of test code unrelated to what is proven.
- Demands for 100% line coverage on glue or generated code.
- Asking for tests on pure renames or move-only diffs with behavior unchanged
  and existing tests still exercising the path.
- Preferring one test framework over another without a coverage gap.
- Pruning a test that is the only lock on a real failure mode. Tighten or
  replace it instead.
- Deleting tests solely because they are slow, unless they also prove nothing.

## Method

1. Resolve the scope and the evidence source.
2. List the **behaviors** the scope adds or changes (not the files: the
   user-visible or contract-visible outcomes).
3. For each behavior, search for tests that exercise it (definitions and
   references from the language server, or `rg` for symbols, route paths, error
   messages, flag names). Read those tests and judge what they assert.
4. Map each behavior to covered well, covered weakly, or uncovered. File
   findings on weak and uncovered behaviors where the risk justifies it.
5. Run the scan for useless tests, then the judgment pass below.
6. Prefer one finding per missing behavior, or per useless test or duplicate
   cluster, over a laundry list of every untested line.
7. For a gap, name the test kind (unit, table-driven edge cases, integration at
   seam X) and the assertion that would catch the bug, not "add more tests". For
   a prune, name the test id and path and the surviving coverage (or
   explicitly "none needed").

## The scan script

`scripts/scan.mjs` is table-driven, has no dependency beyond Node 20 or later,
and reads text. A language needs one row in `scripts/languages.mjs`. Check
machine load before a scan of a large tree.

```bash
node <skill-dir>/scripts/scan.mjs --out "$(mktemp -d)/findings.json"
node <skill-dir>/scripts/scan.mjs --diff origin/main --working-tree --out "$(mktemp -d)/findings.json"
node <skill-dir>/scripts/scan.mjs --scope pkg/core --exempt pkg/core/tree_test.go
node <skill-dir>/scripts/scan.mjs --format wire --out "$(mktemp -d)/wire.json"
node <skill-dir>/scripts/scan.mjs --list-languages
```

| Option | Meaning |
| ------ | ------- |
| `--root <dir>` | Repository root. Default: git top level, else the cwd. |
| `--scope <path>` | Scan only this file or directory. Repeatable. With `--diff`, only candidates inside these paths. |
| `--diff <base>` | Report candidates only in test files the change touches or that sit next to a touched file. The whole repo is still counted. |
| `--working-tree` | With `--diff`, include the net change to the working tree and untracked files. |
| `--exempt <path>` | Refuse every case in this file. Repeatable. |
| `--languages <ids>` | Scan only these language ids. |
| `--table <file.json>` | Add or replace language rows. See `languages.mjs` for the fields. |
| `--format <json\|wire>` | `json` is the findings document. `wire` is the review-lens array; with `--out`, stdout gets the script's headline. |
| `--out <file>` | Write the output here and print a ranked summary. Without it, the output goes to stdout. |

Exit codes: 0 no findings reported, 1 findings reported, 2 the scan could not
run (no test file matched a language row, candidate files with no recognized
case, bad argument, a scope outside the root, an unreadable diff base, an
unexpected error). Refusals alone give 0. A `--diff` with no candidate test file
gives 0.

Built-in rows with a fixture in `scripts/scan.test.mjs`: TypeScript (a `.ts`
file with jest-style cases), Python (pytest and unittest), Go, Rust, Java
(JUnit), C++ (a googletest `.cc` file), and Julia. The same rows also match
JavaScript, C, and the other extensions in their `files` pattern, and that part
is guidance. Kotlin has a row and no fixture, so treat its output as guidance. A
row passed with `--table` is always reported as not fixture-tested. For any
other language, add a row, or skip the script and apply the method by reading.
The JSON `languages` object says how many files and cases each row matched and
whether a fixture covers it. A row that matches files and zero cases does not
fit the repo's test style.

The script finds cases with line patterns and ends them by braces, indentation,
a call's parentheses, or `end`, after it blanks comments and string contents. It
does not parse. The JSON lists `skipped_files`: files over 2 MiB, unreadable
paths, and cases whose block did not close. Check it before you trust a zero.

### What the script cannot see

Look here yourself. `references/checks.md` has the per-check detail.

- **A.** It matches assertion patterns. It cannot tell whether a called helper
  asserts, unless the helper is declared in the same file. Every call it cannot
  place makes the finding a `question`, and the finding lists those calls. A
  case that fails by throwing on purpose is reported.
- **B.** It reads the assertion forms in the language row. Other libraries, weak
  matchers on wide values, and mocks that assert on themselves are not
  reported. A repeated expression is a `medium` lead: equality can fail to be
  reflexive (NaN, an overloaded operator) and a getter can change between reads.
- **C.** The script does not run it.
- **Everything.** Duplicate cases, test files in a language with no row, tests
  under names the row does not match, and files in `skipped_files`.

## Judgment pass

Run it after the script, and for every language the script does not cover. A
script verdict alone never justifies a proposed deletion.

1. Read the code around every reported finding and every refusal group. Read the
   case, the code it calls, and the callers of any helper. Use the evidence
   sources above. Confirm or overturn each from that code.
2. Mark each script finding `confirmed`, `downgraded`, or `dropped`, with one
   line of reason and its `evidence_source`. Overturn a refusal only with a
   reason from the code.
3. Run check C yourself. For each case that asserts, resolve what its body
   reaches. A case that reaches only dependencies, the standard library, or its
   own constants is a `question` finding.
4. Survey the same defect class where the script cannot look: cases that assert
   only through helpers, weak matchers on wide values, mocks that assert on
   themselves, cases that differ only in their names, test files in other
   languages, and files in `skipped_files`. Inspect each candidate. A shape
   alone is not a defect. Report a reviewer finding only when you confirm the
   specific defect and its impact: what bug the test would let ship, or what
   duplicate it adds.
5. For each proposed deletion, state what behavior the test was meant to pin,
   and confirm that another test or the type system covers it. If neither does,
   propose a repaired assertion, not a deletion.

## Finding bar

**Gap findings** must state:

1. Which behavior or path is under-tested (reference the production location).
2. What existing tests do or fail to do about it.
3. What failure could ship unnoticed.
4. A concrete test (or assertion) that would catch it.

**Prune findings** must state:

1. Which test is useless (file, test name, line).
2. Why it proves nothing (check A, B, or C, tautology, duplicate, mock-only,
   obsolete).
3. What cost it imposes (noise, runtime, false confidence) if useful to say.
4. The prune action: delete it, or merge into which surviving test, and what
   still covers the risk afterward.
5. The judgment and the evidence source, and the behavior the test was meant to
   pin.

Every finding that is not dropped has a proposed change with three parts:
`change` (what to change, as text or a patch snippet), `where` (file, line, and
case), and `verify` (the check that shows the change is right, such as the
command that runs the changed test, and a mutation of the code under test that
the new assertion must catch). Script findings carry `change`, `where`, and a
generic `verify` as provisional text. Make them specific.

If coverage is adequate and no useless tests stand out, say so and return no
findings.

## Output

Mark each finding's origin: `script` (from `scan.mjs`) or `reviewer` (found by
reading). In the wire format the `source` field is the skill slug, so put the
origin in `body`.

### When a caller requested structured findings

```
{ source, path, line, severity, title, body, suggested_fix, evidence }
```

- `source`: `test-coverage-code-review`
- `path`: for gaps, prefer the **production** file whose behavior is
  under-tested; for weak asserts, bad skips, snapshot absorb, or **useless
  tests**, use the test file path
- `line`: new-file line of the behavior, weak assert, or useless test; `null`
  when the gap is the absence of a test file
- `severity`:
  - `blocker`: untested critical path, safety, or data integrity
  - `high`: core new behavior untested, tests would miss the bug, or a useless
    test is the only test that claims to cover a core behavior
  - `medium`: important edge or failure path missing, or a clearly useless test
    the change introduces (script `high` and `medium` leads map here)
  - `low`: nice-to-have edge, a low-cost duplicate or prune, a useless test the
    change leaves untouched, or a `question` lead
- `title`: short heading (`Prune ...` when recommending deletion)
- `body`: for gaps, the behavior, current posture, and what could slip through;
  for prunes, why the test is useless and what remains after removal; always the
  origin and, for prunes, the check (A, B, or C)
- `suggested_fix`: for gaps, specific test cases and assertions to add or
  tighten (name a likely test file when conventions make it obvious); for
  prunes, delete test X or merge into Y with surviving coverage noted; then
  `Verify: ...`
- `evidence`: `Verified: ...` when you confirmed it with the language server or
  by reading, else `Inferred: ...`. Name the source (`lsp`, `text`, `read`).

One-line headline: `needs-attention` or `approve`.

`scan.mjs --format wire --out <file>` writes this array for the script's own
unjudged leads and prints the script's headline. Do not return it as is. Build
the final array from the findings that survive the judgment pass: your
reviewer findings (gaps included), and the script leads you confirmed or
downgraded, with `evidence` and `suggested_fix` updated to what you checked.
Compute the headline from the final array.

Refusals are not findings, in fan-out or standalone. Keep them out of the
array unless the judgment pass overturns one with evidence from the code. Report
the refusal totals in the standalone summary only.

### When invoked standalone

Compact markdown: a verdict line, the mode and scope in one line, a short
summary of coverage posture (gaps and prunes), and findings ranked by severity
with locus, rationale, judgment, evidence source, and the recommended add,
tighten, or prune. Add the refusal totals, the languages, and the evidence
sources used. Write `findings.json` and `reviewed.json` only outside the
repository, and only when the user asks for the files. In `reviewed.json`, copy
the script findings with a `judgment`, a `reason`, and an `evidence_source`,
and add the reviewer findings with `source: "reviewer"`.

## Final check

Each finding must be about what is proven (or not), tied to this change's
behavior or its tests, accurate about existing coverage and its evidence source,
and paired with either a test shape that would catch a real miss or a concrete
prune that removes false confidence. Not a coverage-percentage scolding, and not
deleting the only real safety net.
