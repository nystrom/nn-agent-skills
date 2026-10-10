---
name: run-review-lenses
description: >-
  Review with every code-review lens installed in the environment (or a
  caller-selected subset of lenses/commands) and write review.json — the
  findings, and nothing else. Scope is a net diff (default), the whole repo, or
  user-specified paths. It fans out to a parallel subagent per relevant lens
  (skills and commands like the builtin code-review, discovered at review time),
  each loading and applying that lens, merged into one severity-ranked list.
  For diffs it walks commits for intent, splits semantic changes from
  bookkeeping, and gathers context so findings attach to the change they land
  on. Goal: long-run quality (AI slop, refactor opportunities, dead code), not
  just bugs. Does NOT walk you through changes, post to GitHub, edit files, or
  render a page. Use when the user wants findings alone, when another skill
  needs a review to build on, or as the default for a bare "review this" with no
  presentation named. For a guided session use interactive-code-review; for an
  HTML page use ui-code-review — both run this skill first (all lenses by
  default, or the lenses the user named).
---

# Run Review Lenses

Produce the review itself — scope, intent, classification, context, and the
lens fan-out — and record it in `review.json`. No presentation attached.
Something else decides what to do with the findings.

The goal is long-run quality, not merely bug-catching in a diff: AI slop,
cleaner abstractions, dead code, duplication to collapse.

## Inputs

All optional; defaults suit a standalone "review this" run. Full resolution
rules: `references/review-scope.md`.

- **`mode`** — `diff` (default) | `repo` | `paths`. Diff = net change set;
  repo = whole tree audit; paths = user-named pathspecs/packages/symbols.
- **Scope detail** — for `diff`: PR, branch, range, `base` (default
  `origin/main`), and `include_working_tree`. For `paths`: the pathspecs. For
  `repo`: optional focus hints (still whole-tree unless narrowed).
- **`lenses`** — optional allow-list of review lens names (skill slugs and/or
  commands such as `code-review`). **Default: all discovered applicable
  lenses.** When the user or a consumer names specific lenses ("only
  adversarial and dead-code", "performance review"), set `lenses` to exactly
  that set — including third-party review skills/commands installed in the
  environment. An empty allow-list is invalid; omit the input to mean all.
- **`caller`** — consumer name, or `none` when the user invoked this directly.
  Defaults to `none`. Stops at step 6 for a consumer, step 7 for a user.
- **Briefing depth** — `full` (default) or `light` (fix-oriented).

**Caller inputs are authoritative.** Do not re-derive a mode, path list,
`include_working_tree`, or `lenses` set the caller already chose.

Read each resource as you reach the step that needs it:

- `references/review-scope.md` — diff / repo / paths resolution.
- `references/change-classification.md` — semantic vs. routine (`diff` mode).
- `references/net-diff-and-context.md` — net-diff/commit reasoning and context
  gathering.
- `references/multi-agent-review.md` — discover lenses, apply optional
  `lenses` filter, fan-out, merge.
- `references/adversarial-review.md` — severity calibration and solo fallback.
- `references/review-json.md` — the output contract.

## Workflow

### 1. Establish scope

Resolve `mode` and the surface per `references/review-scope.md`. State mode,
base/pathspecs, and whether the working tree is included, in one line. Record
`scope` and `base` (for `paths`, put the pathspecs in `scope`).

```bash
git fetch origin --quiet
git status --porcelain
gh pr view --json number,url,headRefName 2>/dev/null
```

**`diff` mode** — net surface:

```bash
git diff origin/main...HEAD --stat
# with working tree:
git diff $(git merge-base origin/main HEAD) --stat
```

**`paths` mode** — same as diff but limited to the pathspecs, or tree-as-is
inside those paths when no range applies.

**`repo` mode** — no net diff required; inventory the tree’s natural areas
(packages, modules, top-level roots).

### 2. Intent

**`diff` / ranged `paths`:** read `references/net-diff-and-context.md`. Walk
commits for *why*; review only what survives in the net surface.

```bash
git log --oneline --no-merges origin/main..HEAD
```

**`repo` / path-as-is:** intent is an audit of the current code. Skip the
commit-undo dance; optionally skim recent history only when it explains a
hotspot.

### 3. Build the queue

**`diff` / ranged `paths`:** apply `references/change-classification.md`.
Semantic changes become queue items (group by logical change, not file).
Bookkeeping goes to `summary.routine`. No cap on queue length; never drop a
semantic change because it is small or unflagged.

**`repo` / path-as-is:** queue **logical areas** (one item per package/module
cluster under review). There is no bookkeeping collapse from a diff; skip
generated/vendor trees in `summary.routine` when you deliberately exclude them.
Say what you covered and what you left out.

**The queue is final here.** Later steps only attach findings.

### 4. For each queue item, gather context

Apply `references/net-diff-and-context.md` (adapt the beats to the mode).

For every queue item, fill the `briefing` beats:

- **What** — the change hunk (widened) in `diff` mode, or the area’s
  responsibility in `repo` / path-as-is mode.
- **Why it exists** — commit/PR intent for diffs; for repo audits, why this
  area matters in the system (one or two sentences).
- **What uses it / who calls it** — highest-value beat; `git grep -n` / `rg -n`.
- **Who consumes the result** — the other side of the interface.
- **What's tested** — covering tests, or explicit absence.

At `light` depth, gather only **what uses it** and **what's tested**.

Quote the minimum that makes the item reviewable (5–15 lines per block), each
with a real `path:line` → `context[]`. In `repo` mode, `diff` may be empty or a
short excerpt; findings still anchor to real paths.

### 5. Review with the multi-agent fan-out

Read `references/multi-agent-review.md` and follow it. Run the fan-out **once
over the whole surface** — not per queue item.

1. Discover every relevant review lens (skills *and* commands).
2. If `lenses` was set, **keep only names on that allow-list** (match skill
   slugs and command names; unknown names are an error to surface, not a
   silent skip of the whole run). If `lenses` was omitted, keep all applicable.
3. Spawn one unnamed `general-purpose` subagent per remaining lens on
   `model: "sonnet"`. Pass the **resolved scope** (mode, base/range, paths,
   working-tree flag) into each prompt so lenses do not re-widen or re-narrow.
4. Merge, de-duplicate, rank by severity. Route onto queue items or
   `structural[]`.

Skip a lens that genuinely has no context and say so. A queue item with no
findings gets `comments: []`.

### 6. Write the overview and the file

Write the three `overview` fields:

- **`what`** — 2–4 sentences: overall intent of the diff, or the audit’s focus
  for `repo` / `paths`.
- **`scope_line`** — one line including **mode**, what was queued, bookkeeping
  skipped (if any), and which lenses ran (or “all applicable”).
- **`verdict`** — a position. Draw on `structural[]`. Do not hedge into a
  neutral recap.

Assemble per `references/review-json.md` → `<workdir>/review.json`.

Report that path. **When `caller` names a consumer, stop here.**

### 7. Standalone ending

**Only when `caller` is `none`.** Short summary only:

- mode + scope line;
- queue size (and bookkeeping skipped, if any);
- lenses that ran;
- verdict in a sentence or two;
- findings ranked by severity: severity, `path:line`, finding, `[source]`;
- `review.json` path.

Then stop. Offer `interactive-code-review` or `ui-code-review` when a long
list is the wrong shape for the terminal.

## Notes

- Keep change `id`s short and stable (`c1`, `c2`, …).
- Never drop a queued semantic change or audit area because it is small or
  unflagged. Only `diff`-mode bookkeeping is collapsed.
- This skill posts nothing and edits nothing.
- A `suggested_fix` is recorded, never applied.
- Individual lenses are also invocable **standalone** (their own skills); this
  skill is the multi-lens orchestrator and the producer of `review.json`.
