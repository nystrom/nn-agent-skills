# Review scope — diff, whole repo, or user-specified

Every review skill in this plugin accepts the same three **scope modes**. A
caller (user or consumer skill) may set them explicitly; otherwise derive them
as below. Record the resolved mode in `scope` / `base` (and in any standalone
report headline) so the reader knows what was examined.

## Modes

### `diff` (default)

Review a **change set** — the net effect of a branch, PR, range, or dirty
tree — not the whole history of how it got there.

- Default base: `origin/main` (or `origin/master` if that is the default
  branch). A caller may name another base, PR, branch, or `git` range.
- Net surface:
  ```bash
  git fetch origin --quiet
  git diff origin/main...HEAD --stat          # three-dot = merge-base → HEAD
  ```
- When `include_working_tree` is set (or a dirty tree and no caller forbade
  it), extend through the working tree:
  ```bash
  git diff $(git merge-base origin/main HEAD) --stat
  ```
- Walk commits only for **intent** (`git log origin/main..HEAD`); do not review
  intermediate states a later commit undid. Details:
  `references/net-diff-and-context.md`.

### `repo` (whole repository)

Review the **tree as it stands** — no branch diff required. Use when the user
asks to “review the whole repo,” “audit this codebase,” or names no change
set and clearly wants a full pass.

- There is no net diff. `base` is the current HEAD (or the ref they named).
- Build the queue from **logical areas** (packages, modules, top-level
  directories, or high-churn subsystems) — one queue item per coherent area —
  not from hunks. Prefer the project’s natural boundaries (`src/`, packages
  in a monorepo, crates, apps).
- `changes[].diff` may be empty or a short representative excerpt; findings
  still carry `path` / `line` against the current files.
- Commit history is optional context, not the primary story. Intent is “audit
  the current code.”
- Cap depth with judgment: a monorepo need not enumerate every leaf file.
  Cover the production surface the user cares about; say what you skipped.

### `paths` (user-specified)

Review only what the user named: paths, globs, packages, symbols, or a
directory.

```bash
# examples — pick what matches the request
git diff origin/main...HEAD -- path/to/dir globs...
rg -n 'SymbolName' path/to/dir
ls path/to/dir
```

- If a git range/PR is also in play, intersect: **named paths within that
  diff**. If not, review those paths **as they exist on the tree** (like a
  focused `repo` review).
- Queue items group by logical change or by path cluster inside the named
  set — never invent findings outside it unless a caller/callee outside is
  required context (cite it as context, not as in-scope surface).

## Resolving the mode

1. **Caller wins.** If a consumer or the user already set `mode` /
   `scope_mode` (`diff` | `repo` | `paths`) and any paths/base, use them.
2. Else if the user named paths, packages, or “only `foo/`” → `paths`.
3. Else if the user asked for the whole repo / full audit / no change set →
   `repo`.
4. Else → `diff` (PR, branch, “review this”, dirty tree, bare default).

State the resolved mode in one line before reviewing. Only ask when two
readings are genuinely plausible and would change the surface a lot.

## Inputs every orchestrator accepts

| Input | Meaning | Default |
|---|---|---|
| `mode` | `diff` \| `repo` \| `paths` | derived |
| `base` / range / PR | git base for `diff` | `origin/main` |
| `paths` | pathspecs for `paths` mode | — |
| `include_working_tree` | fold dirty files into `diff` | derived from dirty tree when unset |
| `lenses` | optional allow-list of lens names (skills or commands) | all discovered applicable lenses |
| `caller` | consumer name, or `none` | `none` |
| `briefing_depth` | `full` \| `light` | `full` |

## Lenses and scope

When spawning a lens (or running one standalone), pass the **same resolved
scope**: mode, base/range, pathspecs, and whether the working tree is
included. A lens must not silently widen to the whole monorepo when the
caller asked for `paths`, nor silently narrow a `repo` audit to one package.

Standalone lens runs use this same resolution; they just present findings in
their own markdown form instead of writing `review.json`.
