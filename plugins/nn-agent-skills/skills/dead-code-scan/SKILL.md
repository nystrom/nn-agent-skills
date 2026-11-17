---
name: dead-code-scan
description: >-
  Scan a JavaScript or TypeScript repository for dead exports. Finds exported
  declarations whose name occurs nowhere else in the repository, and named
  re-exports in a nested barrel that only the barrel and its source file name.
  Checks each candidate against the package manifests (is it published) and
  against other repositories (gh search code), and refuses to call a symbol
  dead when it cannot show that nothing outside the repository uses it. Writes
  a findings JSON file and a short ranked summary, and proposes deletions.
  Edits only when asked. Use when asked to find unused exports, prune dead
  code across a repository, or clean up orphaned barrel re-exports. To review
  the dead code in one diff, use dead-code-code-review instead.
---

# Dead Code Scan

The scan reports exported symbols that nothing in the repository names again.
It does not decide that a symbol is dead. It decides whether the repository
can show that no outside code uses the symbol, and it reports only the symbols
that pass. Every other candidate is recorded as a refusal with its reason.

`scripts/scan.mjs` does the scan. Run it from inside the target repository:

```bash
node <skill-dir>/scripts/scan.mjs --out dead-code-scan.json
```

Do not compute candidates by hand. `references/checks.md` lists the checks,
what each can and cannot see, and the refusal rules.

## Requirements

- Node 20 or later.
- The `typescript` package, resolvable from the repository root. The script
  exits with status 2 and a message when it is absent. Install the
  repository's dependencies first.
- A git repository. File discovery uses `git ls-files`, so ignored files
  (`node_modules`, build output, nested worktrees) are not read.
- Optional: `gh`, authenticated, for the cross-repository search.

## Checks

| Check | Fires on |
| ----- | -------- |
| `dead-export` | An exported top-level declaration whose identifier occurs once in the whole repository. |
| `dead-barrel-reexport` | A named re-export in an `index` file where only that file and the module it re-exports from name the symbol. |

Candidates come from the TypeScript syntactic parser. References are counted
by tokenizing every source, config, data, and doc file. Names in comments and
strings count as references, so the scan over-counts references and
under-reports dead code.

The scan does not cover:

- Non-exported symbols. `noUnusedLocals` in tsconfig and the
  `no-unused-vars` rules of ESLint report them. Check that the repository
  enables one of them before relying on it.
- Unreachable code inside a function, unused parameters, and files nothing
  imports (the sum of the findings for the symbols in the file).
- Unused dependencies in `package.json`, and dead tests.

## Procedure

1. Read the repository's conventions before the run: workspace layout, which
   packages are published, the `exports` maps and how `dist` is built from
   `src` (the scan maps them by name only), tsconfig, ESLint config, and docs
   next to code. Look for lists of symbols that are unreferenced on
   purpose (coverage exemptions, deprecation tables, plugin registries) and
   pass each name with `--keep`.
2. Check machine load before a large scan.
3. Run the script. Use `--scope <path>` to limit the declaration scan to a
   subtree. The reference index always covers the whole repository.
4. Read the JSON. Report the reported findings first, ranked by severity, then
   the refusal counts by category. Keep the summary short.
5. Propose the edit for each reported finding. Edit files only when the user
   asks. Then make one deletion per commit, run the repository's type check,
   lint, and tests, and keep the change only if they pass. Those checks do not
   see dynamic lookup or consumers in other repositories, so also read the
   finding's evidence before each deletion.

## Verdicts

Each candidate gets one verdict. Only `internal-only` can be reported.

| Verdict | Meaning |
| ------- | ------- |
| `internal-only` | The manifests do not publish the file, and no other repository of the searched GitHub owner names the symbol (or `--no-external` skipped that search). Repositories under other owners are not searched. |
| `published` | The package has no `exports` map, or an entry point reaches the file by re-exports. Refused. |
| `exported-with-hits` | `gh search code` found another repository naming the symbol. Refused. |
| `unknown` | The surface or the search could not be determined. Refused. |

`unknown` is a refusal. It covers: no `package.json` owns the file, a
manifest entry has no matching source file, an entry point re-exports
through an alias or sibling package the scan cannot follow, or a `package.json`
is not valid JSON (the published surface is then not known), `gh` is missing or not authenticated, the GitHub owner is unknown (pass
`--org`), a search failed after retries or returned a full page of rows from
this repository only, and the `--max-external` limit was reached.

Cross-repository search runs once per distinct symbol that the manifests leave
internal. GitHub rate-limits code search, so the script waits `--pace-ms`
between searches and retries a failed search twice. A large scan takes
minutes. Pass `--no-external` only when the user states that the repository
has no consumers elsewhere, and say so in the summary.

## Refusals

A candidate with verdict `internal-only` is still refused when:

- The caller listed the name with `--keep`.
- The name starts with `_`.
- The declaration is not a plain value, so deleting it may remove a side
  effect. This covers a call or `new` anywhere in the initializer, a class with
  decorators or static code, an enum with computed members, and a `const`
  statement with several declarators where any initializer is not plain.
- The file is under a test, fixture, sample, or example directory.
- The directory holds a `README.md`, `DESIGN.md`, or `ARCHITECTURE.md`. A
  symbol that completes a documented set is not dead because nothing uses it
  yet.

Default exports are never candidates. Names reached only by dynamic dispatch
(reflection, DI containers, string-keyed registries) appear in the reference
index when the string occurs in a scanned file. Search for the dispatch
mechanism before acting on a finding in a repository that has one.

## Output

The JSON document has `tool`, `scope`, `generated_at`, `counts`
(`candidates`, `reported`, `refused`), and `findings`. Each finding has:

| Field | Value |
| ----- | ----- |
| `id` | `dc-N` |
| `severity` | `low` for `dead-export`, `nit` for `dead-barrel-reexport`, `question` for a refusal |
| `check`, `file`, `line`, `symbol` | The candidate |
| `verdict` | One of the four verdicts |
| `evidence` | The verdict, the reason, the files naming the symbol, and any hits in other repositories |
| `proposal` | The edit, or `None` for a refusal |
| `refused`, `category`, `reason` | Present for refusals. `category` is the verdict or the local rule. |

The script writes a summary of the same data to stderr. Exit status: 0 when no
finding is reportable (refusals alone exit 0), 1 when at least one is, 2 when
the scan could not run.

## Final check

Each reported symbol needs a visibility verdict and a reason for it. A scan
that ran without `gh` and without `--no-external` reports nothing. Say that
outright in the summary instead of calling the repository clean.
