---
name: test-coverage-code-review
description: >-
  Test-coverage code review of a change set. Finds missing, weak, or misleading
  tests for new and changed behavior: untested happy paths, untested failure and
  edge paths, assertions that do not lock the behavior, brittle snapshots that
  hide regressions, tests deleted or skipped without replacement, and coverage
  gaps at integration boundaries. Also finds useless tests — tautologies,
  duplicates, tests of mocks/frameworks, dead coverage theater — and proposes
  pruning them. Use when asked whether a PR is tested enough, for a
  test-coverage review, or as a review lens under run-review-lenses.
---

# Test Coverage Code Review

Review the change set for **whether the behavior it introduces or alters is
actually locked down by tests**, and whether the tests it adds or keeps are
worth their cost. Coverage here means behavioral coverage — the right paths and
failure modes — not a line-percent number from a tool (use that as a hint when
present, never as the verdict). A suite that is green but proves nothing is a
coverage failure too; propose pruning those tests.

This is a **review lens**. It returns findings and never acts — no file edits,
no writing tests into the tree, no GitHub posts. When another skill (typically
`run-review-lenses`) loaded you and asked for a structured finding list, obey
that wire format and stop there. When invoked on your own, review the change
set and report as below.

## Scope

- Prefer the net diff against `origin/main` (or the base the caller named).
- Include the working tree when the caller said to, or when pointed at local
  uncommitted work.
- Read both production diffs **and** test diffs. A change with no test file
  touch is a signal, not automatically a finding — pure refactors with existing
  coverage can be fine.
- Find the project's test runner and conventions (paths, names, fixtures) so
  recommendations match how this repo tests.
- Weight any focus area (a module, failure mode, or "we care about X"), but
  still cover the rest of the change.

## What to look for

Prioritize:

- **New behavior with no test** — a new branch, endpoint, flag, command, or
  public API path that nothing exercises.
- **Changed behavior with stale tests** — tests that still pass while asserting
  the old contract, or that were updated only in fixtures/snapshots so they no
  longer pin the meaning of the change.
- **Happy path only** — success tested; error, timeout, empty, auth failure,
  partial failure, and boundary inputs not tested where the code clearly has
  those paths.
- **Weak assertions** — tests that call the code but check little (status 200
  only, "did not throw", snapshot of unrelated noise). The test would pass if
  the bug shipped.
- **Missing negative / authorization cases** — permission checks, tenant
  isolation, invalid input rejection that the diff implements but does not test.
- **Integration / boundary gaps** — unit tests mock away the seam the change
  actually risks (DB, network, clock, config); no smoke or contract test at that
  seam when the change is about it.
- **Removed or skipped tests** — deleted, commented-out, or `skip`/`xit` without
  a replacement that covers the same risk.
- **Flaky or order-dependent tests** introduced by the change — shared mutable
  fixtures, time dependence, reliance on test execution order.
- **Orphan test updates** — large snapshot or golden-file rewrites that absorb a
  regression instead of asserting the intended delta.
- **Useless tests (propose prune)** — tests that add runtime, noise, or false
  confidence without locking a real contract. Look especially at tests the
  change **adds or expands**. Flag and recommend deletion (or collapse into a
  real assertion) when any of these hold:
  - **Tautologies** — assert constants, assert the mock was called with what the
    test just told the mock to return, assert framework defaults, assert that
    `true` is true.
  - **Tests of the mock / test double** — the production path is fully stubbed
    so the only thing under exercise is the test harness.
  - **Duplicate coverage** — two or more tests that fail for the same reason and
    would all stay green under the same bug; keep the strongest, prune the rest.
  - **Impossible / unreachable setups** — scenarios the type system, guards, or
    constructors make unreachable in production.
  - **Coverage theater** — call a function only to touch lines; no meaningful
    assertion on outcome, error, or state.
  - **Change-detector noise without intent** — brittle full-structure snapshots
    or string dumps that churn on every edit and do not document a deliberate
    contract (prefer pruning or replacing with a narrow assert).
  - **Obsolete tests** — still pass after the behavior they guarded was removed
    or inverted; they no longer protect anything.

  For each useless test, `suggested_fix` should name the test to **delete** (or
  the exact merge into a surviving test) and state what, if anything, still
  covers that risk afterward. Prefer prune over “make it stricter” when there
  is no real behavior left to lock.

Do **not** flag:

- Style of test code unrelated to what is proven.
- Demands for 100% line coverage on glue or generated code.
- Asking for tests on pure renames / move-only diffs with behavior unchanged and
  existing tests still exercising the path.
- Preferring one test framework over another without a coverage gap.
- Pruning a test that is the only lock on a real failure mode — tighten or
  replace it instead.
- Deleting tests solely because they are slow unless they also prove nothing.

## Method

1. List the **behaviors** the net diff adds or changes (not the files — the
   user-visible or contract-visible outcomes).
2. For each behavior, search for tests that exercise it (`rg` for symbols,
   route paths, error messages, flag names). Read those tests and judge what
   they actually assert.
3. Map each behavior to: covered well / covered weakly / uncovered. File
   findings on weak and uncovered where the risk justifies it.
4. Separately, inspect tests the change **adds or rewrites** (and nearby tests
   it leaves that clearly became obsolete). Ask of each: *what production bug
   would this catch that nothing else would?* If the answer is none, file a
   prune finding.
5. Prefer one finding per missing behavior — or per useless test / duplicate
   cluster — over a laundry list of every untested line.
6. When suggesting a fix for a gap, name the test kind (unit, table-driven edge
   cases, integration at seam X) and the assertion that would catch the bug —
   not "add more tests." When suggesting a prune, name the test id/path and the
   surviving coverage (or explicitly "none needed").

## Finding bar

**Gap findings** must state:

1. Which behavior or path is under-tested (reference the production location).
2. What existing tests do or fail to do about it.
3. What failure could ship unnoticed.
4. A concrete test (or assertion) that would catch it.

**Prune findings** must state:

1. Which test is useless (file + test name / line).
2. Why it proves nothing (tautology, duplicate, mock-only, obsolete, …).
3. What cost it imposes (noise, runtime, false confidence) if useful to say.
4. The prune action: delete it, or merge into which surviving test — and what
   still covers the risk afterward.

If coverage is adequate and no useless tests stand out, say so and return no
findings.

## Output

### When a caller requested structured findings

```
{ source, path, line, severity, title, body, suggested_fix }
```

- `source` — `test-coverage-code-review`
- `path` — for gaps, prefer the **production** file whose behavior is
  under-tested; for weak asserts, bad skips, snapshot absorb, or **useless
  tests**, use the test file path
- `line` — new-file line of the behavior, weak assert, or useless test; `null`
  when the gap is the absence of a test file
- `severity` — `blocker` (untested critical path / safety / data integrity) |
  `high` (core new behavior untested or tests would miss the bug) |
  `medium` (important edge/failure path missing, or a clearly useless test the
  change introduces) | `low` (nice-to-have edge, or low-cost duplicate/prune)
- `title` — short heading (`Prune …` when recommending deletion)
- `body` — for gaps: behavior, current posture, what could slip through; for
  prunes: why the test is useless and what remains after removal
- `suggested_fix` — for gaps: specific test case(s) and assertions to add or
  tighten (name a likely test file when conventions make it obvious); for
  prunes: delete test X / merge into Y, with surviving coverage noted

One-line headline: `needs-attention` or `approve`.

### When invoked standalone

Compact markdown: verdict line, short summary of coverage posture (gaps and
prunes), findings ranked by severity with locus, gap or useless-test rationale,
and recommended add/tighten **or** prune.

## Final check

Each finding must be about what is proven (or not), tied to this change's
behavior or its tests, honest about existing coverage, and paired with either a
test shape that would catch a real miss or a concrete prune that removes false
confidence — not a coverage-percentage scolding, and not deleting the only real
safety net.
