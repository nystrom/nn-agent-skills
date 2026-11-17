# Check catalog

One entry per check in `scripts/scan.mjs`, then the checks the scan does not
make and why. Every bound is a question put to the type checker, not a pattern
matched in text.

Each check states the rule it enforces. When a repository documents the rule
(a style guide, an ESLint config, a contributing file), cite that document in
the proposal. When it does not, the rule is the general one: the compiler,
not a reviewer, finds the place that needs a new case.

## `no-default`

A `switch` with no `default` whose unhandled case would widen the enclosing
function's inferred return type.

- Rule: a `switch` over a finite union handles every case or fails the build.
- Why: with an exhaustiveness check in the `default`, growing the union is one
  type error naming this file. Without it, the inferred return type gains
  `undefined` and errors appear wherever callers use the result, or nowhere if
  callers accept `undefined`. The diagnostic is misplaced rather than absent,
  so the severity is `medium`.
- Bound: five conditions. Four remove a way TypeScript already reports the new
  case. The last keeps the finding's claim true.
  - The switched-on type is a union of literal types (string, number, boolean,
    enum member, `null`, `undefined`, unique symbol). A `.kind` whose type
    widened to `string` is open and refused.
  - The switch is its function's last statement and every clause exits. A
    clause that `break`s, a last clause that is empty, or a statement after
    the switch, is a partial dispatch with a fallback behind it.
  - The function declares no return type. An annotation that excludes
    `undefined`, `void`, `any`, and `unknown` gives TS2366 on a new case. One
    that admits them makes the unhandled case part of the contract. For an
    `async` function the annotation is unwrapped first, because
    `Promise<void>` admits an absent value once awaited.
  - The function is not a callback whose contextual return type excludes an
    absent value, which gives a type error at the call. A contextual return
    type of `void`, `unknown`, or `any` accepts the widened result.
  - The function's inferred return type excludes an absent value. A
    constructor, or a function whose clauses all `return` with no value,
    infers `void`, and an unhandled case widens nothing.
- Also refused: `strictNullChecks` off in the project, and an exhaustiveness
  check after the switch.

## `empty-catch`

A `catch` block, or a `.catch(() => {})` handler on a receiver whose type has
a `then` member, with no statements.

- Rule: an empty `catch` states why the failure is ignored.
- Bound: statements, not text. A block holding only a comment has no
  statements, and is told apart by a comment between the braces. A comment is
  the statement of intent, so that site is refused.
- Not detected: `.catch(noop)` with a named function.

## Not checked

- **A `default` that neither calls a helper nor throws.** "Would a new case
  produce a diagnostic" has more answers than TS2366: a `default` that returns
  a failure value is a reported contingency, a `default` that dereferences a
  property only some variants have fails type checking for a new variant, and
  a variable assigned in every clause and read after the switch fails
  definite-assignment analysis. Enumerating these is the type checker's job. A
  scan that tries either reports correct code or grows a gate per mechanism.
- **Catch blocks that only `return`.** Many map a failure to a domain value
  (a file that does not exist, input that is not a token). Separating a
  swallowed error from a mapped failure needs a rule about which functions may
  do it. The scan stops at an empty body.
- **`if`/`else if` chains that do not end in a `throw`.** Telling a chain that
  is exhaustive by construction from one that assumes its last case needs each
  condition's narrowing.
- **Whether a switch covers its union.** The compiler checks that once the
  `default` holds an exhaustiveness check. That is why the fix is worth more
  than the report.
- **Truthiness and unnecessary conditions.** `@typescript-eslint/strict-boolean-expressions`
  and `@typescript-eslint/no-unnecessary-condition` check these. Enable them in
  the repository's ESLint config instead of scanning for them.
- **A nested `switch`.** Each `switch` node is read on its own. An inner clause
  never decides whether the outer switch has a `default`.

## Calibration

The scan does not carry expected counts. On a first run, read every reported
finding and a sample of the refused ones before trusting the totals.
