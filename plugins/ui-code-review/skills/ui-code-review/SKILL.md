---
name: ui-code-review
description: >-
  Walk a reviewer through a change set one change at a time in a local web UI —
  the same guided, grill-me-style review as interactive-code-review, but rendered
  as a three-pane page instead of terminal markdown. Far-left sidebar navigates
  the files/changes; the center shows a GitHub-style diff with show/hide
  whitespace, side-by-side vs. unified, and old-only / new-only toggles; the right
  pane carries the change summary, explanation, and review comments plus a box to
  compose your reply. The diff refreshes automatically as the agent edits code.
  Runs in the same two modes as interactive-code-review — COMMENT mode (reviewing
  someone else's PR/branch: three ready-to-post comment options, posted to GitHub)
  and FIX mode (reviewing local code you intend to fix: propose, apply, and verify
  edits) — auto-detected and stated, overridable in a word. It opens with a
  whole-PR overview and a high-level verdict before walking changes one at a time,
  and hunts for AI slop, refactor/abstraction opportunities, and dead code, not
  just bugs, by fanning out to a parallel subagent per relevant review lens
  installed in the environment. It reviews the NET diff (default: against
  origin/main; fix mode also includes uncommitted working-tree changes). KNOWN
  LIMIT: a pure skill cannot inject the web page's compose box into the running
  agent, so you type your replies in the terminal where Claude runs (the page's
  box composes and copies the text for you). Use this whenever the user wants a
  visual/web/GUI code review, a GitHub-like diff walkthrough, to "review this in a
  browser", or the interactive-code-review experience with a real diff UI.
---

# UI Code Review

Guide a reviewer through a change set **one change at a time** in a **local web
UI**, pausing after each so they can act. This is the same review as
`interactive-code-review` with a different surface: the *brain* (net-diff
classification, the parallel fan-out findings, the per-change briefing beats, the
comment/fix actions) is identical; only the presentation changes. As there, the
goal is to make the software *better in the long run* — read every change asking
"does this raise the quality of the codebase?": AI slop, cleaner abstractions,
dead code, duplication — not merely "is this correct?".

## The surface, and its one limitation

A small local server (`scripts/serve_review.py`) serves a three-pane page:

- **left** — a sidebar that navigates the changes (and an overview entry);
- **center** — a GitHub-style diff with **show/hide whitespace**, **side-by-side
  vs. unified**, and **old-only / new-only** toggles;
- **right** — the change's summary, explanation, and review comments, plus a
  compose box.

The page reads a single `state.json` (see `references/web-presentation.md`) and
**polls it**, so every time you rewrite that file — advancing to the next change,
or after an edit changes the diff — the page **refreshes on its own**.

**The limitation, stated up front to the user:** a pure skill cannot feed the web
page's compose box back into the agent you're running in (that would need a
Claude Code *channel*, which must be launched with the session). So **the chat
you drive the review with is the terminal** — the web page is the rich diff +
review *viewer*, and its compose box only composes your reply and copies it for
you to paste into the terminal. Say this once when you hand over the URL, then run
the review from the terminal as usual.

## Two modes

Identical to `interactive-code-review`:

- **Comment mode** — reviewing *someone else's* change (a PR/branch). Assume the
  reviewer has **never seen this codebase**; make each change reviewable, then
  hand them three comment options and post the one they pick to GitHub.
- **Fix mode** — reviewing code *local to this machine that you intend to fix*.
  The briefing is lighter; instead of comments, you propose a fix, apply it with
  the edit tools, and verify after each edit.

**Detect the mode, state it in one line, let the reviewer override** (dumb
detection + one-word override):

- Clean working tree + a PR/branch you're reviewing → **comment mode**.
- Dirty working tree (uncommitted changes) + no PR → **fix mode**.
- Anything else → pick the more likely one, **say which**, and move on. The
  user's wording ("fix the problems", "review my local changes") wins.

Read each shared resource as you reach the step that needs it:

- `references/change-classification.md` — important vs. routine.
- `references/net-diff-and-context.md` — net-diff/commit reasoning **and** context
  gathering; how much depends on the mode.
- `references/multi-agent-review.md` — the fan-out: discover every installed
  review lens (skills *and* commands like `/code-review`) → one subagent applies
  each → one merged findings list.
- `references/adversarial-review.md` — turning findings into good comments, and
  the solo checklist when no review skill can be loaded.
- `references/interaction-protocol.md` — the turn-by-turn session and the per-mode
  action flow (three comment options vs. propose-and-apply-a-fix).
- `references/github-submit.md` — comment mode: posting to GitHub with `gh`.
- `references/apply-fix.md` — fix mode: proposing, applying, and verifying edits.
- `references/web-presentation.md` + `scripts/render_app.py` +
  `scripts/serve_review.py` — the web UI: the `state.json` model, the toggles, the
  refresh loop, and how to serve and update it.
- `references/review-schema.md` — the per-change JSON fields (the web state is a
  superset).

## Workflow

Steps 1–5 are **identical** to `interactive-code-review` — read that skill's
references and follow them. In brief:

### 1. Detect the mode and establish scope

```bash
git fetch origin --quiet
git status --porcelain                                 # dirty tree? → leans fix mode
gh pr view --json number,url,headRefName 2>/dev/null   # a PR? → leans comment mode
```

Comment mode reviews the net diff against origin/main (committed work only):
`git diff origin/main...HEAD --stat`. Fix mode reviews the net diff **plus**
uncommitted changes as one surface: `git diff $(git merge-base origin/main HEAD)
--stat`. If the user names a PR/branch/range, use it. State mode + scope in one
line; only ask if genuinely ambiguous.

### 2. Understand the branch commit by commit — but review the net diff

`git log --oneline --no-merges origin/main..HEAD`. Read commit messages to build
*intent*, then classify against the **net** diff. Do not review intermediate
states. (Details in `references/net-diff-and-context.md`.)

### 3. Classify: important vs. bookkeeping

Per `references/change-classification.md`. Keep the important changes; collapse
bookkeeping into a one-line "skipped" summary you state once. Order the important
changes into a review queue, grouped one-reviewable-idea-per-item across files.
**No cap on queue length**; `M` is however many important changes there are.

### 4. For each change, gather context

Per `references/net-diff-and-context.md`, mode-dependent (comment mode: full four
beats for someone new to the code; fix mode: just what makes the fix safe). Quote
the minimum that makes it reviewable (5–15 lines per block), each with a real
`path:line`.

### 5. Review with the multi-agent fan-out → "what could be improved"

Per `references/multi-agent-review.md`, run the fan-out **once over the whole
change set**: discover every relevant installed review lens, spawn a parallel
subagent per lens that loads and applies it, merge into one list. De-duplicate,
rank by severity, attach each finding to the queue item it lands on tagged by its
`source` lens. File real concerns only.

### 6. Build the state and start the server

Now diverge from the terminal skill. Assemble the whole review into one
`state.json` per `references/web-presentation.md`: the `overview` (what / scope /
verdict), the `summary` with the bookkeeping `routine` list, and one entry per
queue item in `changes[]` — each with its widened `diff` and a
whitespace-ignored `diff_nows` (`git diff` and `git diff -w` for that change's
files against the base), the `briefing` beats, `context` blocks, and the merged
findings as `comments[]`. Set `current` to the first change.

Write it to a working file and start the server **once** in the background, then
give the reviewer the URL and the one-line limitation note:

```bash
python3 <skill>/scripts/serve_review.py <workdir>/state.json --port 8899 &
```

(Paths are relative to this skill's directory; pick a free port.) Tell them:
"Open http://127.0.0.1:8899 — sidebar navigates, the diff has whitespace /
split-unified / old-new toggles. Drive the review here in the terminal; the
page's compose box composes and copies your reply to paste back here."

### 7. Open with the overview, then walk one change at a time

Present the opening overview (`references/interaction-protocol.md`: what this PR
does / scope / high-level verdict) in the terminal; it is already visible in the
page's overview pane. Then, for **each** queue item in order:

1. **Advance the state** — set that change's status to `current` (previous ones
   to `reviewed` / `fixed` / `skipped`), set top-level `current` to its id, and
   rewrite `state.json`. The page follows automatically. Give the terminal
   briefing (lighter in fix mode) with a running "Change N of M".
2. **Offer the per-mode action** plus skip/custom (per the protocol):
   - **Comment mode** — three comment options as different *angles*:
     `1) request a change`, `2) ask a question`, `3) nit / praise`, `s) skip`,
     `e) your own`.
   - **Fix mode** — `1) apply this fix`, `2) a different approach` (if one
     exists), `3) leave as-is / skip`, `e) tell me how`.
3. **Stop and wait.** Grill-me pause — end the turn, let the reviewer choose. Do
   not roll ahead.
4. On their choice:
   - **Comment mode** — post to GitHub per `references/github-submit.md`, confirm
     in one line.
   - **Fix mode** — apply and verify per `references/apply-fix.md`; then
     **regenerate that change's `diff`/`diff_nows` from the now-edited tree and
     rewrite `state.json`** so the page's diff refreshes. Never advance on a
     broken tree.

   Then advance to the next change (step 7.1).

### 8. Wrap up

Mark all changes' final statuses in `state.json` one last time, then give a short
recap tuned to the mode (per the sibling skill's step 8): comment mode —
reviewed / posted (with links) / skipped + the bookkeeping line, and offer an
overall PR verdict if a PR exists; fix mode — reviewed / fixes applied (files
touched) / left as-is + bookkeeping, the verification state, and the reminder that
edits are uncommitted. Leave the server running until they're done, then stop it.

## Notes

- Keep change `id`s short and stable (`c1`, `c2`, …); the page anchors findings to
  new-file line numbers via those ids.
- One change per turn, always waiting for input before advancing. The value is a
  guided conversation, not a data dump.
- `scripts/serve_review.py` and `scripts/render_app.py` are stdlib-only and the
  page is fully offline-safe (no CDN) and theme-aware; it binds to loopback only.
- In fix mode, verification is part of the turn — an applied edit that hasn't been
  checked (build/test, or a re-read of the function) is not done, and a failed
  check blocks the next change.
