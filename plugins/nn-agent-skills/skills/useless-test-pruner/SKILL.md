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

Before you report a finding, open the file and read the case. The script is
static and one file deep.

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

Write `findings.json` (the script's output) and give a short ranked summary:
the counts line, then each reported finding as `severity [stage] file:line`,
the signal, and the proposal, then the refusal totals. Rank `high`, `medium`,
`question`.

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

Restore an assertion in preference to deleting a case whose title names a
property. The title shows someone meant to check it. Delete when a sibling
case already checks the property.

After an edit, run the affected package's tests. Deleting the last case in a
file deletes the file, and every test file that imports a helper from it then
fails to resolve.
