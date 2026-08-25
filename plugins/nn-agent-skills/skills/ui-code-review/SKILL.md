---
name: ui-code-review
description: >-
  Produce a complete code review of a change set as ONE self-contained HTML page,
  read in the browser instead of the terminal. The page has two tabs. The Overview
  tab tells the whole-change story: what it does, its scope, before/after diagrams
  of the architecture, a high-level verdict, the advantages, disadvantages, and
  risks of the change, the cross-cutting concerns, and the bookkeeping edits that
  were skipped. The Changes tab lays out every semantic change in three panes: a
  sidebar that navigates the changes, a GitHub-style diff in the center showing
  only that change's hunks — with a marker on every line that carries a finding,
  a toggle for every change to the file, buttons for the whole old and new file,
  show/hide whitespace, and side-by-side vs. unified — and on the right the
  change's briefing (what it is, why it exists, what uses it, who consumes the
  result, what's tested), diagrams and an old-way/new-way comparison where they
  help, the surrounding code it needs, and the review findings with click-to-jump
  line anchors. It is a report, not a session: it asks nothing, posts nothing to
  GitHub, and edits no files. The review hunts for AI slop, refactor and
  abstraction opportunities, and dead code, not just bugs, by fanning out to a
  parallel subagent per relevant review lens installed in the environment.
  It reviews the NET diff (against origin/main by default, including uncommitted
  work when the tree is dirty), reading commits for intent while ignoring changes
  that later commits undid. Output is a single HTML file that needs no server and
  fetches nothing. Use this whenever the user wants a visual/web/GUI code review,
  a GitHub-like diff walkthrough, a review "in a browser", a review page or
  report they can read and share, or the interactive-code-review content without
  the back-and-forth. For a turn-by-turn review that posts comments or applies
  fixes, use interactive-code-review instead.
---

# UI Code Review

Review a change set and write the whole thing out as **one HTML page**. This is
the same review as `interactive-code-review` — the same net-diff classification,
the same parallel fan-out, the same per-change briefing beats — with two
differences: the reader gets it all at once in a browser, and nothing is
interactive. As there, the goal is to make the software *better in the long run*
— read every change asking "does this raise the quality of the codebase?": AI
slop, cleaner abstractions, dead code, duplication — not merely "is this
correct?".

## The page

`scripts/render_app.py` bakes `state.json` into a single self-contained HTML file
that opens over `file://` — no server, no polling, no network:

- **Overview tab** — what the change does, scope, the before/after architecture
  diagrams, the verdict, the advantages / disadvantages / risks, the cross-cutting
  concerns, and the folded list of skipped bookkeeping;
- **Changes tab, left** — a sidebar that navigates the changes, with severity
  counts;
- **Changes tab, center** — a GitHub-style diff of **only that change's hunks**,
  with a **marker on every line carrying a finding**, a **Whole file** toggle for
  the rest of the file's changes, **Old file / New file** buttons for the whole
  file either side of the change, **show/hide whitespace**, **side-by-side vs.
  unified**, and **old-only / new-only**; above it, the change's diagrams and its
  old-way/new-way comparison when it has them;
- **Changes tab, right** — the change's briefing, its advantages /
  disadvantages / risks, the surrounding code it needs, and the findings, each
  with a click-to-jump line anchor.

Because the page is the entire review, everything the reader needs has to be
*in* it. There is no conversation to fill a gap: an unstated caller, a missing
"why", or a finding you meant to explain in chat is simply lost. Write it out.

## What this skill does not do

It asks nothing, posts no GitHub comments, and edits no files. It does not walk
the reviewer through the changes one at a time. If the user wants any of that,
they want `interactive-code-review`; say so and switch.

Read each resource as you reach the step that needs it:

- `references/change-classification.md` — semantic vs. routine (what to write up
  vs. what to summarize as bookkeeping).
- `references/net-diff-and-context.md` — net-diff/commit reasoning **and** context
  gathering.
- `references/multi-agent-review.md` — the fan-out: discover every installed
  review lens (skills *and* commands like `/code-review`) → one subagent applies
  each → one merged findings list.
- `references/adversarial-review.md` — turning findings into good comments, and
  the solo checklist when no review lens can be loaded.
- `references/page-content.md` — what the Overview tab and each change section
  must say.
- `references/diagrams.md` — when a diagram earns its place, and the specs for the
  before/after diagrams, the old-way/new-way usage pair, and the advantages /
  disadvantages / risks block.
- `references/web-presentation.md` + `scripts/render_app.py` — the `state.json`
  model, the toggles, and how to render.
- `references/review-schema.md` — the per-change JSON fields (the page state is a
  superset).

## Workflow

Steps 1–5 are the review itself and are **identical** to
`interactive-code-review`. Steps 6–7 replace its session with a page.

### 1. Establish scope

```bash
git fetch origin --quiet
git status --porcelain                                 # dirty tree?
gh pr view --json number,url,headRefName 2>/dev/null   # is there a PR?
```

Review the net diff against `origin/main`; when the tree is dirty, include the
uncommitted work as part of the same surface:
`git diff $(git merge-base origin/main HEAD) --stat`. If the user names a
PR/branch/range, use that instead. State the base and scope in one line.

### 2. Understand the branch commit by commit — but review the net diff

`git log --oneline --no-merges origin/main..HEAD`. Read commit messages to build
*intent*, then classify against the **net** diff. Do not review intermediate
states. (Details in `references/net-diff-and-context.md`.)

### 3. Classify: semantic vs. bookkeeping

Per `references/change-classification.md`. Keep the **semantic** changes — the
ones that change what the code does; collapse **bookkeeping** into the one-line
summary plus the folded `summary.routine` list. Those two buckets are exhaustive:
a change is either semantic or it matches a bookkeeping category in the
reference. "Not worth reviewing" is not a third bucket. The one collapse that
spans both is the repeated mechanical edit (`foo()` → `self.foo()` across 30 call
sites): write up one representative instance and summarize the identical
remainder with its count, per the reference's "Borderline calls". Any site that
differs is its own item.

Order the surviving semantic changes into a queue, grouped
one-reviewable-idea-per-item across files. **No cap on queue length**; `M` is
however many semantic changes there are. **The queue is final here** — later
steps attach findings to items, they never add or remove one. Whether a lens
flagged something has no bearing on whether a change is written up.

### 4. For each change, gather context

Per `references/net-diff-and-context.md`: the callers, the definitions, the
consumers, the tests. Quote the minimum that makes it reviewable (5–15 lines per
block), each with a real `path:line`. These become the change's `context[]`
blocks — the page renders them, so gather them for every change.

### 5. Review with the multi-agent fan-out → "what could be improved"

Per `references/multi-agent-review.md`, run the fan-out **once over the whole
change set**: discover every relevant installed review lens, spawn a parallel
subagent per lens that loads and applies it, merge into one list. Every lens
subagent runs on Sonnet (`model: "sonnet"`), not the model driving the review.
De-duplicate, rank by severity, attach each finding to the queue item it lands on
tagged by its `source` lens. File real concerns only — a change that collects no
findings still gets its own section on the page. Structural findings that belong
to no single change go to the Overview tab's verdict and cross-cutting list.

### 6. Draw what the diff cannot say

Per `references/diagrams.md`, and only where it earns its place:

- **before/after architecture diagrams** in `overview.diagrams` when the change
  moves control or data flow, moves a responsibility between components, or adds
  or collapses a layer — and per change in `changes[].diagrams` when one queue
  item restructures something local. A single-file logic fix, a rename, or a diff
  that already reads clearly gets **no** diagram.
- **the old way vs. the new way** in `changes[].usage` when a call signature, a
  protocol, or an abstraction boundary changed, so the reader sees what they must
  now write.
- **advantages, disadvantages, and risks** in `overview.tradeoffs`, which is
  required, and in `changes[].tradeoffs` for a change with its own bargain.
  Disadvantages are costs accepted permanently; risks are what may go wrong on
  rollout or later. They are different lists.

### 7. Build the state and render the page

Assemble the whole review into one `state.json` per
`references/web-presentation.md`, with the content
`references/page-content.md` describes: the `overview` (what / scope / diagrams /
verdict / tradeoffs / cross-cutting), the `summary` with the bookkeeping `routine`
list, and one entry per queue item in `changes[]` — each with **only its own
hunks** in `diff` (plus the whole-file `diff_all`, the whitespace-ignored
`diff_nows` / `diff_all_nows`, and the old/new file text in `files` where they
help), the `briefing` beats, the `context` blocks, its diagrams, usage, and
tradeoffs, and the merged findings as `comments[]`.

```bash
python3 <skill>/scripts/render_app.py <workdir>/state.json -o <workdir>/review.html
```

(Paths are relative to this skill's directory.)

### 8. Hand over the page

Give the reader the file path and a short headline: the verdict in a sentence or
two, and how many changes are written up against how many bookkeeping edits were
skipped. Do not restate the review in the terminal — the page is the review. Then
stop; there is nothing to wait for.

## Notes

- Keep change `id`s short and stable (`c1`, `c2`, …); the page anchors findings to
  new-file line numbers via those ids, in both directions — a finding jumps to its
  diff line, and the line's marker jumps back to the finding.
- Never hand-author SVG or HTML into a state field. Diagrams are declarative; the
  renderer draws them.
- Never drop a change. The only changes that skip the write-up are the ones
  matching a bookkeeping category in `references/change-classification.md`, and
  they go in the one-line summary. A semantic change is never omitted for being
  small, obvious, or free of findings.
- Every text field renders inline markdown only (`` `code` ``, `**bold**`,
  `*italic*`, newlines). Code goes in `context[]`, not in a fenced block.
- `scripts/render_app.py` is stdlib-only; the page is offline-safe (no CDN, no
  fetch) and theme-aware, so it can be copied or attached like any other file.
