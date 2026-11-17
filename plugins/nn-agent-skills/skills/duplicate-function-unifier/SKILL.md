---
name: duplicate-function-unifier
description: >-
  Find duplicated functions in a codebase in any programming language and
  propose merging them. A script finds functions whose bodies are the same
  token sequence once comments and whitespace are removed; the model then reads
  the code to confirm each finding and to look for duplicates the script cannot
  see (renamed locals, reordered statements, other languages). It checks where
  a shared function can live (package manifests, layering rules, docs) and who
  calls each name (language server references when available, else text
  search, and other repos with gh search when available). Each finding carries
  a concrete proposed change and the check that verifies it. Refuses groups
  that look deliberate, belong to a dispatch family, have no allowed home, or
  have an unknown consumer. Reports only: never edits files, commits, or posts.
  Use when asked to deduplicate code, find copy-pasted functions, unify
  duplicate helpers, or consolidate repeated test helpers.
---

# Duplicate Function Unifier

Find functions that exist more than once with the same body, and propose one
shared copy. A wrong merge proposal breaks correct code, so the script reports
only exact duplicates and refuses a group when the evidence is missing. The
script is a lead generator. You confirm or overturn each of its verdicts by
reading code, and you look for duplicates it cannot see ("Judgment pass").

## Contract

The skill reports. It never edits source files, never commits, and never opens
or comments on pull requests or issues. Its output is findings. Each reported
finding has a proposed change: what to change, where, and the check that would
verify it, written as text or a patch snippet in the report. The user, or a
separate task, applies it. The script writes no file except the findings file
named by `--out`; give `--out` a path outside the repository under review (for
example under the system temp directory).

`references/checks.md` records the check, its bounds, the refusal rules, and
what the script proves. `references/languages.md` holds the per-language
facts and says which are verified by tests and which are guidance.

## Evidence sources

Prefer a language server over text search for semantic facts: references and
callers of a name, definitions, document and workspace symbols (function
boundaries), call hierarchy, overrides, types, and diagnostics.

1. Check whether a language server is configured or startable for each
   language in the scan (`references/languages.md` lists common servers).
   Use it through the tools of your environment: find-references, document
   symbols, call hierarchy.
2. If none exists, fall back to `rg` or `git grep` plus reading the code.
3. State in each finding which source supplied its evidence, in
   `evidence_source`: `lsp` (language server), `text` (search or the script's
   token match), `read` (you read the code). A finding may list several. The
   script writes `["text"]`. Add `lsp` or `read` when you verify with them.
   Never write `lsp` for evidence you did not get from a server.

A reference count from text search matches spelling, so it overcounts a name
that other symbols share and misses dynamic use. Say so when you rely on it.

## Signal

`scripts/scan.mjs` runs the check. It needs Node 20 or later and no packages.
Run it from the target repository:

```bash
node <skill-dir>/scripts/scan.mjs --out "$TMPDIR/findings.json"
node <skill-dir>/scripts/scan.mjs --scope src/core --scope src/cli --out "$TMPDIR/findings.json"
node <skill-dir>/scripts/scan.mjs --gh-owner my-org --out "$TMPDIR/findings.json"
```

With no `--out` the script prints the findings JSON to stdout.

| Option | Effect |
| ------ | ------ |
| `--root <dir>` | Repository root. Default: git top level of the current directory. |
| `--scope <path>` | Keep groups with a member under this path. Repeatable. A group that crosses the scope boundary is kept. |
| `--min-lines <n>` | Smallest body to compare, in logical lines. Default 2. |
| `--max-file-bytes <n>` | Skip larger files. Default 1048576. |
| `--gh-owner <org>` | Search this GitHub owner for callers of exported names. |
| `--out <file>` | Write the findings JSON to the file and print a ranked summary. |

Exit code 0 means no group was found, 1 means at least one group was found
(refusals count), 2 means the scan could not run.

The script reads files that git tracks or does not ignore (all files outside
git). It lexes the languages in `references/languages.md`, finds function
boundaries by a text heuristic for each language family (braces, indentation,
or an `end` keyword), and compares body tokens within one language. It skips
symlinks, build and vendor directories, generated files (a marker in the first
512 bytes), oversized files, and files whose brackets do not balance (the
usual sign of a lexing error). `skipped` lists oversized and unbalanced files.
`unscanned` counts files of source languages it does not read. `languages`
says, per language, whether the script's tests exercise it (`verified`).

If a language server offers document symbols for a language, use them to check
the boundaries the script chose. The script does not call a language server.

## Findings file

```json
{
  "tool": "duplicate-function-unifier",
  "root": "...",
  "scope": "whole repository",
  "files_scanned": 0,
  "languages": { "py": { "name": "Python", "files": 0, "verified": true } },
  "unscanned": {},
  "skipped": [],
  "conventions": { "manifests": [], "workspaces": [], "layeringConfigs": [] },
  "counts": { "candidates": 0, "refused": 0, "reported": 0 },
  "findings": [
    {
      "id": "dup-1-name",
      "source": "script",
      "evidence_source": ["text"],
      "file": "path",
      "line": 1,
      "symbol": "name",
      "language": "Python",
      "severity": "low | medium",
      "members": 2,
      "signal": "which functions share a body",
      "evidence": "home, consumers, nearby docs",
      "proposal": "the merge, or none",
      "refused": false,
      "reason": "present when refused"
    }
  ]
}
```

`candidates` equals `refused` plus `reported`. A refused finding has
`proposal: "none"` and carries its reason. Severity is `medium` for a group of
three or more, a body of six or more logical lines, or a group that folds other
groups. All other severities are `low`, and every refused finding is `low`.
`members` is the number of functions in the group.

Every finding the script writes has `source: "script"`. Findings you add have
`source: "reviewer"`, and the `verdict` field you set goes on script findings
(see "Judgment pass"). The script writes neither.

## What the script cannot see

Each item is a place to look yourself.

- **Matching.** It compares token sequences of named functions. It misses a
  renamed local, reordered statements, the same logic in a different shape
  (loop against a map call, early return against nested conditions), anonymous
  functions and callbacks, expression-bodied functions, and bodies below
  `--min-lines`.
- **Boundaries.** They come from a text heuristic. It can miss a function
  whose header the heuristic does not recognize, or mis-cut one in unusual
  syntax (macros, preprocessor blocks, C++ constructor initializer lists,
  one-line definitions).
- **Languages.** It reads only the languages in `references/languages.md`.
  Other languages, templates, embedded code, and notebooks are not compared.
  Languages marked unverified use the same rule as a verified one, and their
  results are leads.
- **Hosts.** It reads the manifest formats listed in
  `references/languages.md`. It does not read layering rules, path aliases,
  workspace configuration, or build graphs, and it cannot tell whether the
  shared module is safe to import from every member.
- **Consumers.** It matches spelling in git-visible files, and `gh search
  code` when asked. It does not follow re-exports, dynamic imports, string
  lookups, reflection, or generated callers. It decides visibility from simple
  language rules.
- **Intent.** It sees a comment marker only. A migration, a compatibility
  copy, or a copy that is allowed to diverge may leave no marker.
- **Folding and nesting.** They use file sets and source spans. They do not
  know whether the outer group is the better merge.

## Evidence in each finding

Each reported finding states:

- **Where a shared function can live.** Inside one package, in that package.
  Across packages, in a package the others already depend on (read from their
  manifests; a dev dependency counts only when every member is a test file).
  If no package qualifies, or a manifest format is unreadable, the group is
  refused, because a new package edge is a different decision.
- **Consumers of each name that is not internal.** Visibility comes from the
  language rule in `references/languages.md`. In-repo search is `git grep -ow`
  over tracked and untracked files. External search runs only with
  `--gh-owner` and an authenticated `gh`. The verdict is one of
  `internal-only`, `exported-no-hits`, `exported-with-hits`, or `unknown`.
  `unknown` refuses the group: no search, no proposal. `exported-no-hits` is
  evidence for a person to weigh, not proof of absence.
- **Nearby docs.** Architecture, design, and layering documents in the
  ancestor directories of each member.

## Read the repository's conventions

The script lists `conventions`: manifests, workspace files, and files that look
like layering rules (restricted-import lint rules, dependency-cruiser,
import-linter, depguard, cargo-deny). Before you choose where the survivor goes,
read the ones that apply to the members. A module may import its own layer and
the layers below. The shared function goes in the lower of two layers, or in a
new module both can import. The script does not parse layer rules; it points to
them. If the repository defines none, say so in the report.

Also read the repository's style and review documents for rules about shared
helpers, export surfaces, and test helpers. Follow them in the proposal.

## Judgment pass

Do this after the script, before any proposal reaches the user.

1. **Confirm or overturn each script finding and each refusal.** Read the
   code of every member and its callers (with a language server's references
   when you have one). For a reported group, check that the copies mean the
   same thing in their contexts: same types, same closed-over state, same
   error handling, same callers' expectations. For a refusal, check whether
   the reason is true; a wrong refusal hides a real duplicate. Mark each
   finding `confirmed`, `downgraded`, or `dropped`, with the reason in one
   sentence. A script verdict alone never justifies a proposal.
2. **Survey the same defect class where the script cannot look.** Read the
   files in `skipped`, files of languages in `unscanned` or not in the
   language table, the neighborhood of each finding (siblings in the same
   directory and files that import the members), and code the matching misses
   (see above). Report each duplicate you find with `source: "reviewer"`, the
   files and lines, the evidence you read, and a proposal or a refusal with its
   reason. Do not report a resemblance you did not read both sides of.
3. **Keep the labels.** Script findings keep `source: "script"`. Write your
   verdicts into the findings file as a `verdict` field on each script
   finding, and add your own findings with the same fields and
   `source: "reviewer"`. A reviewer finding needs no verdict, because you read
   it before you wrote it. Set `evidence_source` truthfully on every finding.

## The proposed change

For each reported finding, write in the report:

- **What to change.** Keep one copy, in the lowest allowed location, or in the
  package's test helpers when every member is a test file. Give it a parameter
  for whatever each copy closed over. Where the copies differ only in a type,
  widen to the type that admits both. Delete the other copies and update their
  imports and callers. Export nothing new: a merge that publishes a name
  enlarges a surface whose consumers you cannot see.
- **Where.** Files, lines, and the survivor's location.
- **The check that would verify it.** Find the project's own checks (manifest
  scripts, CI workflow, test runner config) and name them: the type check or
  build of each changed package, the lint that enforces layering where the
  repository has it, and the tests that cover the changed files. If a changed
  path has no test file, say so and do not claim coverage; prefer a survivor
  in a tested module that the untested one calls. Include a search for each
  deleted name (language server references, else `git grep`, and `gh search
  code` for exported names). If a snapshot or golden file would change, the
  merge is wrong; say so.
- **A patch snippet** when it makes the change clearer.

You do not apply the change.

## Refuse when

The script applies these rules and ships each refusal in the findings:

- **A comment says the copy is deliberate.** A comment before or inside a
  member says "intentional", "deliberate", "keep in sync", "do not merge", or
  "duplicated on purpose".
- **No package can host the shared function.** The packages declare no
  dependency on each other, or their manifests are unreadable.
- **The members are in one file, their signatures differ, and no two share a
  name.** The bodies are per-type entry points of a dispatch family. A merge
  replaces per-type signatures with a type parameter.
- **Every member nests inside members of one larger group that is itself
  reportable.** The outer group covers it.
- **Another group over the same files already carries it.** Many identical
  pairs between two files are one duplication and one decision. The first
  group that no other rule refused is reported and the others are refused with
  the group they folded into.
- **The consumer verdict is `unknown`.**

You apply these rules by judgment, because the script cannot see them:

- A migration in progress, where the repository keeps two implementations on
  purpose (look for a migration doc, a `legacy` and `current` directory pair,
  or snapshot tests that must stay byte-identical).
- A group whose members sit in two layers with no allowed shared location.

## Output

The script's own summary (with `--out`) lists reported findings only. Print a
summary of at most 120 words: counts, then the findings in rank order
(severity, then group size), each tagged `[script]` or `[reviewer]`, with its
files, the proposed survivor location, its evidence source, and, for a script
finding, your verdict (`confirmed`, `downgraded`, `dropped`). List refusals as
one line each with the reason, and say which you overturned. Give the path of
the findings file. Say which searches ran and which did not (for example, no
language server, no `--gh-owner` so external callers are unknown). Say which
languages were scanned and which were not, and whether each is verified.
