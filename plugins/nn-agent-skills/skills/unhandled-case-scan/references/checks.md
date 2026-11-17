# Check catalog

One entry per check in `scripts/candidates.mjs`, then what the script proves,
what it does not check, and the bounds a user needs. The script matches
patterns. The model verifies each candidate with the language server,
compiler diagnostics, or by reading.

## `dispatch-no-default`

A `switch` or `match` with no catch-all arm, in a language where the compiler
does not require the dispatch to be exhaustive.

- Rule: a dispatch over a finite set handles every case or fails the build
  when a case is added.
- Why: with an exhaustiveness marker in the catch-all arm, growing the set is
  one build error naming this dispatch. Without it, a new case falls through.
  In a language with inferred return types, the result can also widen to admit
  an absent value, and errors appear at callers instead of here.
- Questions the model answers for each candidate:
  - Is the switched-on value a finite set (enum, sum type, union of
    literals, sealed hierarchy), or an open domain such as a string read from
    input? An open domain is refused.
  - Does the dispatch end the function, and does every arm exit? A break, a
    statement after the dispatch, or a last empty arm makes it a partial
    dispatch.
  - Does the compiler already report a missing case, through a declared return
    type, a use of a variable assigned in every arm, or a warning such as
    `-Wswitch`? Test with a scratch edit.
  - Is a closing marker present after the dispatch?
- Script bound: the catch-all arm is found by pattern inside the dispatch
  body. Braces are matched without reading strings or comments, so a brace in
  a string literal can end the body early. A catch-all in a nested dispatch
  hides a missing one in the outer.

## `dispatch-wildcard`

A `match`, `when`, or `switch` with a catch-all arm, in a language where the
compiler checks exhaustiveness.

- Why: the catch-all makes the compiler accept a new case silently.
- Questions: is the dispatch over a closed set that is expected to grow? Is the
  catch-all documented as the design (a large set with a few cases of
  interest)? A documented partial dispatch is dropped.
- Script bound: any catch-all arm is a candidate. Most are deliberate, so
  expect many candidates to be dropped.

## `empty-handler`

A handler with no statements, or one that discards a failure.

- Rule: a failure handler acts on the failure or states why it does not.
- Script bound: patterns for the empty forms and for the common discard
  forms. A handler that holds only a comment is refused, because the comment
  states the intent. A discard form such as a dropped result or a default
  value is `low`: many map a failure to a domain value on purpose. Read the
  caller before you report one.

## What the script proves

Nothing about the language's semantics. A candidate says the text has the
shape of the defect. Whether it is a defect depends on the type of the
switched-on value, what the compiler reports, the declared return type, and
the callers. The model establishes those facts with `lsp`, a scratch compile,
or reading, and records the evidence source in the report.

## Not checked

- **A catch-all arm that returns a failure value.** That is a reported
  contingency, not a gap.
- **Handlers that only return.** Many map a failure to a domain value (a file
  that does not exist, input that is not a token). Separating a swallowed
  failure from a mapped one needs a rule about which functions may do it.
- **`if`/`else if` chains.** Telling a chain that is exhaustive by construction
  from one that assumes its last case needs each condition's narrowing. The
  model reads these.
- **Whether a dispatch covers its set.** The compiler checks that once the
  marker is in place. That is why the change is worth more than the report.
- **Truthiness and unnecessary conditions.** Linters check these. Enable the
  rules instead of scanning for them.
- **Scope containment.** `--scope` is checked as a path, not by real path.
