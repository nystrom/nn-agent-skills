# Check catalog

One entry per check in `scripts/scan.mjs`, with the rule it applies, what it can
see, and why it stops where it does. A deletion tool that fires on a guess asks
for working code to be deleted, so each bound below errs toward refusal.

## `dead-export`

An exported top-level declaration whose name occurs exactly once in the
repository, which is its own declaration.

- Declarations: functions, classes, interfaces, type aliases, enums, and
  `const`/`let`/`var` with identifier names. `declare` statements and default
  exports are skipped: a default export is imported under any name.
- Method: the TypeScript syntactic parser reads the top-level statements. A
  regular expression over `export` lines misreads overload sets and
  multi-declarator variable statements.
- Bound: the whole repository, not only other files. A name used in its own
  file occurs twice and is not a candidate. An interface named by a union in the
  same file is the case this rule exists for: the union is what leaves the
  package, and deleting a member deletes part of a live type. Counting only
  references outside the declaring file would report those members and
  same-file helpers.
- Bound: identifiers are counted by a tokenizer, so a name in a comment or a
  string counts as a reference. This hides dead symbols and never proposes a live
  one.
- Bound: the reference index reads `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
  `.mjs`, `.cjs`, `.json`, `.md`, `.mdx`, `.yml`, `.yaml`, `.html`, `.vue`,
  `.svelte`, `.hbs`, `.toml`, `.txt`, `.graphql`, `.proto`, and `.sh` files that
  git lists as tracked or untracked and not ignored. Ignored paths (dependencies,
  build output, nested worktrees) stay out, because stale copies of the
  repository would make every symbol look live. Symlinks are skipped. A file the
  scan cannot read stops the run, because a missing file lowers counts.
- Bound: declaration files exclude `.d.ts`, `*.test.*`, `*.spec.*`,
  `__tests__`, generated directories (`node_modules`, `dist`, `build`, `out`,
  `coverage`, `.next`), minified bundles, and files over 2 MB. Excluding a
  declaration file removes candidates and never adds one.

## `dead-barrel-reexport`

A named re-export in a file named `index.*`, where the only two files naming the
symbol are the barrel and the module the re-export resolves to.

- Why it is separate: such a name occurs twice, so `dead-export` never sees it.
  The fix differs and is smaller: delete the re-export and keep the declaration.
- Bound: the other file must be the module the specifier resolves to. A consumer
  that imports the name through the barrel adds a third occurrence, and a
  different second file means someone else names it.
- Bound: named re-exports without an alias. `export * from` carries every name
  and says nothing about which of them anyone wants.
- A barrel that a published entry point reaches is a candidate with verdict
  `published`, and is refused.

## Visibility verdicts

Every candidate gets a verdict from the package manifests, and then from a
cross-repository search when the manifests leave it internal.

Manifest rules, per owning package (nearest `package.json`):

| Package | Verdict for a file in it |
| ------- | ------------------------ |
| No `package.json` above the file | `unknown` |
| `"private": true` | `internal-only` |
| No `exports` map | `published`: any file can be imported by path |
| Has an `exports` map | `published` when the file is an entry point or an entry point reaches it through re-exports; `unknown` when the entry points are not fully known (below); otherwise `internal-only` |

Entry points come from `main`, `module`, `types`, `typings`, `bin`, and every
string in `exports`. A path under `dist`, `lib`, `build`, `out`, `esm`, `cjs`,
or `types` also matches the same path under `src`, so `./dist/index.js` finds
`src/index.ts`. A `*` in an `exports` target matches any path segment run.
Reachability follows `export ... from` and `export { x }` of an imported
binding. It follows no other construct, so a published type that mentions an
internal type is protected only by the occurrence count.

The entry points are not fully known, and every non-published file of the
package gets `unknown`, when:

- A path listed in the manifest (other than the npm defaults) matches no source
  file, for example `dist/main.js` built from `src/entry.ts`. The `dist` to `src`
  mapping is a name heuristic, and a build step can break it.
- A reachable file re-exports through a relative path that does not resolve, or
  through a non-relative specifier that is not a Node built-in or a declared
  dependency of the owning or an enclosing package. That covers path aliases and
  packages of this repository. The scan does not read tsconfig `paths`, so it
  cannot follow these.

The `dist` to `src` mapping matches by name only. A build that renames the entry
(`dist/index.js` from `src/entry.ts`) while another `src/index.ts` exists
defeats it, and nothing in the manifest shows that. Confirm the mapping against
the build configuration before acting on a finding.

A `package.json` that is not valid JSON gives `unknown` to every file under it,
so those files do not inherit the verdict of an enclosing package.

Search rules, for `internal-only` candidates, once per distinct name:

- `gh search code <name> --owner <owner> --json repository,path --limit 100`.
  The owner is `--org` or the owner of the `origin` remote. Hits in the current
  repository are ignored. Any other hit gives `exported-with-hits`.
- Code search matches tokens, so a hit can be a different symbol with the same
  name. That over-counts, which refuses more and never less.
- A result of 100 rows is capped. The finding says so. A capped result whose
  rows all belong to the current repository gives `unknown`, because other
  repositories can lie beyond the cap.
- Only repositories of that one owner are searched. A consumer under another
  owner is invisible, and the finding evidence names the owner.
- A failure (no `gh`, not authenticated, unknown owner, rate limit after two
  retries, the `--max-external` limit) gives `unknown`, which is a refusal. A
  failed search never reads as "no hits".
- `--no-external` skips the search. The caller asserts that no other repository
  consumes this one, and the finding evidence says the search was skipped.

A `published` candidate is not searched. The manifest evidence already refuses
it, and each search costs rate limit.

## Local refusals

Applied to `internal-only` candidates, in this order. The first match is the
recorded category.

| Category | Rule |
| -------- | ---- |
| `kept-by-caller` | The name is in `--keep`. The caller read a list of deliberately unreferenced symbols (coverage exemptions, deprecation tables) that the script cannot discover. |
| `underscore-name` | A leading `_` marks a name as intentionally unreferenced. ESLint's `varsIgnorePattern` commonly encodes the same convention. |
| `side-effect-initializer` | Removing the statement may remove an effect. The initializer is not a function, literal, or an array, object, `as`, `satisfies` or parenthesized expression made only of those (no call, `new`, spread, computed key, or getter), or the class has decorators or static members, or an enum member is not a literal, or a sibling declarator in the same statement fails the test. |
| `test-support` | The path has a `test`, `tests`, `__tests__`, `__mocks__`, `fixtures`, `samples`, `examples`, or `e2e` segment. A test-pruning tool owns it. |
| `doc-in-directory` | The directory holds `README.md`, `DESIGN.md`, or `ARCHITECTURE.md`. A symbol that completes a documented set is not dead because nothing uses it yet. |

## Not checked

- **Non-exported unused declarations.** `noUnusedLocals` (tsconfig) and
  `@typescript-eslint/no-unused-vars` fail the build on them in repositories that
  enable either. A second implementation finds the same symbols one CI step later.
- **Unreachable code inside a function, unused parameters.** These need
  control-flow analysis.
- **A file nothing imports.** It is the sum of this scan's findings over the
  symbols in the file. A separate report would count each twice.
- **Dead tests and fixtures only a dead test uses.**
- **Unused dependencies in `package.json`.** Another signal with another
  consumer question.
- **Dynamic dispatch by computed name.** Reflection, DI containers, and routers
  that build a name at run time leave no token to count.
