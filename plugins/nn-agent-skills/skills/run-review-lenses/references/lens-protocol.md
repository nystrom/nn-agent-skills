# Review lens protocol — shared by every lens skill

Every first-class review lens in this plugin (adversarial, performance, risk,
test-coverage, dead-code, ai-slop, and any sibling that opts in) follows this
protocol.
**Domain-specific attack surface, method, and finding bar live in that lens’s
own `SKILL.md`.** This file is the shared machinery so standalone and fan-out
runs stay consistent without duplicating text into every lens.

When a lens skill is loaded, **read this file and `review-scope.md` in the same
`references/` directory** (from a lens skill directory:
`../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md`).

## Dual invocation

### A. Standalone (user invoked this lens skill directly)

1. Resolve **scope** per `review-scope.md` (`diff` default | `repo` | `paths`).
2. Apply **this lens’s domain rules** from its `SKILL.md`.
3. Return a **compact markdown report** (see Standalone output below).
4. **Do not** write `review.json`, post to GitHub, or edit the tree.

### B. Fan-out lens (loaded by `run-review-lenses` or a consumer via that skill)

1. Use the **scope the orchestrator passed** — do not re-derive or silently
   widen/narrow it.
2. Apply **this lens’s domain rules**.
3. Return **only** the structured finding list the orchestrator requested
   (see Structured output). No markdown ship-essay unless they also asked for
   a one-line headline.
4. **Do not** act (no edits, no `gh`, no extra fan-out that posts).

If the prompt says “structured findings” or names the wire format below, you
are in mode B even if the Skill tool loaded you.

## Never act

A lens **returns findings only**. No file edits, no GitHub comments, no
“I fixed it.” Capture the change you would make as `suggested_fix`. Consumers
decide whether to apply it.

## Scope

Full rules: `review-scope.md`. Summary:

| Mode | Surface |
|---|---|
| `diff` (default) | Net change set vs `origin/main` (or named base/PR/range); optional working tree |
| `repo` | Whole tree as it stands; queue by logical areas |
| `paths` | User-named paths/packages/symbols only |

Pass or honor: `mode`, `base`/range/PR, `paths`, `include_working_tree`.

## Structured output (fan-out / orchestrated)

One object per finding, field names exactly:

```
{ source, path, line, severity, title, body, suggested_fix }
```

- `source` — this lens’s skill slug (e.g. `adversarial-review`)
- `path` — file path (orchestrator routes with it)
- `line` — new-file line, or `null` for design/area-level
- `severity` — prefer `blocker` | `high` | `medium` | `low` (and `nit` /
  `question` / `praise` only if this lens’s bar allows them)
- `title` — short heading
- `body` — what is wrong and why it matters
- `suggested_fix` — smallest concrete fix (or prune/verify steps)

Also return a one-line headline: `needs-attention` or `approve`.

## Standalone output

Compact markdown:

- one-line verdict (`needs-attention` / `approve`)
- mode + scope in one line
- short summary (not a neutral recap)
- findings ranked by severity: file, line, impact, recommendation
- no `review.json` unless the user explicitly asked for that file

## Calibration (all lenses)

- Prefer one strong finding over many weak ones.
- No invented files, lines, or runtime behavior.
- If nothing material: `approve` and empty findings — that is success.
- Anchor every finding to a real path (and line when possible).
