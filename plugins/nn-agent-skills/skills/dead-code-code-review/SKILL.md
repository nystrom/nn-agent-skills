---
name: dead-code-code-review
description: >-
  Dead-code code review of a change set. Finds unreachable functions, unused
  exports, orphaned modules, stale flags, commented-out blocks, and dead
  branches introduced or left behind by the change, and proposes removal.
  Treats public/exported API conservatively and searches other repos (e.g. gh
  search) for cross-repo callers before calling something dead. Use when asked
  to find dead code, prune unused symbols, or as a review lens under
  run-review-lenses.
---

# Dead Code Code Review

Find code that nothing needs anymore — and propose deleting it. Prefer
evidence of zero callers over vibes. **Public and exported surfaces are not
dead by default**: anything another package, repo, binary, or dynamic loader
might call stays until you have a reason to believe it is unused, or you
state the residual risk and keep severity honest.

This is a **review lens**. It returns findings and never acts — no file
edits, no mass deletes, no GitHub posts. When another skill (typically
`run-review-lenses`) loaded you and asked for a structured finding list, obey
that wire format and stop there. When invoked on your own, review the change
set and report as below.

## Scope

- Prefer the net diff against `origin/main` (or the base the caller named).
- Include the working tree when the caller said to, or when pointed at local
  uncommitted work.
- Start from symbols, modules, flags, and branches the change **adds, moves,
  stops calling, or leaves orphaned** — then widen to obvious dead neighbors
  the change makes visible.
- Read enough package/module boundary metadata (`export`, `pub`, visibility,
  package APIs, library entrypoints, plugin registries) to know what is
  internal versus public.

## What counts as dead

Prioritize:

- **Unreachable functions / methods / types** after the change — no remaining
  in-repo callers, not part of a required interface implementation, not
  referenced from generated tables or registries.
- **Unused imports, locals, private helpers** left behind by the change.
- **Orphaned files/modules** nothing imports.
- **Dead branches** — `if (false)`, feature flags always off with no write
  path, `TODO`-removed call sites leaving an unused implementation.
- **Commented-out code blocks** the change adds or leaves next to live code.
- **Stale re-exports** — barrels that still export a symbol with no consumers.
- **Test-only production symbols** — production helpers only referenced from
  tests after the product path moved on (propose delete or move to test
  support — say which).

Do **not** flag as dead without extra care:

- **Public / exported / `pub` / package-visible API** until cross-repo and
  dynamic use is considered (see below).
- Symbols referenced by **name strings**: DI containers, routers, reflection,
  serialization, RPC schemas, plugin manifests, CI configs, IaC, dashboards.
- Overrides implementing an interface/trait/protocol still required by the
  type.
- Code behind a **flag that is still toggled** in config or remote defaults.
- Vendored / generated sources unless the generator input is also gone.

## Cross-repo and external callers (required)

Dead-code claims fail open for anything that might be used outside this
checkout. Before proposing removal of a symbol that is (or was made) visible
beyond the crate/package/private module:

1. **Classify visibility**
   - *Internal* — file-private, module-private, package-private with no
     escape hatch: in-repo `rg`/`git grep` is usually enough.
   - *Public-in-repo* — used by other packages in a monorepo: search the whole
     workspace, not one package.
   - *Library / exported API* — `export`, `pub use`, published package entry
     points, stable HTTP/RPC paths, CLI commands, shared protos: assume
     external callers until proven otherwise.

2. **Search beyond the repo when the surface is public**
   Depending on what is under review, look for callers in other repos the
   org actually owns or depends on:
   - `gh search code 'SymbolName' --owner <org>` (and variants for paths,
     language, qualifiers)
   - `gh search code 'package.Symbol' --owner <org>` / import-path strings
   - org-wide search for route paths, event names, proto service methods,
     CLI flag strings
   - sibling checkouts under the workspace if present locally
   If `gh` is unavailable, unauthenticated, or the org is unknown, **do not
   pretend you searched** — say so and treat exported API as **potentially
   callable**.

3. **Conservative default**
   - Exported/public → default finding is *not* “delete”, or at most a `low`
     “candidate; verify external callers” note unless search shows zero hits
     *and* the API is clearly non-stable (e.g. brand-new unexported-then-
     accidentally-exported helper in the same PR).
   - Internal with zero in-repo callers after thorough search → propose
     remove at normal severity.
   - Dynamic/unknown dispatch → require a string/registry search; if you
     cannot rule it out, do not call it dead.

4. **What is being reviewed drives the search**
   - App binary / private service: favor in-repo + deploy configs.
   - Shared library / SDK / proto package: **always** attempt org-wide or
     multi-repo search before delete proposals.
   - Monorepo package: search all workspace members and any documented
     external consumers.

## Method

1. From the net diff, list symbols and modules that lost callers, became
   unused, or were introduced without references.
2. For each candidate, determine visibility (internal vs exported).
3. Search callers:
   - in-repo: `rg`/`git grep` for definitions, imports, and string names
   - monorepo/workspace roots
   - configs, manifests, generated code
   - **other repos via `gh search`** (or local siblings) when public
4. Only then decide: remove / keep / “candidate, needs external verification”.
5. `suggested_fix` should be the delete (or narrow visibility) edit — smallest
   safe removal, including cleaning imports and re-exports. If external risk
   remains, say what to verify before deleting.

## Finding bar

A remove finding must state:

1. What is dead (symbol/file/branch) and where it lives.
2. How you established no needed callers (searches run, visibility class).
3. What residual risk remains (especially external/public).
4. The concrete removal (and follow-up cleanups).

If you only *suspect* dead public API, either skip or file `low` with
verification steps — never `blocker` delete on an exported symbol you did
not search for externally.

## Output

### When a caller requested structured findings

```
{ source, path, line, severity, title, body, suggested_fix }
```

- `source` — `dead-code-code-review`
- `path` — file of the dead symbol (or its public re-export)
- `line` — definition line, or `null` for whole-file orphans
- `severity` — `blocker` unused only when it is harmful (security-sensitive
  dead path, broken leftover); usually `high`/`medium` for clear internal
  dead code; `low` for public candidates pending external verification
- `title` — short heading (`Remove …` / `Verify external callers before …`)
- `body` — why it is dead, searches performed (include `gh search …` when
  used, or “gh unavailable; treated exported as potentially callable”),
  residual risk
- `suggested_fix` — delete or un-export steps; if not safe yet, the
  verification command(s) and what result would unlock removal

One-line headline: `needs-attention` or `approve`.

### When invoked standalone

Compact markdown: verdict, summary of dead candidates vs kept-public, findings
with evidence of caller search and prune proposal.

## Final check

Each finding must be about unneeded code, backed by a caller story that
respects visibility and other repos, and paired with a removal or a clear
“do not remove until …” verification — never “delete this export” on faith.
