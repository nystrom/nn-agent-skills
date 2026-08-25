# Web presentation

The page is one stdlib-only script plus a JSON state file:

- `state.json` — the whole review, written once by the skill.
- `scripts/render_app.py` — bakes it into a single self-contained HTML file (all
  CSS/JS inline, no CDN, no fetch, theme-aware). It opens over `file://`.

```bash
python3 <skill>/scripts/render_app.py <workdir>/state.json -o <workdir>/review.html --open
```

`--open` shows the finished page in the reader's default browser (`open`,
`xdg-open`, or the Windows shell, falling back to Python's `webbrowser`). Where no
browser can be launched it says so on stderr and still leaves the file.

The page has **two tabs** in the top bar:

- **Overview** — the whole-change story on a full-width page: what it does, scope,
  the before/after architecture diagrams, the verdict, advantages /
  disadvantages / risks, cross-cutting concerns, and the folded bookkeeping list.
- **Changes** — three panes: the change sidebar on the left, the diff in the
  center, and the briefing, context, and findings on the right. Clicking a change
  in the sidebar switches the center and right panes.

Everything is already in the file, so tabs and navigation need no server.

## The `state.json` model

A superset of `references/review-schema.md`. Top level:

| field      | type   | purpose                                                     |
| ---------- | ------ | ----------------------------------------------------------- |
| `title`    | string | shown in the top bar and the tab title                      |
| `generated_at` | string | optional stamp shown in the top bar                     |
| `scope`    | string | e.g. `git diff origin/main...HEAD  (12 files, +340 -88)`    |
| `overview` | object | `{ what, scope_line, verdict, cross_cutting: [string], diagrams: [diagram], tradeoffs }` |
| `summary`  | object | `{ files_changed, additions, deletions, routine: [string] }` |
| `changes`  | array  | one entry per reviewable idea (below)                        |

Each `changes[]` entry:

| field       | type   | purpose                                                          |
| ----------- | ------ | ---------------------------------------------------------------- |
| `id`        | string | short, stable, unique (`c1`, `c2`, …); anchors findings           |
| `file`      | string | file or comma-listed files for the sidebar/toolbar               |
| `title`     | string | the reviewable idea in a few words                               |
| `kind`      | string | optional tag (`logic`, `interface`, …)                           |
| `diff`      | string | **only this change's hunks**, as a unified diff (`@@` headers)     |
| `diff_all`  | string | optional: every hunk in the change's files; enables "Whole file"  |
| `diff_nows` | string | optional: `diff` via `git diff -w`; enables the WS toggle          |
| `diff_all_nows` | string | optional: `diff_all` via `git diff -w`                        |
| `files`     | array  | optional `{ path, old, new }` full file text; enables Old/New file |
| `briefing`  | object | `{ what, why, uses, consumes, tested }` — markdown; omit any     |
| `context`   | array  | `{ label, path, code, collapsed }` blocks, rendered foldable      |
| `comments`  | array  | merged findings: `{ severity, line, title, body, source, suggested_fix }` |
| `diagrams`  | array  | optional before/after box-and-arrow pairs, drawn above the diff |
| `usage`     | array  | optional "the old way vs. the new way" code pairs, drawn above the diff |
| `tradeoffs` | object | optional `{ advantages, disadvantages, risks }` for this change |

`overview.diagrams` (the whole-change architecture pair), `overview.tradeoffs`,
and the three per-change fields above are specified in
`references/diagrams.md` — including **when** a diagram is worth drawing. The
renderer draws them from the spec; never put SVG or HTML in a state field.

The Overview tab renders `overview.diagrams` under **Architecture** and
`overview.tradeoffs` under **Advantages, disadvantages, risks**. A change's
`diagrams` and `usage` render in the center pane above its diff, and its
`tradeoffs` in the right pane under the briefing.

`severity` uses the shared vocabulary: `blocker`, `high`, `medium`, `low`, `nit`,
`question`, `praise`. `comments[].line` is a **new-file** line number; the page
turns it into a jump button that scrolls to and flashes that diff line, so it must
match a `+`/context line in `diff`. `source` is the review lens that produced the
finding (e.g. `code-review`, `simplify`), shown as provenance. `suggested_fix`
renders under the finding body.

Markdown support in every text field is inline only: `` `code` ``, `**bold**`,
`*italic*`, and newlines. Fenced blocks do not render — put code in `context`.

## Producing the diffs and the file text

`diff` is **this change's hunks only** — not the whole file. Two files often carry
three unrelated changes; showing all of it in every change's pane is what makes a
review unreadable. Run the widened diff over the change's files, then keep only
the hunks that belong to this queue item:

```bash
git diff -U8 <base> -- <files...>       # read this, keep this change's hunks -> diff
git diff -U8 -w <base> -- <files...>    # same selection, whitespace ignored -> diff_nows
```

Copy whole hunks, headers included (`@@ -a,b +c,d @@`) — the renderer numbers
lines from the header, so a trimmed hunk misnumbers everything under it. When one
hunk genuinely holds two changes, give the same hunk to both and let each
briefing say which lines it owns.

The full output of the same commands goes in `diff_all` / `diff_all_nows`, which
is what the **Whole file** toggle shows. Omit them and the toggle disables itself
— as it also does when `diff_all` came out identical to `diff`, since the change
then owns every hunk in the file and there is nothing more to show.

For the **Old file** / **New file** buttons, add the file text:

```bash
git show <base>:<path>   # -> files[].old   (omit for a file the change adds)
cat <path>               # -> files[].new   (omit for a file the change deletes)
```

Include the file text when a reader plausibly needs the whole file to judge the
change — a rewritten module, a new file, a change that only makes sense in
context. Skip it for a one-line edit in a 4000-line file: it inflates the page for
nothing. Either side may be omitted; the matching button disables itself. The text
is baked into the page per change, so two changes in the same file each carry
their own copy: quote it on the one change that needs it and let the other's
briefing point there.

## The toggles (all client-side)

The center toolbar drives the diff view with no server round-trip:

- **Unified / Split** — one column with dual gutters, or old|new side-by-side
  (consecutive delete/insert runs are paired; unmatched rows get a hatched blank).
- **Both / Old / New** — show both sides, only the old code (context + deletions),
  or only the new code (context + additions).
- **Diff / Old file / New file** — the diff, or the whole file as it was, or the
  whole file as it now is (both from `files`, numbered, no diff markers).
- **Whole file** — swaps this change's hunks for every hunk in the file.
- **Ignore whitespace** — swaps in the `_nows` variant of whichever diff is shown.

Every finding that carries a `line` also puts a **marker** on that line in the
diff (and in the New file view): a severity-colored chip at the head of the row.
Clicking it scrolls the right pane to the finding; the finding's own `L<n>` button
scrolls back, widening the view first when it has to — out of the old-file view,
or into the whole file when the line sits outside this change's own hunks.

The top bar also carries a light/dark toggle; the page otherwise follows the
reader's system theme.
