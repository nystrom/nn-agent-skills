---
name: codex-code-review
description: >-
  Code review by the OpenAI Codex CLI. Runs `codex exec review` over the change
  set in a read-only sandbox and returns its findings in the review-lens wire
  format, so a second model family reviews the same diff. Accepts an optional
  Codex model and reasoning effort; without them, Codex uses its own configured
  default. Use when asked for a Codex review, a second opinion from Codex or
  GPT, or as a review lens under run-review-lenses.
---

# Codex Code Review

Hand the change set to the Codex CLI's built-in reviewer and translate what it
reports into review-lens findings. The value is a reviewer from a different
model family. This skill adds no review rules of its own: Codex decides what is
wrong; this skill runs it, checks the output, and normalizes it.

Read `../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md`. This lens follows them for
invocation mode, scope, and output.

## When not to run

- **You are Codex.** If this skill is loaded inside the Codex CLI, return no
  findings and the headline `not-applicable: already running in Codex`. Do not
  start Codex from Codex.
- **`codex` is not on `PATH`.** Return no findings and the headline
  `not-run: codex CLI not installed`.

Never report `approve` when Codex did not complete a review. A lens that did
not run must say so, or the merged review reads as a clean pass.

## Options

| Option | Codex flag | Default |
|---|---|---|
| `model` | `-m <model>` | none: Codex uses `model` from `~/.codex/config.toml` |
| `effort` | `-c model_reasoning_effort="<effort>"` | none: Codex uses its configured effort |

Pass a flag only when the user or orchestrator named the value. Do not choose a
model yourself, and do not name the default model from memory. To report which
model ran, read `model` and `model_reasoning_effort` from
`~/.codex/config.toml` (or `$CODEX_HOME/config.toml`); if they are absent, write
`codex default`.

## Command

Always add `--ephemeral -c sandbox_mode='"read-only"' -o "$OUT"`, where `$OUT`
is a fresh file in the scratchpad, and send stderr to a second file. Run from
the repo root.

Pick the form from the scope. `--base` and `--uncommitted` cannot be combined
with a prompt.

| Scope | Command |
|---|---|
| `diff` against a base (working tree included or not) | `codex exec review --base <base>` |
| `diff` of uncommitted work only | `codex exec review --uncommitted` |
| `diff` of one commit | `codex exec review --commit <sha>` |
| `diff` of a range, `repo`, or `paths` | `codex exec review "<instructions>"` |

`--base` reviews from the merge-base through the working tree, so uncommitted
edits are included. When the scope excludes the working tree and the tree is
dirty, use the prompt form and say "committed changes only" in it.

In the prompt form, state the surface exactly: the range, or "the whole
repository, by area", or the listed paths. Do not add review rules to the
prompt; Codex applies its own.

A review takes from about 30 seconds on a small diff to many minutes on a large
one. Run it with the Bash `timeout` at 600000 ms, or in the background for a
large change set. If it times out, report `not-run: codex review timed out` and
the size of the change set.

## Check the run

The exit code is not evidence of success: Codex exits 0 after auth errors on
its MCP servers and can exit 0 with no review. The run succeeded only when
`$OUT` exists and is non-empty. Otherwise report
`not-run: codex review failed` with the last lines of stderr. Ignore stderr
lines about MCP servers or model-list refresh when `$OUT` holds a review.

## Parse the output

`$OUT` holds a one-paragraph summary, then findings in this shape:

```
- [P1] <title> — /abs/path/to/file.py:12-14
  <body, one or more indented lines>
```

`--output-schema` has no effect in review mode, so parse this text. If `$OUT`
is non-empty but holds no `[P<n>]` lines, Codex found nothing: headline
`approve`, with its summary.

For each finding:

- `severity`: `P0` → `blocker`, `P1` → `high`, `P2` → `medium`, `P3` → `low`.
- `path`: make it relative to the repo root.
- `line`: the start of the range.
- Read the cited lines. Drop a finding whose file or line does not exist, and
  say how many you dropped.

## Output

### Structured (fan-out)

Per `lens-protocol.md`:

- `source`: `codex-code-review`
- `title`, `body`: Codex's text, unchanged
- `suggested_fix`: the fix Codex's body states; if it states none, the
  smallest fix the body implies
- `evidence`: `Inferred: Codex review (<model>, <effort>)`

Headline: `needs-attention` if any finding remains, `approve` if Codex
completed and reported none, or one of the `not-run` / `not-applicable` lines
above.

### Standalone

Compact markdown per `lens-protocol.md`, plus one line naming the model and
effort that ran and the exact `codex` command.
