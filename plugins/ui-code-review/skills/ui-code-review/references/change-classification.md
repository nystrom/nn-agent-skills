# Change classification

The goal: a reviewer opens the review and sees only what deserves human
attention, with everything else accounted for in a one-line summary. Err toward
showing something in full when unsure — but keep genuinely mechanical edits out
of the diff view.

## Always show in full (→ `changes[]`)

- New or modified **logic**: conditionals, loops, calculations, state changes.
- **Control flow**: early returns, error handling, retries, try/except, guards.
- **Interface / API changes**: function signatures, public method changes,
  route definitions, schema/model fields, event names, CLI flags.
- **Concurrency / async**: locks, awaits, threads, ordering, shared state.
- **Security-sensitive** code: auth, permissions, input validation, crypto,
  SQL/command construction, secrets handling, deserialization.
- **Config that changes behavior**: feature flags, timeouts, limits, defaults.
- **Deletions of behavior**: removed checks, removed cases, removed tests.
- **Dependency changes** that aren't a routine bump (new lib, major version).

## Summarize as one line each (→ `summary.routine[]`)

- **Whitespace / reformatting only**: collapse to a count —
  `"Whitespace/reformat only in 4 files (skipped)"`. Detect with
  `git diff -w` (if a file vanishes from the whitespace-ignoring diff, its
  changes are whitespace-only).
- **Import add/remove/reorder**: `"Removed unused import \`os\`;
  added \`from typing import Optional\` in 2 files"`. Only elevate an import
  change to a full change if it swaps one implementation for another with
  behavioral consequences.
- **Pure renames** (symbol/file) with no logic change: note old→new name.
- **Moved code** that is otherwise unchanged: `"Moved \`parse_config\` from
  utils.py to config.py, unchanged"`. Don't re-review moved code.
- **Generated / vendored files, lockfiles, minified bundles**: never show;
  summarize as `"package-lock.json regenerated (+412 -· lines, not reviewed)"`.
- **Test snapshots**: describe the *semantic* delta, not the raw text —
  `"Snapshot \`UserCard\` updated: label text \"Sign in\" → \"Log in\""`. If a
  snapshot change implies a real behavior change, ALSO create a full change for
  the source edit that caused it.
- **Comment/docstring-only** edits, unless they change documented behavior.

## Borderline calls

- A one-line logic tweak buried in a reformat → extract just that line as a
  change; summarize the reformat separately.
- Large mechanical refactors (e.g. `foo()` → `self.foo()` across 30 sites):
  show one representative instance as a change, summarize the rest as routine
  with the count.
- If you can't tell whether an edit changes behavior, show it and say so in a
  `question` comment.
