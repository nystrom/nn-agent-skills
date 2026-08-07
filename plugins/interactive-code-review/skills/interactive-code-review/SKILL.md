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
  Either way the goal is to improve the software's long-run quality, so the
  review also hunts for AI slop, refactoring and abstraction opportunities, and
  dead code — not just bugs. The review itself
  fans out to a parallel subagent per relevant review lens installed in the
  environment — skills and commands like the builtin code-review, discovered at
  review time, not a fixed set — each loading and applying that lens, merged into
  one findings list. It reviews the NET
  diff (default: against origin/main; fix mode also includes uncommitted
  working-tree changes), going commit by commit to explain intent while ignoring
  changes that later commits undid, and skips bookkeeping noise. In a GUI it
  renders an HTML card per change. Use this whenever the user wants to review a
  PR or branch interactively, be walked through changes one by one, "grill me on
  this diff", review commit by commit, review against origin/main, draft and post
  GitHub review comments, OR walk through local changes and fix the problems
  ("fix the problems", "review my local changes and fix them") — even if they
  don't say "interactive".
---

# Interactive Code Review

Guide a reviewer through a change set **one change at a time**, pausing after
each so they can act. The overarching goal is to make the software *better in
the long run*, not merely to catch bugs in this diff — so read every change
asking not just "is this correct?" but "does this raise the quality of the
codebase?": AI slop, opportunities to refactor or introduce a cleaner
abstraction, dead code to remove, duplication to collapse.

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

Everything else is shared. Read each resource as you reach the step that needs
it:

- `references/change-classification.md` — semantic vs. routine (what to walk
  vs. what to summarize as bookkeeping).
- `references/net-diff-and-context.md` — the net-diff/commit reasoning **and**
  how to gather context (definitions, callers, consumers, tests); how much
  context depends on the mode.
- `references/multi-agent-review.md` — the fan-out: **discover every relevant
  installed review lens (skills *and* commands like `/code-review`) → one subagent
  loads and applies each → one merged findings list**, plus applicability
  detection.
- `references/adversarial-review.md` — how to turn findings into good comments
  (severity calibration, question-vs-accusation, praise) and the solo checklist
  for when no review skill can be loaded at all.
- `references/interaction-protocol.md` — the turn-by-turn session and the
  per-mode action flow (three comment options vs. propose-and-apply-a-fix).
- `references/github-submit.md` — comment mode: posting to GitHub with `gh`.
- `references/apply-fix.md` — fix mode: proposing, applying, and verifying edits.
- `references/review-schema.md` + `scripts/render_review.py` — the HTML card.

## Workflow

### 1. Detect the mode and establish scope

Sync refs and check the working tree; the two signals together pick the mode and
the scope:

```bash
git fetch origin --quiet
git status --porcelain                       # dirty tree? → leans fix mode
gh pr view --json number,url,headRefName 2>/dev/null   # a PR? → leans comment mode
```

**Comment mode** reviews the **net diff against origin/main** — committed work
only, since you comment on what will merge:

```bash
git diff origin/main...HEAD --stat          # or origin/master if that's the base
```

`A...B` (three dots) diffs against the merge-base, so it already shows the *net*
effect of the branch.

**Fix mode** reviews the net diff **plus uncommitted working-tree changes** as
one surface — local fixing is usually work-in-progress. Diff from the merge-base
to the working tree in a single command so files that are both committed and
further modified aren't listed twice:

```bash
git diff $(git merge-base origin/main HEAD) --stat   # merge-base → working tree
```

(Omitting the second ref makes `git diff` compare against the working tree, so
this is `origin/main...HEAD` *extended through* the uncommitted changes — not two
separate diffs.) If the tree is clean, this reduces to the same net diff as
comment mode.

If the user names a PR, branch, or range, use that instead. State the mode and
scope you chose in one line and proceed. Only ask if it's genuinely ambiguous
(e.g. detached HEAD with no obvious base).

### 2. Understand the branch commit by commit — but review the net diff

Read `references/net-diff-and-context.md`. The key idea: **walk the commits to
learn *why* each change exists, but review the net diff so changes that a later
commit undid never reach the reviewer.**

```bash
git log --oneline --no-merges origin/main..HEAD     # newest → oldest
```

Read the commit messages (and per-commit diffs when a message is thin) to build
the *intent* behind each surviving change. Then classify against the **net**
diff from step 1 — anything added and later reverted simply isn't in it, so it
is correctly out of scope. Do not review intermediate states.

### 3. Classify: semantic vs. bookkeeping

Apply `references/change-classification.md`. Keep the **semantic** changes — the
ones that change what the code does (logic, control flow, interfaces,
concurrency, security, behavior-changing config, behavior deletions). Collapse
**bookkeeping** — whitespace/reformat, import shuffles, pure renames,
moved-unchanged code, generated files/lockfiles, snapshot text, comment-only
edits — into a short "skipped" list you mention once, then never bring up again.
Those two buckets are exhaustive: a change is either semantic or it matches a
bookkeeping category in the reference. "Not worth reviewing" is not a third
bucket. The one collapse that spans both is the repeated mechanical edit
(`foo()` → `self.foo()` across 30 call sites): queue one representative
instance and summarize the identical remainder with its count, per the
"Borderline calls" section of the reference. That applies only when the sites
really are identical — any site that differs is its own queue item.

Order the surviving semantic changes into a review queue. Group by logical
change, not by file: one reviewable idea = one queue item, even across files.
**There is no cap on the queue length** — it holds *every* semantic change,
whether that is 2 or 30. Never truncate to a "top N" or a round number, and never
drop a real change to keep the session short; only bookkeeping (above) is
collapsed. The counter total `M` is simply however many semantic changes there
are.

**The queue is final here.** Later steps attach findings to queue items; they
never add or remove one. Whether a review lens flagged something has no bearing
on whether a change is walked — a correct, uncontroversial change is still a
change the reviewer walks through.

### 4. For each change, gather context

Apply the context-gathering guidance in `references/net-diff-and-context.md`.
**How much context depends on the mode:**

- **Comment mode** — gather it for a reviewer who has *never seen the code*. All
  four beats below matter; the callers/consumers are the highest-value context.
- **Fix mode** — you usually wrote this, so gather only what makes the fix
  *safe*: mainly what uses it / who calls it (so a fix doesn't break a caller)
  and what's tested (so you know whether a fix is covered). Skip the explanatory
  beats you already know.

For every queue item:

- **What** the change is (the diff hunk, widened so it reads in situ).
- **Why it exists** — from the commit message / PR intent, in plain language.
- **What uses it / who calls it** — call sites of a changed function, importers
  of a changed symbol. This is the highest-value context; find it with
  `git grep -n` or `rg -n`.
- **Who consumes the result** — the other side of the interface: the reader of
  what was written, the handler of what was emitted, the caller that uses the
  return value.
- **What's tested** — the covering test, or note its absence.

Quote the *minimum* that makes it reviewable (5–15 lines per block), each with a
real `path:line`.

### 5. Review with the multi-agent fan-out → "what could be improved"

Read `references/multi-agent-review.md` and run the fan-out **once over the whole
change set**: discover every relevant review lens installed in the environment —
skills *and* commands like the builtin `/code-review` — and spawn a parallel
subagent per lens that **loads and applies it** (a skill via the `Skill` tool;
the builtin `code-review` command by reading and following its instruction file),
whose findings all merge into **one list**. It covers correctness
bugs *and* long-run quality (AI slop, refactor and abstraction opportunities,
dead code, duplication) *and* conformance to standards/spec — whatever the
available lenses cover.

Discover and gate applicability first (per the reference): select review lenses
by **what each one is for** (any code-review lens, however terse its
description). Look in two places — the available-skills list for **skills**, and
the plugin commands directory for the builtin **`code-review` command** (which
won't show up as a skill; find its instruction file with a glob like
`~/.claude/plugins/**/commands/code-review.md`). Exclude `interactive-code-review`
itself, and let each lens self-gate on its own stated domain against the repo and
diff — biasing toward inclusion, since a standards doc (`CLAUDE.md`, etc.) is
almost always present and overlapping general lenses de-duplicate at the merge
step. Apply the `code-review` command in **both modes** by **reading its
instruction file and following the methodology while skipping its eligibility
bail, its confidence filter, and its final GitHub post** — it returns findings, it
never comments; its only PR dependency is in those stripped reporting steps, so in
fix mode you just feed it the fix-mode diff. A quality-review skill that ends by
applying a change (e.g. `simplify`) is a lens too: invoke it via the `Skill` tool
but **stop at its findings**, returning the change as a `suggested_fix` rather than
letting it edit. Skip any lens that genuinely has no context, and say so rather
than faking findings. If no subagent tool is available, load and apply the lenses
inline in sequence — same merged list, no parallelism.

De-duplicate and rank the merged findings by severity, then attach each to the
queue item it lands on, tagged by its `source` skill name as provenance. These
become the reviewer's talking points and seed the per-change action (comment
options in comment mode, proposed fixes in fix mode). File real concerns only — a
change that collects no findings gets an honest "nothing jumps out" **and still
gets its own turn in step 7**, presented like any other. Findings are one beat of
a change's briefing, not the reason it is in the queue.

### 6. Open with a whole-PR overview and verdict

Before touching the first change, present **one** framing message about the PR as
a whole — this is the first thing the reviewer sees. Read the opening-overview
section of `references/interaction-protocol.md`. It has three parts:

- **What this PR does** — the overall intent across all commits, in 2–4
  sentences, synthesized from the commit walk (step 2) and the net diff, not a
  file-by-file list.
- **Scope** — the count of semantic changes queued and the one-line bookkeeping
  summary of what's skipped, so the reviewer knows the shape of what's coming.
  Say plainly that all `M` get a turn, including the ones nothing was flagged
  on. Do not pre-announce a subset ("3 of these need attention") as if it were
  the walk.
- **High-level verdict** — a justification *or* a critique of the change as a
  whole: does the PR, taken together, earn its place? Call out cross-cutting
  concerns that no single change owns — architectural direction, missing tests
  across the board, scope creep, a cleaner decomposition, whether it should be
  split. Pull these from the merged fan-out findings that are structural rather
  than local. Take a position; don't hedge into a neutral recap.

End this message by stating you'll now walk the changes one at a time and waiting
for the reviewer to proceed. Then continue to step 7.

### 7. Run the interactive session — one change at a time

Read `references/interaction-protocol.md` and follow it. In short, for **each**
queue item, in order — every one of the `M`, including the ones no lens flagged.
A clean change gets the same turn shape as a flagged one — the full briefing in
comment mode, the trimmed one in fix mode. The briefing's job is to orient a
reviewer who has never seen the code, which has nothing to do with whether a
finding landed.

1. **Present the change** with a running counter ("Change 2 of M", where M is the
   full queue length — not a fixed number). Lead with a
   one-sentence "what this is", then (comment mode) why it exists, what uses it /
   who calls it, who consumes the result, then what could be improved. In fix
   mode, trim the explanatory beats to just what makes the fix safe.
   - **In a GUI**: render an HTML card for *this one change* by building a
     single-entry JSON (schema in `references/review-schema.md`) and running
     `scripts/render_review.py`, then present the file. Put the explanation and
     the per-mode action options in the chat alongside it. The card shows the
     same findings in both modes; in fix mode the proposed fix is presented and
     applied through the chat + edit tools, not baked into the card.
   - **In a terminal / no GUI**: present the same as clean markdown — the diff in
     a fenced block, context quoted with paths, concerns as a short list.
2. **Offer the per-mode action** plus skip/custom (see protocol):
   - **Comment mode** — three comment options, different *angles* on the concern,
     not the same text reworded: `A) request a change`, `B) ask a question`,
     `C) nit / praise`.
   - **Fix mode** — the proposed fix (with a preview of the edit) plus alternate
     approaches where they exist: `A) apply this fix`, `B) a different approach`,
     `C) leave as-is / skip`.
3. **Stop and wait.** This is a grill-me-style pause — end your turn and let the
   reviewer choose. Do not roll ahead to the next change on your own.
4. On their choice:
   - **Comment mode** — **post to GitHub** per `references/github-submit.md` (or
     copy out the text if posting isn't available), confirm in one line.
   - **Fix mode** — **apply and verify the edit** per `references/apply-fix.md`:
     make the edit, verify it (build/test where cheap, else re-read the affected
     function), confirm in one line. Never advance on a broken tree.

   Then present the next change.

### 8. Wrap up

When the queue is exhausted, give a short recap tuned to the mode:

- **Comment mode** — changes reviewed, comments posted (with links if `gh`
  returned them), changes skipped with no comment, and the one-line bookkeeping
  summary. Offer to submit an overall PR review verdict (approve / comment /
  request changes) if a PR exists.
- **Fix mode** — changes reviewed, fixes applied (with files touched), changes
  left as-is, and the bookkeeping summary. Report the state of any
  build/test verification you ran, and remind the reviewer the edits are
  uncommitted so they can inspect or revert before committing.

## Notes

- Keep change `id`s short and stable (`c1`, `c2`, …); the HTML card anchors
  comments to new-file line numbers.
- Never drop a change. The only changes that skip the walk are the ones matching
  a bookkeeping category in `references/change-classification.md`, and they go in
  the one-line summary. A semantic change is never omitted for being small,
  obvious, or free of findings.
- Respect the reviewer's pace: one change per turn, always waiting for input
  before advancing. The value is a guided conversation, not a data dump.
- In fix mode, verification is part of the turn, not an afterthought — an applied
  edit that hasn't been checked (build/test, or a re-read of the function) is not
  done, and a failed check blocks the next change.
