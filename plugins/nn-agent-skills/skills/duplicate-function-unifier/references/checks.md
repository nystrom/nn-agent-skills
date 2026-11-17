# Check catalog

One entry for the check in `scripts/scan.mjs`, with the bound of what it sees
and what it does not see. This skill carries no measured counts from any
repository. Run the script on the target repository and treat its counts as the
baseline for that repository.

## `identical-body`

Two or more named functions whose bodies have the same token sequence. Comments
and whitespace are trivia and do not count. String, template, and regex text
counts.

- Why: duplicated logic drifts. One copy gets a fix and the other does not.
  Many review guides say to factor duplication into a shared function or to
  merge near-identical functions with a parameter. The repository's own style
  guide is the authority for the repository.
- Units: function declarations, class and object methods, and arrow or function
  expressions bound to a variable, with a block body. Nested ones are included,
  because duplicated closures are common inside constructors and factories.
  Expression-bodied arrows and anonymous callbacks are not compared.
- Exact comparison only. A similarity threshold also reports pairs that
  resemble each other because they solve similar problems, and a merge proposal
  against those is a wrong proposal. The cost is that renaming one local
  variable hides a pair.
- The signature (the tokens before the body) is kept separately, so a same-file
  group over different types can be told from a function that repeats itself.
- Parsing uses the `typescript` package, because a regex over braces cannot
  tell a function body from an object literal. Plain JavaScript files go
  through the same parser.

### The statement floor

`--min-statements` defaults to 2. A one-statement body is usually a delegation
or a getter, and identical ones are common and cheap. Raise the floor to cut
noise in a large repository; lower it to 1 to see wrappers. The right value
depends on the repository, so run the script at 2 first and raise it only if
the report is dominated by small groups.

### Files read

Files with a JavaScript or TypeScript extension that git tracks or does not
ignore, or all files when the directory is not a git repository. Excluded:
declaration files (`.d.ts`, `.d.mts`, `.d.cts`), files with parse errors, symlinks, vendored and build output directories, files whose first 512
bytes carry `@generated`, `DO NOT EDIT`, or `Code generated`, and files over
the size limit. A symlinked directory is skipped so a link cannot make one file
appear as two members.

## Refusal rules

| Rule | Why it exists |
| ---- | ------------- |
| Intentional-duplication comment | The author already decided the question. |
| No package can host the shared function | A new package edge is a different decision from removing a duplicate. |
| Same file, different signatures, distinct names | Per-type entry points of a dispatch family. |
| Nested inside a larger group | The outer group covers the same duplication. |
| Folded into another group over the same files | Many identical pairs between two files are one review decision. |
| Consumer verdict `unknown` | An exported name may have callers the search could not see. |

Folding keeps `candidates` equal to `refused` plus `reported`: the first group
over a set of files is reported and the rest are refused with the id of the
group they folded into.

The dispatch-family rule is mechanical: same file, signatures differ, and every
member has a different name. A family such as `applyToString`, `applyToNumber`
can share a body today because no case is populated yet, and a merge removes
the place where the next case goes.

The deliberate-duplication marker looks at the comment before a member and at
comments inside its body for these phrases: intentional, deliberate, keep in
sync, do not merge or unify or dedupe, duplicated on purpose. A repository that
documents deliberate duplication elsewhere (a migration plan, a pair of
`legacy` and `current` directories whose snapshots must stay identical) is not
detected. The reviewer applies that rule by reading the docs named in the
finding's evidence.

## Consumer verdicts

For each exported name in a reported group the script reports:

- `internal-only`: no member is exported.
- `exported-no-hits`: exported, no file in the repository spells the
  name beyond the declarations, and `gh search code --owner <org>` found nothing.
- `exported-with-hits`: another file in the repository, or the external search,
  spells the name.
- `unknown`: the in-repo search failed, the name is not a plain identifier, or
  no external search ran. The group is refused.

The search matches spelling. A common name such as `map` or `get` returns hits
from unrelated symbols. A hit is a reason to check, not proof of a caller. The
absence of hits is not proof of absence either: dynamic imports, string
lookups, generated code, and repositories outside the searched owner do not
appear. A name is exported when it carries `export`, is listed in an
`export { name }` or `export default name` statement, or sits in a file that
assigns to `module.exports` or `exports.x` (every function there counts). A
method is exported when its class is exported and the method is not `private`,
`protected`, or a `#private` name. A method of an object literal always
counts as exported, because the object may be exported or passed out. An
`export { name as alias }` statement adds the alias to the names searched. Re-exports from other modules are not
followed, so a name exported only through a barrel is found by the spelling
search, not by declaration.

## Not checked

- Duplicated types, interfaces, and constants. A finding that points at two
  files may show only the functions of a larger copy.
- A duplicate with one local renamed, by the choice above.
- Whether the surviving name is safe to change. The consumer verdict is
  evidence, and the reviewer decides.
- Layering rules. The script lists the configs and docs it finds under
  `conventions`; the reviewer reads them.
