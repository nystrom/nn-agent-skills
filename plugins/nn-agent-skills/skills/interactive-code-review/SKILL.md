---
name: interactive-code-review
description: >-
  Walk a reviewer through a change set one change at a time, interactively —
  like a guided, grill-me-style review session rather than a static report.
  Runs in one of two modes. COMMENT mode (reviewing someone else's PR/branch):
  for each change it explains, to someone UNFAMILIAR with the codebase, what the
  change is, why it exists, what uses it and who consumes the result, then offers
  three ready-to-post comment options and posts the chosen one to GitHub. FIX
  mode (reviewing code local to this machine that you intend to fix): for each
  change it gives just enough context to fix safely, then proposes and applies
  the fix locally, verifying after each edit. It auto-detects the mode and states
  it; you can override in a word. It opens with a whole-PR overview and a
  high-level verdict (a justification or critique of the change as a whole,
  including cross-cutting concerns) before walking the changes one at a time.
  The review itself is produced by the run-review-lenses skill, which fans out to
  a parallel subagent per review lens installed in the environment and writes
  review.json; this skill reads that file and runs the session over it. So the
  goal is the software's long-run quality: it surfaces AI slop, refactoring and
  abstraction opportunities, and dead code, not just bugs. It reviews the NET
  diff (default: against origin/main; fix mode also includes uncommitted
  working-tree changes), going commit by commit to explain intent while ignoring
  changes that later commits undid, and skips bookkeeping noise. Use this
  whenever the user wants to review a PR or branch interactively, be walked
  through changes one by one, "grill me on this diff", review commit by commit,
  review against origin/main, draft and post GitHub review comments, OR walk
  through local changes and fix the problems ("fix the problems", "review my
  local changes and fix them") — even if they don't say "interactive". For the
  same review as one browsable HTML page with no back-and-forth, use
  ui-code-review; for the findings alone with no walkthrough, use
  run-review-lenses.
---

# Interactive Code Review

Guide a reviewer through a change set **one change at a time**, pausing after
each so they can act.

The review is not done here. `run-review-lenses` produces it — the queue of
semantic changes, each one's briefing and context, and the merged lens findings —
and writes `review.json`. This skill turns that file into a session.

## Two modes

The action at each change depends on the mode:

- **Comment mode** — reviewing *someone else's* change (a PR/branch). Assume the
  reviewer has **never seen this codebase**; make each change reviewable without
  them going hunting, then hand them three comment options and post the one they
  pick to GitHub.
- **Fix mode** — reviewing code *local to this machine that you intend to fix*.
  You usually wrote it, so the briefing is lighter — just enough context to fix
  safely. Instead of comments, you propose a fix, apply it with the edit tools,
  and verify after each edit.

**Detect the mode, state it in one line, let the reviewer override.** Keep the
detection dumb — the stated assumption plus a one-word override does the real
work:

- Clean working tree + a PR/branch you're reviewing → **comment mode**.
- Dirty working tree (uncommitted changes) + no PR → **fix mode**.
- Anything else (e.g. your own branch, with a PR, and uncommitted changes —
  routine) → pick the more likely one, **say which**, and move on. If the user's
  wording settles it ("fix the problems", "review my local changes"), that wins.

The mode is also what this skill passes down to `run-review-lenses`, so detect it
first:

| | `include_working_tree` | briefing depth |
|---|---|---|
| Comment mode | no — you comment on what will merge | `full` |
| Fix mode | yes — local work is usually in progress | `light` |

Read each resource as you reach the step that needs it:

- `references/interaction-protocol.md` — the turn-by-turn session and the
  per-mode action flow (three comment options vs. propose-and-apply-a-fix).
- `references/github-submit.md` — comment mode: posting to GitHub with `gh`.
- `references/apply-fix.md` — fix mode: proposing, applying, and verifying edits.

## Workflow

### 1. Detect the mode and run the review

Check the two signals:

```bash
git status --porcelain                                 # dirty tree? → leans fix mode
gh pr view --json number,url,headRefName 2>/dev/null   # a PR? → leans comment mode
```

State the mode in one line. Then invoke **`run-review-lenses`**, passing the two
inputs from the table above **explicitly**, plus the scope if the user named a PR,
branch, or range. Those values are authoritative — it will not re-derive them, so
the queue it builds always matches the mode you just stated. It establishes scope, walks the commits for intent,
splits semantic changes from bookkeeping, gathers each change's context, fans out
to every installed review lens, and writes `review.json`.

Read that file. It gives you everything the session needs:

- `overview.what` / `overview.verdict` and `structural[]` → step 2;
- `changes[]` — the queue, in order, each with its `diff`, `briefing`, `context`,
  and `comments` (the merged findings) → step 3;
- `summary.routine` — the bookkeeping list you mention once.

`M` is `len(changes)`. Every one of them gets a turn. The queue is fixed — do not
add to it, drop from it, or reorder it.

### 2. Open with a whole-PR overview and verdict

Before touching the first change, present **one** framing message about the PR as
a whole — this is the first thing the reviewer sees. Read the opening-overview
section of `references/interaction-protocol.md`. It has three parts, all of them
already in `review.json`:

- **What this PR does** — `overview.what`.
- **Scope** — `M` semantic changes queued, plus the one-line bookkeeping summary
  from `summary.routine`, so the reviewer knows the shape of what's coming. Say
  plainly that all `M` get a turn, including the ones nothing was flagged on. Do
  not pre-announce a subset ("3 of these need attention") as if it were the walk.
- **High-level verdict** — `overview.verdict`, plus the cross-cutting concerns
  from `structural[]`: the ones no single change owns. Take a position; don't
  hedge into a neutral recap.

End this message by stating you'll now walk the changes one at a time and waiting
for the reviewer to proceed.

### 3. Run the interactive session — one change at a time

Read `references/interaction-protocol.md` and follow it. In short, for **each**
entry in `changes[]`, in order — every one of the `M`, including the ones with an
empty `comments` list. A clean change gets the same turn shape as a flagged one:
the full briefing in comment mode, the trimmed one in fix mode. The briefing's job
is to orient a reviewer who has never seen the code, which has nothing to do with
whether a finding landed.

1. **Present the change** with a running counter ("Change 2 of M", where M is the
   full queue length — not a fixed number). Lead with `briefing.what`, then
   (comment mode) `briefing.why`, `briefing.uses`, `briefing.consumes`,
   `briefing.tested`, then the findings in `comments`. In fix mode, trim to the
   beats that make the fix safe. Present the `diff` in a fenced block, each
   `context` block under a `**Label (path:line)**` heading, and the findings as a
   short list, each tagged with its `source` lens.
2. **Offer the per-mode action** plus skip/custom (see protocol):
   - **Comment mode** — three comment options, different *angles* on the concern,
     not the same text reworded: `A) request a change`, `B) ask a question`,
     `C) nit / praise`.
   - **Fix mode** — the proposed fix (the finding's `suggested_fix`, with a
     preview of the edit) plus alternate approaches where they exist:
     `A) apply this fix`, `B) a different approach`, `C) leave as-is / skip`.
3. **Stop and wait.** This is a grill-me-style pause — end your turn and let the
   reviewer choose. Do not roll ahead to the next change on your own.
4. On their choice:
   - **Comment mode** — **post to GitHub** per `references/github-submit.md` (or
     copy out the text if posting isn't available), confirm in one line.
   - **Fix mode** — **apply and verify the edit** per `references/apply-fix.md`:
     make the edit, verify it (build/test where cheap, else re-read the affected
     function), confirm in one line. Never advance on a broken tree.

   Then present the next change.

### 4. Wrap up

When the queue is exhausted, give a short recap tuned to the mode:

- **Comment mode** — changes reviewed, comments posted (with links if `gh`
  returned them), changes skipped with no comment, and the one-line bookkeeping
  summary. Offer to submit an overall PR review verdict (approve / comment /
  request changes) if a PR exists.
- **Fix mode** — changes reviewed, fixes applied (with files touched), changes
  left as-is, and the bookkeeping summary. Report the state of any build/test
  verification you ran, and remind the reviewer the edits are uncommitted so they
  can inspect or revert before committing.

## Notes

- Never drop a change. `run-review-lenses` already collapsed the bookkeeping; what
  reaches you in `changes[]` is the walk, in full. A semantic change is never
  omitted for being small, obvious, or free of findings.
- Respect the reviewer's pace: one change per turn, always waiting for input
  before advancing. The value is a guided conversation, not a data dump.
- This session presents in the terminal as markdown. For a visual review — a
  GitHub-style diff, navigable panes, click-to-jump findings — that is
  `ui-code-review`, which renders the same `review.json` as one HTML page.
- In fix mode, verification is part of the turn, not an afterthought — an applied
  edit that hasn't been checked (build/test, or a re-read of the function) is not
  done, and a failed check blocks the next change.
