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
  abstraction opportunities, and dead code, not just bugs. The review itself is
  produced by the run-review-lenses skill, which fans out to a parallel subagent
  per review lens installed in the environment and writes review.json; this skill
  renders that file as the page. It reviews the NET diff (against origin/main by
  default, including uncommitted work when the tree is dirty), reading commits for
  intent while ignoring changes that later commits undid. Output is a single HTML file that needs no server and
  fetches nothing. Use this whenever the user wants a visual/web/GUI code review,
  a GitHub-like diff walkthrough, a review "in a browser", a review page or
  report they can read and share, or the interactive-code-review content without
  the back-and-forth. The finished page opens in the reader's browser on its own.
  For a turn-by-turn review that posts comments or applies fixes, use
  interactive-code-review instead. A bare "review this code" that says nothing
  about wanting a page belongs to run-review-lenses, not here.
---

# UI Code Review

Review a change set and write the whole thing out as **one HTML page**.

The review is not done here. `run-review-lenses` produces it — the net-diff
classification, the parallel lens fan-out, the per-change briefing beats — and
writes `review.json`. This skill turns that file into a page: the reader gets the
whole review at once in a browser, and nothing is interactive.

`interactive-code-review` reads the same file and walks it turn by turn instead.

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
they want `interactive-code-review`; say so and switch. If they want the findings
alone with no page at all, that is `run-review-lenses` on its own.

Read each resource as you reach the step that needs it:

- `references/page-content.md` — what the Overview tab and each change section
  must say.
- `references/diagrams.md` — when a diagram earns its place, and the specs for the
  before/after diagrams, the old-way/new-way usage pair, and the advantages /
  disadvantages / risks block.
- `references/web-presentation.md` + `scripts/render_app.py` — the `state.json`
  model, the toggles, and how to render.

## Workflow

### 1. Run the review

Invoke **`run-review-lenses`**. It establishes scope (the net diff against
`origin/main`, extended through uncommitted work when the tree is dirty), walks
the commits for intent, splits semantic changes from bookkeeping, gathers each
change's context, fans out a parallel subagent per installed review lens, and
writes `review.json`. Pass `caller: ui-code-review`, so it stops at the file
instead of printing its own summary. If the user named a PR, branch, or range,
pass that through too. Ask for `full` briefing depth — the page is read by someone
who may never have seen the code, and there is no conversation to fill a gap.

Read that file. It is the whole review:

- `overview.what` / `overview.verdict` and `structural[]` → the Overview tab;
- `summary` — the counts and the `routine` bookkeeping list → the folded list;
- `changes[]` — the queue in order, each with its `diff`, `briefing`, `context`,
  and `comments` → one section each in the Changes tab.

The queue is fixed. Every entry gets its own section, including the ones with an
empty `comments` list. Do not add, drop, or reorder.

### 2. Draw what the diff cannot say

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

### 3. Build the state and render the page

Start from `review.json` and **add** to it — it already carries the `overview`
(`what`, `scope_line`, `verdict`), the `summary` with its bookkeeping `routine`
list, and every `changes[]` entry with its `diff`, `briefing` beats, `context`
blocks, and merged `comments[]`. Never rewrite a field it owns.

What this skill adds, per `references/web-presentation.md` and the content
`references/page-content.md` describes:

- `overview.cross_cutting` — the `structural[]` findings as flat display strings,
  one per entry;
- `overview.diagrams` and `overview.tradeoffs` from step 2;
- per change: `diagrams`, `usage`, and `tradeoffs` from step 2, plus the alternate
  diff renderings the toolbar needs — the whole-file `diff_all`, the
  whitespace-ignored `diff_nows` / `diff_all_nows`, and the old/new file text in
  `files` where they help. The contract's `diff` already holds **only this
  change's hunks**; leave it that way.

```bash
python3 <skill>/scripts/render_app.py <workdir>/state.json -o <workdir>/review.html --open
```

(Paths are relative to this skill's directory.) `--open` opens the finished page
in the reader's default browser; always pass it, since the page is the review and
they are waiting to read it.

### 4. Hand over the page

The page is already open in the browser. Give the reader the file path — so they
can find it again, and in case this machine could not launch a browser (the script
says so when it could not) — and a short headline: the verdict in a sentence or
two, and how many changes are written up against how many bookkeeping edits were
skipped. Do not restate the review in the terminal — the page is the review. Then
stop; there is nothing to wait for.

## Notes

- Keep change `id`s short and stable (`c1`, `c2`, …); the page anchors findings to
  new-file line numbers via those ids, in both directions — a finding jumps to its
  diff line, and the line's marker jumps back to the finding.
- Never hand-author SVG or HTML into a state field. Diagrams are declarative; the
  renderer draws them.
- Never drop a change. `run-review-lenses` already collapsed the bookkeeping into
  `summary.routine`; every entry in `changes[]` gets its own section. A semantic
  change is never omitted for being small, obvious, or free of findings.
- Every text field renders inline markdown only (`` `code` ``, `**bold**`,
  `*italic*`, newlines). Code goes in `context[]`, not in a fenced block.
- `scripts/render_app.py` is stdlib-only; the page is offline-safe (no CDN, no
  fetch) and theme-aware, so it can be copied or attached like any other file.
- Rendering never fails because a browser could not be launched: `--open` reports
  it on stderr and leaves the written page behind.
