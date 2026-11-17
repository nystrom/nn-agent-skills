# Check catalog

One entry per check in `scripts/scan.mjs`: the rule it rests on, how it
decides, and what it cannot see. A check with no stated rule is a guess about
the codebase, and a guess that fires is a bug report against correct code.

Every check asks one question in a different syntactic place: does any
production module read this?

## How reads are counted

A field is read when production code contains `.name` or `?.name` (also when
the access is split across lines), a quoted `"name"`, `'name'`, or `` `name` ``,
or the name inside a destructuring pattern, one level of nested braces
included (`const { name } = x`, `({ name }: Options)`,
`({ a: { name } }: Opts)`). Comment-only lines do not count.

A `name:` search is wrong for liveness. A caller writing `{ immediate: true }`
and a declaration `immediate: boolean` both match it and neither reads
anything. A member access is the shape that reads.

Quoted keys and destructuring also match unrelated code that uses the same
word. That error direction is intended: a missed read becomes a wrong
deletion, and an extra read becomes a refusal.

Bounds of the search:

- It is textual. A field read through `Object.keys`, `...spread` into another
  type, a mapped type, a getter on a different object, or reflection is not
  found by name unless a quoted key or destructuring shows it. The type check
  after an edit is the second line of defense for compile-time reads.
- Destructuring nested more than one brace level deep is not found.
- It reads TypeScript only. A JavaScript file that reads the field is not seen.
- A TypeScript file the script cannot read (a symlink to a file outside the
  tree, a file over 2 MB, an unreadable file) is listed in `skippedFiles`, and
  the run refuses every proposal.

## `inert-doc`

A declaration whose own comment says it does nothing.

- Rule: when source comments are the repository's record of intent, a comment
  that says setting a field has no effect is the repository asserting the
  field is inert. The check confirms the assertion against the readers and
  does not trust it.
- Phrases: `is not implemented`, `has no effect`, `is accepted but`,
  `does nothing`, on a comment line (case-insensitive). The comment attaches to
  the first following line that is neither comment nor blank.
- Two shapes come out of the same signal. A comment on an interface field names
  the deletion target. A comment on a callable is refused: what it calls inert
  may be an options parameter, which is a fact about the parameter's type, and
  that type's own field entry reports the deletion.
- A field whose comment says it has no effect while production code reads it is
  a refusal, not a dropped candidate. The comment and the code disagree, and
  which is wrong is a judgment.
- The proposal names the test files that stop compiling once the field is
  gone: a `.name` access, a `name:` key, or a shorthand `{ name }` in a test
  file. This search is broader than the liveness search on purpose. It words
  the proposal and never decides whether to report.
- Bound: it reads comments. A field that is inert and undocumented is not
  found, and neither is one whose comment says so in other words.
- A field belongs to an interface when the brace depth from the interface line
  to the field line is exactly 1. A field of a nested object type, or a line
  after the interface closed, has no owner and is not reported.

## `unread-param`

A parameter the implementation marks unread, whose options type nothing reads.

- Rule: the lint config's `argsIgnorePattern` (default `^_`) is the
  repository's way of writing "this parameter is deliberately unread".
- Method: the parameter name must match that pattern and contain `option`,
  `options`, or `opts` (case-insensitive), and be annotated with a
  capitalized type name. The type must resolve to exactly one `interface`
  declaration. Its own fields are enumerated and each is searched for a
  production read. Fields that arrive through `extends` belong to the base and
  are not counted.
- One ignoring function is not evidence. A function that ignores an option
  that other functions read does not need it. The check reports only when no
  production code reads any field of the type.
- A line is a candidate parameter only when it is not inside an interface body
  and nothing before the match on the line is `const`, `let`, or `var`.
- Refused when: the type is not one readable interface (an index signature,
  a mapped type, two declarations), it has no fields (the `empty-options`
  entry owns that), a field is read, the type takes part in `extends`, the
  same type has a reported field (that deletion removes this parameter's only
  content), the parameter name appears in the same file other than in a
  `name: Type` annotation (the name is used as a value, possibly in a
  different function), the type is used anywhere other than as the type of an ignored
  parameter (import and export list entries excepted), or the consumer
  verdict is not `internal-only`.
- Bound: a parameter written as a destructuring pattern, or named without
  `option`, `options`, or `opts`, is not found. The script does not parse
  function bodies. It refuses when the name appears as a value anywhere in the
  file, and otherwise relies on the lint rule.

## `empty-options`

`interface X {}` that annotates something.

- Rule: an optional argument whose type declares no fields carries nothing.
- The type must appear after a `:` in at least one production file, so a
  marker interface that is never used as an annotation is skipped.
- `{}` accepts any non-nullish value. Removing an optional parameter does not
  change what callers may pass. Removing a required parameter or a field type
  does. The check therefore refuses when any production line uses the type
  other than as `name?: X` (import and export list entries excepted).
- Refused when: the interface is declared more than once, the file contains
  `declare module` or `declare global` (merge points and augmentations), the
  interface is the base of another, a use is not an optional parameter, or the
  consumer verdict is not `internal-only`.
- Bound: the declaration must open and close its braces on one line.
- Bound: a field with an optional type annotation such as `cb?: X` is
  indistinguishable from an optional parameter by this pattern. Read each use
  before editing.

## Consumer verdict

The verdict decides every proposal, because every proposal deletes something
that may be part of a public signature. It is computed per owning symbol:

1. Another package in the repository (a different nearest `package.json`) names
   the symbol: `exported-with-hits`.
2. The package is `"private": true`, or the user passed
   `--assume-unpublished`: `internal-only`.
3. `--offline`: `unknown`.
4. `gh search code "<symbol> <package name>"` over at most 10 symbols per run.
   Hits in other repositories: `exported-with-hits`. No hits:
   `exported-no-hits`. Any failure, a missing `gh`, no login, or an unnamed
   package: `unknown`.

The verdict covers a symbol's name only. A caller in another package, or in a
JavaScript file, can pass the field in an object literal to an exported
function without naming the type. The scan does not search for those callers.
Every reported finding says so in `evidence`, and the repository's type check
after the edit is the gate for compile-time callers.

The scan does not check whether a published package re-exports the symbol from
its entry point. It treats every symbol of a published package as possibly
public. This refuses more than necessary, and no check clears a symbol the
scan could not prove internal.

## The design argument

Every proposal is held against the written argument for its shape before it
ships: the file's leading comment block, then `DESIGN.md`, `ARCHITECTURE.md`,
and `README.md` from the file's directory up to its package root. A
whole-word mention of the target or its interface is quoted into `evidence`.
It does not refuse the finding.

The word boundary is what makes the quote worth reading. A substring match on
`transaction` pulls in unrelated sentences.

## Not checks

- **An abstraction with one implementation and one caller.** TypeScript is
  structurally typed, so an `implements` clause does not enumerate the
  implementations: an object literal satisfies an interface without one. A
  caller count cannot recover the implementation count either, because the
  missing implementations are the thing being counted.
- **A wrapper that only forwards.** A seam is a thin wrapper that lets one
  implementation be replaced without touching a consumer. A forwarding wrapper
  with a written argument for it is correct code, and a check would have to
  refuse it.
- **A field that never varies.** A caller that always passes the same value
  does not make the option inert: a test or another caller may pass the other
  value, and the default is behavior.
- **Dead exports.** A type that nothing names at all is dead code. See the
  `dead-code-code-review` skill.
