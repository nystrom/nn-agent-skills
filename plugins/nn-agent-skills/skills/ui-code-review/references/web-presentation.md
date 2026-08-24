# Web presentation

The page is one stdlib-only script plus a JSON state file:

- `state.json` — the whole review, written once by the skill.
- `scripts/render_app.py` — bakes it into a single self-contained HTML file (all
  CSS/JS inline, no CDN, no fetch, theme-aware). It opens over `file://`.

```bash
python3 <skill>/scripts/render_app.py <workdir>/state.json -o <workdir>/review.html
```

The page has a full-width **overview band** at the top (what the change does,
scope, verdict, cross-cutting concerns, and the folded bookkeeping list), and
below it three panes: the change sidebar on the left, the diff in the center, and
the briefing, context, and findings on the right. Clicking a change in the sidebar
switches the two right-hand panes; everything is already in the file, so
navigation needs no server.

## The `state.json` model

A superset of `references/review-schema.md`. Top level:

| field      | type   | purpose                                                     |
| ---------- | ------ | ----------------------------------------------------------- |
| `title`    | string | shown in the top bar and the tab title                      |
| `generated_at` | string | optional stamp shown in the top bar                     |
| `scope`    | string | e.g. `git diff origin/main...HEAD  (12 files, +340 -88)`    |
| `overview` | object | `{ what, scope_line, verdict, cross_cutting: [string] }`     |
| `summary`  | object | `{ files_changed, additions, deletions, routine: [string] }` |
| `changes`  | array  | one entry per reviewable idea (below)                        |

Each `changes[]` entry:

| field       | type   | purpose                                                          |
| ----------- | ------ | ---------------------------------------------------------------- |
| `id`        | string | short, stable, unique (`c1`, `c2`, …); anchors findings           |
| `file`      | string | file or comma-listed files for the sidebar/toolbar               |
| `title`     | string | the reviewable idea in a few words                               |
| `kind`      | string | optional tag (`logic`, `interface`, …)                           |
| `diff`      | string | the widened unified diff (with `@@` hunk headers)                 |
| `diff_nows` | string | optional: the same diff via `git diff -w`; enables the WS toggle |
| `briefing`  | object | `{ what, why, uses, consumes, tested }` — markdown; omit any     |
| `context`   | array  | `{ label, path, code, collapsed }` blocks, rendered foldable      |
| `comments`  | array  | merged findings: `{ severity, line, title, body, source, suggested_fix }` |

`severity` uses the shared vocabulary: `blocker`, `high`, `medium`, `low`, `nit`,
`question`, `praise`. `comments[].line` is a **new-file** line number; the page
turns it into a jump button that scrolls to and flashes that diff line, so it must
match a `+`/context line in `diff`. `source` is the review lens that produced the
finding (e.g. `code-review`, `simplify`), shown as provenance. `suggested_fix`
renders under the finding body.

Markdown support in every text field is inline only: `` `code` ``, `**bold**`,
`*italic*`, and newlines. Fenced blocks do not render — put code in `context`.

## Producing the two diffs

For each change, generate both diffs over that change's files against the review
base:

```bash
git diff <base> -- <files...>        # -> diff
git diff -w <base> -- <files...>     # -> diff_nows (whitespace ignored)
```

`diff_nows` is optional — omit it and the "Ignore whitespace" toggle disables
itself. Keep both diffs widened enough to read in situ (`git diff -U<n>`).

## The toggles (all client-side)

The center toolbar drives the diff view with no server round-trip:

- **Unified / Split** — one column with dual gutters, or old|new side-by-side
  (consecutive delete/insert runs are paired; unmatched rows get a hatched blank).
- **Both / Old / New** — show both sides, only the old code (context + deletions),
  or only the new code (context + additions).
- **Ignore whitespace** — swaps the diff source between `diff` and `diff_nows`.

The top bar also carries a light/dark toggle; the page otherwise follows the
reader's system theme.
