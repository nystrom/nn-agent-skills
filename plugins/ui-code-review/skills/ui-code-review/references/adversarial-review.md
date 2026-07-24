# Findings, comments, and solo fallback

The multi-agent fan-out (`multi-agent-review.md`) is the primary review path: it
discovers and loads the installed review skills, which carry their own
methodologies and severity conventions. **This** file is the orchestrator-side
guidance those lenses don't own — how to turn their output into good findings and
comments — plus a solo checklist for the rare case where no review skill can be
loaded at all.

The review is a genuine critique, not a description of the diff. Read the
change adversarially on two fronts: **is it correct** (assume it's subtly wrong
and try to find how) and **does it improve the codebase long-term** (or does it
add weight — slop, duplication, a missing abstraction, dead code). A change that
is correct but drags quality down is still worth a finding.

## Severity vocabulary

Keep each skill's own severity vocabulary when mapping findings into `comments[]`
— the renderer accepts any label and just styles the known ones (`blocker`,
`high`, `medium`, `low`, `nit`, `question`, `praise`); unknown labels render
neutrally.

## Solo checklist (only when no review skill can be loaded)

If neither a subagent nor the `Skill` tool is available, interrogate each change
against these lenses by hand. Only file a comment when there's a real concern —
noise in the review is as bad as noise in the diff.

- **Correctness**: off-by-one, wrong operator, inverted condition, missing
  case, wrong default, mutation of a shared/loop variable.
- **Edge cases**: empty/null/zero, very large input, unicode, timezones,
  negative numbers, duplicate keys, concurrent access.
- **Error handling**: swallowed exceptions, unhandled failure paths, errors
  that leave state half-updated, missing cleanup, misleading error messages.
- **Contracts & callers**: signature/behavior changes not reflected at every
  call site; broken backward compatibility; changed return type or nullability.
- **Resource & lifecycle**: unclosed files/connections/locks, leaks, unbounded
  loops or growth, missing timeouts, retries without backoff or ceiling.
- **Concurrency**: races on shared state, non-atomic read-modify-write, locks
  held across await/IO, ordering assumptions.
- **Security**: unvalidated input, injection (SQL/command/HTML), authz gaps,
  secrets in logs/URLs, unsafe deserialization, sensitive data exposure.
- **Tests**: is the new behavior covered? Do snapshot updates hide a real
  regression? Are failure paths tested, not just the happy path?
- **Clarity / maintainability** (usually `nit`/`low`): confusing names, magic
  numbers, misleading comments, functions doing more than one thing.
- **Long-run quality** — the reason the change exists is to leave the codebase
  better, so weigh these as first-class findings, not afterthoughts:
  - **AI slop**: boilerplate that restates the obvious, redundant comments,
    defensive checks for conditions that can't occur, needless indirection,
    verbose code that a language idiom would express in a line.
  - **Refactor / abstraction opportunities**: duplicated logic that wants a
    shared function; a growing conditional that wants polymorphism or a table;
    a parameter list or return shape that signals a missing type. Name the
    concrete refactor, not just "this could be cleaner".
  - **Dead code**: newly unreachable branches, now-unused helpers/imports left
    behind by the change, feature flags never read, commented-out code.
  - **Duplication**: the change copies a pattern that already exists elsewhere —
    point to both sites.

Also call out what's **good** with a `praise` comment where warranted — it
tells the author what to keep doing and signals you actually read it.

## Fix mode: from finding to fix

In fix mode each finding should carry a concrete fix, not just a critique — that
fix is what you'll preview and apply. Prefer the smallest change that resolves
the finding. For a refactor or abstraction, state the target shape before
editing so the reviewer can veto the direction. See `apply-fix.md` for applying
and verifying.

## Writing good comments

- Be specific and actionable: name the line, the risk, and a suggested fix.
- Anchor to a `line` (new-file number) whenever the comment is about specific
  code, so the reviewer can jump to it.
- Calibrate severity honestly. `blocker` = must fix before merge; `nit` =
  optional polish. Inflating severities trains reviewers to ignore you.
- Prefer a `question` over an accusation when you're unsure whether it's a bug.
