---
name: duplicate-function-unifier
description: >-
  Find duplicated functions in a JavaScript or TypeScript repository and
  propose merging them. Detects functions whose bodies are the same text once
  comments and whitespace are removed, groups them by the files they span,
  checks where a shared function can live (package dependencies, layering
  rules and docs found in the repo), checks who calls each exported name
  (in-repo, and other repos with gh search when available), and proposes
  keeping one copy with a parameter or a widened type. Refuses groups that look
  deliberate, belong to a dispatch family, have no allowed home, or have an
  unknown consumer. Exact match only, not similar functions. Reports findings
  and proposes edits; edits only when asked. Use when asked to deduplicate
  code, find copy-pasted functions, unify duplicate helpers, or consolidate
  repeated test helpers.
---

# Duplicate Function Unifier

Find functions that exist more than once with the same body, and propose one
shared copy. A wrong merge proposal breaks correct code, so this skill reports
only exact duplicates and refuses a group when the evidence is missing.

The skill reports. It writes a findings file and a short ranked summary. It
changes source files only when the user asks for the edit, and then it follows
"Transform" and "Verify".

`references/checks.md` records the check, its bounds, the refusal rules, and the
signals this skill does not use.

## Signal

`scripts/scan.mjs` runs the check. Run it from the target repository:

```bash
node <skill-dir>/scripts/scan.mjs --out findings.json
node <skill-dir>/scripts/scan.mjs --scope packages/core --scope packages/cli
node <skill-dir>/scripts/scan.mjs --gh-owner my-org --out findings.json
```

With no options the script scans the whole repository and prints the findings
JSON to stdout. Options:

| Option | Effect |
| ------ | ------ |
| `--root <dir>` | Repository root. Default: git top level of the current directory. |
| `--scope <path>` | Keep groups with a member under this path. Repeatable. A group that crosses the scope boundary is kept. |
| `--min-statements <n>` | Smallest body to compare. Default 2. |
| `--max-file-bytes <n>` | Skip larger files. Default 1048576. |
| `--gh-owner <org>` | Search this GitHub owner for callers of exported names. |
| `--out <file>` | Write the findings JSON to the file and print a ranked summary. |

Exit code 0 means no group was found, 1 means at least one group was found
(refusals count), 2 means the scan could not run.

The script needs the `typescript` package. It resolves it from the target
repository root, then from the current directory. If it is absent, the script
exits 2 and names the problem. Install `typescript` in the target repository
and run again. The script installs nothing.

It reads `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts` files
that git tracks or does not ignore (all files, if the directory is not a git
repository). It skips declaration files (`.d.ts`, `.d.mts`, `.d.cts`), symlinks, `node_modules`, `dist`, `build`,
`out`, `coverage`, `vendor`, files with a generated-code marker in the first
512 bytes, and files over the size limit. Files skipped for size or parse
errors are listed in `skipped`. A file with parse errors is not compared.

Compared units: function declarations, class and object methods, and arrow or
function expressions bound to a variable, with a block body of at least
`--min-statements` statements. Nested functions are included. The comparison
is on tokens, so comments and whitespace do not matter and string, template,
and regex text does. A line break after `return`, `throw`, `break`, `continue`, or `yield`, or
before `++` or `--`, also counts, because it changes the meaning.

## Findings file

```json
{
  "tool": "duplicate-function-unifier",
  "root": "...",
  "scope": "whole repository",
  "files_scanned": 0,
  "skipped": [],
  "conventions": {
    "workspaces": null,
    "tsconfigs": [],
    "eslintConfigs": [],
    "layeringConfigs": []
  },
  "counts": { "candidates": 0, "refused": 0, "reported": 0 },
  "findings": [
    {
      "id": "dup-1-name",
      "file": "path",
      "line": 1,
      "symbol": "name",
      "severity": "low | medium",
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
three or more, a body of six or more statements, or a group that folds other
groups. All other severities are `low`, and every refused finding is `low`.
`members` is the number of functions in the group.

## Evidence

Each reported finding states:

- **Where a shared function can live.** Inside one package, in that package.
  Across packages, in a package the others already depend on (read from their
  `package.json` `dependencies` and `peerDependencies`; `devDependencies`
  count only when every member is a test file). If no package qualifies, the group is
  refused, because a new package edge is a different decision.
- **Consumers of each exported name.** A name is exported when it carries `export`, appears in an
  `export { name }` or `export default name` statement, is a public method of
  such a class, a method of an object literal, or sits in a file that assigns to `module.exports` or
  `exports.x`. In-repo search is `git grep -w` by spelling over tracked and
  untracked files, so it also matches a different symbol with the same name. External
  search runs only with `--gh-owner` and an authenticated `gh`. The verdict is
  one of `internal-only`, `exported-no-hits`, `exported-with-hits`, or
  `unknown`. `unknown` refuses the group: no search, no proposal.
  `exported-no-hits` is evidence for a person to weigh, not proof of absence;
  dynamic imports, string lookups, and unsearched repos are invisible to it.
- **Nearby docs.** Architecture, design, and layering documents in the
  ancestor directories of each member.

## Read the repository's conventions

The script lists `conventions`: workspace globs, tsconfig files, eslint
configs, and files that look like layering rules (restricted-import rules,
dependency-cruiser, or a `layers` file). Before you choose where the survivor
goes, read the ones that apply to the members. A module may import its own
layer and the layers below. The shared function goes in the lower of two
layers, or in a new module both can import. The script does not parse layer
rules; it points to them. If the repository defines none, say so in the
report.

Also read the repository's style and review documents (for example a
contributing or style guide) for rules about shared helpers, export surfaces,
and test helpers. Follow them.

## Transform

When the user asks for the edit, make one group one change. Keep the copy in
the lowest allowed location, or in the package's test helpers when every
member is a test file. Give it a parameter for whatever each copy closed over.
Where the copies differ only in a type, widen to the type that admits both.
Delete the other copies and update their imports.

Export nothing new. A merge that publishes a name enlarges a package surface
whose consumers you cannot see.

## Refuse when

The script applies these rules and ships each refusal in the findings:

- **A comment says the copy is deliberate.** A member or its leading comment
  says "intentional", "deliberate", "keep in sync", "do not merge", or
  "duplicated on purpose".
- **No package can host the shared function.** The packages declare no
  dependency on each other.
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
  purpose (look for a migration doc, a `legacy` or `v1`/`v2` directory pair, or
  snapshot tests that must stay byte-identical).
- A group whose members sit in two layers with no allowed shared location.

## Verify

A report-only run needs no verification. After an edit, find the project's own
checks (the `scripts` in `package.json`, a CI workflow, a test runner config)
and run, in order:

1. The type check for each changed package.
2. The lint for each changed package, which enforces layering rules where the
   repository has them.
3. The tests that cover the changed files. If the changed path has no test
   file, say so in the report and do not claim coverage. Prefer placing the
   survivor in a tested module that the untested one calls.
4. A search for each deleted name, in the repo and, for exported names, with
   `gh search code`.

If a repository snapshot or golden file changes, the merge failed. Revert it
and report the group as refused.

Check machine load before a full type check or test run. When load is high,
run only the tests that cover the change and leave the rest to CI.

## Output

The script's own summary (with `--out`) lists reported findings only. Print a
summary of at most 100 words: counts, then the reported findings in
rank order (severity, then group size), each with its files and the proposed
survivor location. List refusals as one line each with the reason. Give the
path of the findings file. Say which searches ran and which did not (for
example, no `--gh-owner`, so external callers are unknown).
