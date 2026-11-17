# Check catalog

One entry per stage in `scripts/scan.mjs`: the signal, why it is allowed to
fire, and the bound on what it sees. A stage with no stated reason is a guess
about the codebase, and a guess that fires proposes deleting a working test.

The stages fail in opposite directions, which sets their severities:

- **Stage A fails closed.** A helper the scan does not recognize as asserting
  adds a refusal. A miss hides a finding.
- **Stage B reports a syntax shape.** The shape shows the assertion does not
  read the code under test. A getter on a repeated reference is not visible.
- **Stage C fails open.** An import the scan does not attribute to this repo
  makes a working test look untethered. A miss proposes deleting a working
  test, so every stage C finding is `question` and proposes "confirm, then
  delete".

Each stage reports a syntax shape and does not prove the case is useless. The
judgment pass in `SKILL.md` confirms, downgrades, or drops every finding from
the code, and `SKILL.md` lists what the script cannot see.

The script has no baseline counts. A run on a repo you know that returns far
more or far fewer candidates than the suite's size suggests means a stage or
the repo discovery is wrong. Read a sample of each stage's output before
reporting.

## Stage A: a case that runs and asserts nothing

- Signal: an `it`, `test`, or `specify` whose body has no `expect()` call.
- Why it fires: a case with no assertion fails only by throwing, so it holds
  for every value the code under test produces.
- Bound: one file. A helper declared in the file, at any scope, is followed. A
  helper imported from another module is not, and a case that calls one (from
  the repo or from a dependency) is refused.
- Bound: a call on a parameter of the case (`t.ok`, `done`), a chai `should`
  chain, and a `.expect()` method call (supertest) count as assertions.
- Bound: an assertion library that is not named `assert*` or `expect*` (a
  custom `check(...)` imported from a helper file) is refused as an unfollowed
  import. One declared in the same file is followed.
- Not covered: a case whose body is a function reference (`it("x", runCase)`).
  It has no inline body, so the scan skips it.

## Stage B: an assertion that holds for every input

- Signal: `expect(subject).matcher(expected)` in one of four shapes:
  - the subject and expected value are the same expression, with `toBe`,
    `toEqual`, or `toStrictEqual`;
  - both sides are literals with the same value (`Object.is`);
  - an existence matcher (`toBeDefined`, `toBeTruthy`, `toBeFalsy`, `toBeNull`,
    `toBeUndefined`) that passes for the literal it is applied to;
  - the expected value is `expect.anything()` or `expect.any()`, with an
    equality matcher.
- Why it fires: the assertion's truth does not depend on the code under test,
  so no change to the repo can fail it.
- Bound: `.not` is skipped, and so is a literal assertion that always fails.
  That is a different bug with a different fix.
- Bound: a repeated expression that is a call, `new`, `await`, update, or
  assignment is `medium`. It checks that the expression is stable, which is a
  weak real property. The proposal is to compare two independently constructed
  values. `expect.anything()` and `expect.any()` are also `medium`: they check
  that a value of that kind exists.
- Bound: identical literals reach the same-expression shape first, so the
  both-literals shape fires on literals that differ in text and agree in value
  (`toBe(1)` against `1.0`).
- Bound: only `expect(...)` chains are read. `assert.equal(x, x)` is not.
- Bound: a case with a snapshot matcher gets no stage B finding.

## Stage C: a case that asserts without reaching this repo

- Signal: a case that asserts (an `expect()`, an assertion helper, or a helper
  declared in the file that asserts) and whose reference closure names no
  symbol imported from this repo.
- Why it fires: no change to the repo can make such a case fail, so it does not
  cover the repo.
- Own code means: a relative or absolute path, a `#` subpath import, a
  workspace package name, a prefix from a root `tsconfig.json` `paths` key, or a
  name bound from `import()` or `require()` of those. Type-only imports do not
  count.
- Bound: one file, and identifiers rather than types. The closure follows calls
  into helpers the file declares at any scope. Collecting only top-level
  declarations makes a helper declared inside a `describe`, or a name bound by
  `const { f } = await import("./f.js")`, look like a name from nowhere.
- Bound: names a global provides (a test that reaches the code through a
  global, not an import) look untethered.
- Bound: only the root `tsconfig.json` and the root workspace config are read.
  A per-package alias or a bundler alias is read as a dependency, which adds a
  refusal in stage C.

## Refusals

| Refusal | Stage | Reason |
| ------- | ----- | ------ |
| asserts through an assertion helper, runner API, or assert library | A | `assert*`, `expect*`, `invariant`, `fail`, `assert.*`, a call on the case parameter, `should`, and `.expect()` throw instead of calling `expect()`. |
| asserts through a helper the file declares | A | The helper body contains an assertion, so the case asserts. |
| calls an imported symbol the scan does not follow | A | The scan reads one file. An imported helper may assert, and a dependency call such as a `findBy*` query throws. |
| exempt by the caller | A, B, C | Passed with `--exempt`. |
| folded into a stage B finding | C | A case both stages fire on is reported once, by the stage that names the assertion. |
| a file-scope accumulator | C | A file-scope `let` that other cases assign. A case that asserts on it is an aggregate guard against the whole file going vacuous. |
| reaches `fs` or `child_process` | C | A whole-tree test reads the source and compares it to a list. It imports no repo symbol by design. |
| reaches a dependency | C | The case may pin the dependency's behavior on purpose. Nothing else in the suite would notice a change. |
| placeholder in an imported test module | C | Some runners fail a test file that declares no case. The importing path is resolved against the importing file, so two same-named helpers stay distinct. |

Skipped, `todo`, and `xit` cases, and cases inside `describe.skip` or
`xdescribe`, are not candidates in any stage. "Does not run" is a different
argument from "runs and cannot fail", and answering the second with the first
makes the proposal unarguable.

A case with a snapshot matcher is not a candidate in any stage. A snapshot
assertion looks inert at the assertion site, and the `.snap` file holds the
expectation.

## Mutation evidence

The script collects none. The syntax checks support these readings, and a
reader confirms them:

- Stage B: no mutant of the code under test changes an assertion whose two sides
  are the same expression.
- Stage C: the case reaches no repo code, so no mutant is inside its covered
  range.
- Stage A: the assertion set is empty, which is what "kills nothing" means.

A stage A case that asserts inside a helper the scan cannot read is the case
that would need a coverage-guided mutation run. The scan refuses the imported
ones. A helper reached through a global or a name the scan does not resolve is
not refused, so read each reported stage A case.

## Not checked

- `expectTypeOf` and `@ts-expect-error` cases. A type-level assertion fails in
  the type checker, not at runtime. The scan treats `expectTypeOf(...)` as an
  assertion helper by name and does not look for `@ts-expect-error` comments.
- Duplicate cases, cases that test only a mock, weak matchers on wide values,
  and test files in other languages. Those need the survey in `SKILL.md`, not a
  syntax scan.
- A file with syntax errors. The scan skips it and lists it in `skipped_files`.
