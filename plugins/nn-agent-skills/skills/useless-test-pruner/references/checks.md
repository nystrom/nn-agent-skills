# Check catalog

What each check means, what `scripts/scan.mjs` sees, and what it cannot see.
Each check reports a shape, and a shape does not prove that a case is useless.
The judgment pass in `SKILL.md` confirms, downgrades, or drops every finding.

The checks fail in different directions, which sets their severities:

- **A fails closed.** A call the scan cannot place may be an assertion helper.
  The finding is a `question` and lists the calls. A miss hides a finding.
- **B reports a syntax shape.** The shape shows that the assertion does not
  read the code under test. A getter on a repeated reference is not visible.
- **C fails open.** A symbol the reader fails to attribute to the repo makes a
  working test look untethered. Every C finding is a `question` that proposes
  confirming before deleting.

The script has no baseline counts. A run on a repo you know that returns far
more or far fewer candidates than the suite size suggests means a language row
or a pattern is wrong. Read a sample of each check's output before reporting.

## Check A: a case that runs and asserts nothing

- Signal: a case whose body has no assertion pattern. The patterns are the
  language row's `assert` list plus an assertion-like call name
  (`assert*`, `expect*`, `verify*`, `ensure*`, `invariant*`, `require*`,
  `must*`, `check*`, `fail*`, with or without a `.name` or `::name` suffix).
- Why it fires: a case with no assertion fails only by throwing, so it holds
  for every value the code under test produces.
- Script: the case name is blanked first, so `fn check_it` is not an
  assertion. A helper declared in the same file, at any depth, is followed three
  calls deep. A case that calls an asserting helper is refused. Severity is
  `medium` when every call in the body is a declared helper or there is no
  call, and `question` when the body calls something the scan cannot place.
- Script cannot see: a helper in another file, a helper in a dependency, an
  assertion by a name the patterns do not list, a custom matcher, and a
  fixture or hook that asserts after the body. The reviewer resolves each
  listed call with the language server or by reading.
- Script cannot see: a case that fails by throwing on purpose
  (`schema.parse(input)`, `.unwrap()`, a thrown exception from the code under
  test). It reports the case. The reviewer decides whether the case is a
  deliberate does-not-throw check.
- Bound: comments and string contents are blanked before matching, so code in
  them is not read. Nested block comments are handled for Rust and Julia, and
  `${...}` inside a JavaScript template literal stays visible. Regex literals,
  raw strings, and heredocs are not handled.
- Bound: a case ends at its matching brace, indentation level, call
  parenthesis, or `end`. A `{` inside the parameter list is not the body.
  A block that does not close is listed in `skipped_files`.
- Bound: a curried table form such as `it.each(rows)("name", fn)` is one case,
  and the call that builds the table is not a case.
- Not covered: a case whose body is a function reference
  (`it("x", runCase)`), a case defined by a macro or a loop the head pattern
  does not match, and a table-driven case that generates names at run time.

## Check B: an assertion that holds for every input

- Signal, in the forms the language row lists:
  - both sides are the same expression after whitespace is normalized;
  - both sides are literals with equal values (`1` and `1.0`);
  - a constant true assertion (`assert True`, `assertTrue(true)`);
  - for the JavaScript row, `expect(x).toBe(x)` and the other equality chains,
    skipped under `.not`.
- Why it fires: the assertion's truth does not depend on the code under test.
- Severity: a repeated expression is `medium`. Equality can fail to be
  reflexive (NaN, an overloaded operator), and a getter can change between
  reads. When the expression has a call, `new`, `await`, or an update, the
  assertion checks that it is stable, and the proposal is to compare two
  independently constructed values. Two equal literals and a constant true
  assertion are `high`. Integer literals compare exactly; other decimals
  compare as written.
- Bound: JUnit and Kotlin `assertEquals` with three arguments and a string
  first is read as message first, so the pair shifts by one.
- Script cannot see: weak matchers on wide values (`toBeDefined` on an object,
  `assert x is not None`, `EXPECT_TRUE(ptr)` for a pointer that cannot be
  null), a matcher that accepts any value (`expect.anything()`, `ANY`), a mock
  that asserts on its own setup, a getter that changes between reads, an
  assertion library with no row entry, and an assertion in a string or comment
  (the scan ignores those on purpose).
- Script cannot see: which argument order a custom assertion uses. Check the
  row's `pair` against the repo's assertion library.

## Check C: a case that asserts without reaching repo code

The script does not run this check. It needs the meaning of names. The reviewer
runs it for every case that asserts.

- Signal: the body and the helpers it calls reach no function, type, or value
  that the repo owns.
- Resolve with a language server: definition and find-references for each call,
  call hierarchy through helpers, document symbols to find the case's helpers.
  The result is `lsp`. Without a server, use `rg` or `git grep` to find where
  each name is defined and read the imports (`text` or `read`).
- Own code means: a module in the repo, a workspace member or package the repo
  defines, a name an alias maps into the repo. A dependency, the standard
  library, a test framework, and the case's own constants are not own code.
- Not a finding: a case that pins a dependency's behavior on purpose (nothing
  else in the suite would notice a change); a whole-tree check that reads the
  source with file APIs and compares it to a list; an aggregate guard over
  state other cases write; a placeholder case a runner requires in a module
  other test files import. Each one resembles check C and is deliberate.
- Names that a global, a build alias, or generated code provides look
  untethered. Confirm before proposing a deletion.

## Refusals

| Refusal | Check | Reason |
| ------- | ----- | ------ |
| snapshot-backed | all | The stored file is the assertion. The row's `snapshot` pattern marks the case. |
| skipped, disabled, todo | all | The case does not run. A skipped suite block marks its cases too (JavaScript row). |
| asserts through a helper in the same file | A | The helper body has an assertion pattern, so the case asserts. |
| holds nested cases | A | A group's own body is not where the assertions live. Each nested case is judged alone. |
| exempt | all | The caller passed the file with `--exempt`. |

A snapshot-backed case gets no B finding, even when it also holds a tautology.

## Mutation evidence

The script collects none. The checks support these readings, and the reviewer
confirms them:

- B: no mutant of the code under test changes an assertion whose two sides are
  the same expression.
- C: the case reaches no repo code, so no mutant is inside its covered range.
- A: the assertion set is empty, which is what "kills nothing" means.

A proposed change names a mutation of the code under test that the repaired
assertion must catch. State no kill rate you did not measure.

## Not checked

- `expectTypeOf`-style and compile-time assertions, which fail in the type
  checker and not at run time. The scan treats `expectTypeOf(...)` as an
  assertion by name.
- Duplicate cases, cases that test only a mock, and weak matchers. These need
  the survey in `SKILL.md`.
- Languages with no row. Use the method in `SKILL.md` and
  `references/languages.md` by reading.
