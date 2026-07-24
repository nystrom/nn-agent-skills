# Web presentation

The web UI is two stdlib-only scripts plus a JSON state file:

- `scripts/render_app.py` — builds the self-contained three-pane page (all CSS/JS
  inline, no CDN, theme-aware). `build_page(state=None, live=True)` returns the
  live shell; run it directly on a state file to bake a static snapshot.
- `scripts/serve_review.py` — serves that shell at `/` and the live review state
  at `/state.json`, which it **re-reads from disk on every request**.
- `state.json` — the whole review, written and rewritten by the skill.

The page loads the shell, fetches `/state.json`, renders, and **polls
`/state.json` every ~1.5s**. So the refresh contract is simple: **rewrite
`state.json` and the page catches up on its own** — no restart, no signal. That is
how the diff refreshes after an edit, and how the walkthrough advances.

## Serving and refreshing

Start once in the background, on a free loopback port:

```bash
python3 <skill>/scripts/serve_review.py <workdir>/state.json --port 8899 &
```

Then, each turn, just overwrite `<workdir>/state.json`. The server tolerates a
half-written file (it validates JSON and falls back), but prefer an atomic write
(write a temp file, then `os.replace`) when convenient.

## The `state.json` model

A superset of `references/review-schema.md`. Top level:

| field         | type   | purpose                                                        |
| ------------- | ------ | -------------------------------------------------------------- |
| `title`       | string | shown in the top bar and the tab title                         |
| `scope`       | string | e.g. `git diff origin/main...HEAD  (12 files, +340 -88)`       |
| `mode`        | string | `"comment"` or `"fix"` — shown as a pill                       |
| `current`     | string | the change `id` the page selects until the user clicks another |
| `input_hint`  | string | optional; overrides the compose-box hint line                  |
| `overview`    | object | `{ what, scope_line, verdict }` — markdown strings             |
| `summary`     | object | `{ files_changed, additions, deletions, routine: [string] }`   |
| `changes`     | array  | the review queue, one entry per reviewable idea (below)        |

Each `changes[]` entry:

| field          | type   | purpose                                                          |
| -------------- | ------ | ---------------------------------------------------------------- |
| `id`           | string | short, stable, unique (`c1`, `c2`, …); anchors findings          |
| `file`         | string | file or comma-listed files for the sidebar/toolbar               |
| `title`        | string | the reviewable idea in a few words                               |
| `kind`         | string | optional tag (`logic`, `interface`, …)                           |
| `status`       | string | `pending` \| `current` \| `reviewed` \| `fixed` \| `skipped`     |
| `diff`         | string | the widened unified diff (with `@@` hunk headers)                |
| `diff_nows`    | string | optional: the same diff via `git diff -w`; enables the WS toggle |
| `briefing`     | object | `{ what, why, uses, consumes, tested }` — markdown; omit any     |
| `context`      | array  | `{ label, path, lang, code }` blocks (as in review-schema)       |
| `comments`     | array  | merged findings: `{ severity, line, title, body, source }`       |
| `proposed_fix` | string | optional (fix mode): markdown preview of the fix                 |
| `action`       | string | optional: the offered options, mirrored into the chat pane       |

`severity` uses the shared vocabulary: `blocker`, `high`, `medium`, `low`, `nit`,
`question`, `praise`. `comments[].line` is a **new-file** line number; the page
turns it into a jump button that scrolls to and flashes that diff line, so it must
match a `+`/context line in `diff`. `source` is the review lens that produced the
finding (e.g. `code-review`, `simplify`), shown as provenance.

## Producing the two diffs

For each change, generate both diffs over that change's files against the review
base (the merge-base in fix mode, `origin/main` in comment mode):

```bash
git diff <base> -- <files...>        # -> diff
git diff -w <base> -- <files...>     # -> diff_nows (whitespace ignored)
```

`diff_nows` is optional — omit it and the "Ignore whitespace" toggle disables
itself. Keep both diffs widened enough to read in situ. After an edit in fix mode,
regenerate both from the now-edited working tree before rewriting `state.json`.

## The toggles (all client-side)

The center toolbar drives the diff view without a server round-trip:

- **Unified / Split** — one column with dual gutters, or old|new side-by-side
  (consecutive delete/insert runs are paired; unmatched rows get a hatched blank).
- **Both / Old / New** — show both sides, only the old code (context + deletions),
  or only the new code (context + additions).
- **Ignore whitespace** — swaps the diff source between `diff` and `diff_nows`.

## The compose box (the honest limitation)

The right pane's compose box does **not** reach the agent. On "Copy for terminal"
it copies the typed text to the clipboard so the reviewer can paste it into the
terminal where Claude is running — that terminal is the real review chat. Set
`input_hint` if you want to say something more specific; otherwise the default
explains the copy-to-terminal flow.

If a future setup does have a live bridge to the running agent (a Claude Code
*channel* launched with the session), the box could POST instead — but that is out
of scope for the pure skill and must not be implied to the user when it is not
wired.
