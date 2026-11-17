---
name: useless-test-pruner
description: >-
  Scan a whole repository's test files for test cases that run and cannot fail,
  and propose pruning or repairing them. Finds a case with no assertion, an
  assertion whose subject and expected value are the same expression or whose
  matcher holds for any subject, and a case that asserts without reaching any
  code the repo owns. Refuses snapshot-backed cases in every stage, and refuses
  cases that assert through a helper or may pin a dependency on purpose in the
  stages where those shapes matter. Reports how many candidates each refusal
  removed. Reports findings as a JSON file and a short ranked summary; edits
  only when asked. Use when asked
  to find useless, vacuous, tautological, or always-passing tests across a
  codebase, to prune a test suite, or to audit test quality tree-wide. For a
  diff, use test-coverage-code-review.
---

# Useless Test Pruner

A test that cannot fail costs what every test costs and reports nothing. This
skill finds them across a tree with `scripts/scan.mjs`, then gives each one a
proposal and the evidence behind it.

`test-coverage-code-review` judges the tests in a diff, with a section on
useless tests. This skill scans every test file in a tree and uses a parser
instead of reading.

`references/checks.md` holds the catalog: for each stage, what it sees, what it
cannot see, and why each refusal exists.

## Run it

Run from the target repository. The script needs the `typescript` package
installed in that repository (it parses `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`,
and `.cjs` test files). It exits 2 with a message when `typescript` is absent.
It does not install anything.

```bash
node <skill-dir>/scripts/scan.mjs --out findings.json
node <skill-dir>/scripts/scan.mjs --scope packages/core --exempt packages/core/tree.test.ts
```

| Option | Meaning |
| ------ | ------- |
| `--root <dir>` | Repository root. Default: git top level, else the cwd. |
| `--scope <path>` | Scan only this file or directory. Repeatable. |
| `--exempt <path>` | Refuse every case in this file. Repeatable. |
| `--out <file>` | Write the JSON here and print a ranked summary. Without it, the JSON goes to stdout. |

Exit codes: 0 no findings reported, 1 findings reported, 2 the scan could not
run (no test files, no file could be scanned, bad argument, a scope outside the
root, no `typescript`, an unexpected error). Refusals alone give 0.

The JSON lists `skipped_files`: files over 2 MiB, files with syntax errors,
and unreadable files or directories. Check it before you trust a zero. A
`--scope` is checked by real path, so a link that leads outside the root exits
2.

Check machine load before a scan of a large tree. The script reads and parses
every test file in one process.

## Discover the repo first

The script finds test files by name (`*.test.*`, `*.spec.*`, `__tests__/`),
skips dot directories, `node_modules`, build output, and symlinks, and skips
files over 2 MiB. Before you trust a zero, check these against the repo:

- The test runner config (`jest.config.*`, `vitest.config.*`, `package.json`
  `jest` key, `.mocharc.*`). If tests live under other names, pass them with
  `--scope`.
- How the repo names its own code. The script reads workspace package names
  (`workspaces` in `package.json`, `pnpm-workspace.yaml`) and `paths` aliases
  in the root `tsconfig.json`. A package alias set up elsewhere (a bundler
  alias, a per-package tsconfig) is read as a dependency, which adds a
  refusal. The JSON lists `own_packages` and `own_aliases`; check them.
- Whole-tree tests: a file that reads the source tree and compares it to a
  list. The script refuses a case that reaches `fs` or `child_process`. For
  other shapes, read the candidate file and pass it with `--exempt`.
- Assertion helpers the repo defines with names the script does not
  recognize. A helper named `assert*`, `expect*`, `invariant`, or `fail`, or
  declared in the same file, is followed. A helper imported under another
  name is refused as an unfollowed import. Read it; if it asserts, it is not
  a finding.

## Stages

Cheapest first. Each is static.

| Stage | Fires on |
| ----- | -------- |
| A | An `it` or `test` whose body has no `expect()`. |
| B | An assertion that holds for every input: subject and expected value are the same expression, both sides are literals, an existence matcher on a literal, or `expect.anything()`. |
| C | A case that asserts, but whose reference closure names no symbol imported from a relative path, a workspace package, a configured alias, or a dynamic `import()` or `require()` of those. |

Cases are attributed to their enclosing `it` with the TypeScript parser. A line
search cannot say which `expect` belongs to which case.

## Evidence

A finding ships when its stage fired and no refusal applied. The severity says
how much the shape proves:

- **Stage B is a syntax proof.** The assertion's truth does not depend on the
  code under test. `high`. `medium` when the repeated expression is a call, a
  `new`, an `await`, or an update or assignment, because it then checks that
  the expression is stable. `medium` also for `expect.anything()` and
  `expect.any()`, which still check that a value of that kind exists. A getter
  on a repeated reference is the one case the scan cannot see.
- **Stage A fails closed.** A helper the scan cannot see as asserting adds a
  refusal, so a reported case is one where the scan followed every call it
  could. `medium`. A case such as `() => schema.parse(input)` fails by
  throwing on purpose, and the scan reports it. Read the case for that shape.
- **Stage C fails open.** An import the scan fails to attribute to this repo
  makes a working test look untethered. Every stage C finding is `question`
  and proposes confirming before deleting.

The script collects no mutation evidence. Its syntax checks support the claim
that a case cannot fail. They do not prove it. State no kill rate you did not
measure.

The script is static and reads one file at a time. Its verdict is a lead. The
judgment pass below decides.

## What the script cannot see

Look here yourself:

- **Stage A.** A case that asserts through a helper reached by a global or by a
  name the script does not resolve is reported. A case that fails by throwing on
  purpose (`() => schema.parse(input)`) is reported when `schema` is not an
  import. A case whose body is a
  function reference (`it("x", runCase)`) is skipped. A case that calls an
  imported symbol is refused without a look at that symbol.
- **Stage B.** Only `expect(...)` chains are read, so `assert.equal(x, x)` and
  other libraries are not. A getter on a repeated reference is reported as a
  proof. An assertion that is weak but not a tautology (`toBeDefined` on a wide
  value, `toBeTruthy` on an object) is not reported.
- **Stage C.** Code reached through a global, a per-package alias, or a bundler
  alias looks untethered or looks like a dependency. A case that asserts through
  a helper imported from the repo is not followed: it counts as reaching the
  repo, so it gets no finding. A case that asserts through a dependency's
  helper is refused.
- **Everything.** Duplicate cases, mocks that assert on themselves, test files
  in other languages, files in `skipped_files`, and tests under names the
  script does not match.

## Judgment pass

Run it after the script. A script verdict alone never justifies an edit or a
deletion.

1. Read the code around every reported finding and every refusal group. Read
   the case, the code it calls, and the callers of any helper. Confirm or
   overturn each from that code.
2. Mark each reported finding `confirmed`, `downgraded`, or `dropped`, with one
   line of reason. Overturn a refusal only with a reason from the code.
3. For each proposed deletion, state what behavior the test was meant to pin,
   and confirm that another test or the type system covers it. If neither does,
   propose a repaired assertion, not a deletion.
4. Survey the same defect class where the script cannot look: tests that assert
   only through helpers, assertions that pass for any output (weak matchers on
   wide values, mocks that assert on themselves, cases that differ only in
   their names), test files in other languages, and files in `skipped_files`.
   Inspect each candidate. A shape alone is not a defect. Report a reviewer
   finding only when you confirm the case cannot fail.

## Refusals

A refused candidate is not a finding. The JSON keeps it with its reason, and
`counts.refused_by_reason` totals them. Report the totals.

- A case with a snapshot matcher. The `.snap` file is the assertion. Never a
  candidate, in any stage, even when the case also holds a tautology.
- A case that asserts through a helper: `assert*`, `expect*`, `invariant`,
  `fail`, an `assert` library call, a chai `should` chain, a supertest
  `.expect()`, a call on the case's own parameter (`t.ok`, `done`), or a helper
  this file declares whose body asserts.
- A case that calls an imported symbol, in stage A. The scan reads one file and
  declines to guess at an imported body.
- A case that reaches `fs` or `child_process` (stage C): it may assert over
  the source tree.
- A case whose assertion reaches a dependency (stage C): it may pin that
  dependency's behavior on purpose.
- A case that reads a file-scope `let` other cases assign (stage C): an
  aggregate guard over them.
- A placeholder case in a module that other test files import (stage C): some
  runners fail a test file that declares no case.
- A case skipped, `todo`, `xit`, or inside a skipped suite. "Does not run" is
  a different argument from "runs and cannot fail".
- A case in a file passed with `--exempt`.

## Output

`findings.json` is the script's output. Each finding has `source: "script"`.
Keep it as written. Put the judgments and the reviewer findings in a separate
file, `reviewed.json`, as a copy of the findings with a `judgment` and a
`reason` on each script finding, plus the reviewer findings. Give a short
ranked summary:
the counts line, then each finding as `severity [source] file:line`, the signal
or defect, the judgment (`confirmed`, `downgraded`, `dropped`) with its reason,
and the proposal, then the refusal totals. Label reviewer findings from the
survey `source: reviewer` and list them with the script's findings. Rank
`high`, `medium`, `question`.

## Proposing edits

The skill reports and proposes. It edits only when the user asks. When asked,
make one change per finding:

- Stage B, repeated reference: assert the subject against the value the case
  is about, which is a different expression than the one on the left.
- Stage B, repeated call: compare two independently constructed values, or
  assert the form the case title claims.
- Stage B, existence matcher or `expect.anything()`: assert the value.
- Stage A: restore the assertion the title names, or delete the case.
- Stage C: confirm the case covers nothing the repo owns, then delete it.
- Reviewer finding: the same rules apply. State the pinned behavior and its
  other coverage before a deletion.

Restore an assertion in preference to deleting a case whose title names a
property. The title shows someone meant to check it. Delete when a sibling
case already checks the property.

After an edit, run the affected package's tests. Deleting the last case in a
file deletes the file, and every test file that imports a helper from it then
fails to resolve.
