# Check catalog

One entry for the check in `scripts/scan.mjs`, with the bound of what it sees
and what it does not see. This skill carries no measured counts from any
repository. Run the script on the target repository and treat its counts as the
baseline for that repository.

## What the script proves

The script proves that two functions in one language have the same body token
sequence, under the boundaries its text heuristic chose. It does not prove that
a merge is safe or correct, and it does not prove the boundaries are right.
Every reported finding needs the judgment pass in `SKILL.md`: the reviewer
reads the members and their callers. "What the script cannot see" in `SKILL.md`
lists the blind spots per check.

## Evidence source per check

| Check | Script uses | Reviewer adds |
| ----- | ----------- | ------------- |
| Function boundaries | text heuristic per language family | language server document symbols, reading |
| Identical body | token comparison (`text`) | reading both sides (`read`) |
| Shared home | manifest dependency fields | layering rules and docs (`read`) |
| Consumers | `git grep -ow`, optional `gh search code` (`text`) | language server find-references and call hierarchy (`lsp`) |
| Visibility | language rule table | declarations, re-exports, access modifiers (`read`) |
| Deliberate copy | comment marker | migration docs, git log (`read`) |

## `identical-body`

Two or more functions in one language whose bodies have the same token
sequence. Comments and whitespace do not count. String, template, character,
and regex literals count with their full text.

- Why: duplicated logic drifts. One copy gets a fix and the other does not.
  Many review guides say to factor duplication into a shared function or to
  merge near-identical functions with a parameter. The repository's own style
  guide is the authority for the repository.
- Units: named functions, methods, and (for JavaScript and TypeScript) arrow
  functions bound to a name, with a body of at least `--min-lines` logical
  lines. A logical line is a source line that holds a token other than a
  closing bracket, `;`, `,`, or `end`. Nested functions are included. Anonymous
  functions and expression-bodied functions are not compared.
- Line breaks. In languages where a line break can change meaning (the
  `newlines` languages in the script), a break between tokens is part of the
  body, so a wrapped call differs from an unwrapped one. In Python the
  indentation of each line is part of the body. In C, C++, Java, C#, and Rust
  line breaks do not count.
- Exact comparison only. A similarity threshold also reports pairs that
  resemble each other because they solve similar problems, and a merge proposal
  against those is a wrong proposal. The cost is that renaming one local
  variable hides a pair.
- The signature (the tokens of the header line before the body) is kept
  separately, so a same-file group over different types can be told from a
  function that repeats itself.
- Lexing is generic: identifiers, numbers, strings, comments, and operators.
  It is not a parser. An unterminated string or an unusual literal can unbalance
  brackets; the script then skips the file and lists it in `skipped` instead of
  guessing.

### The line floor

`--min-lines` defaults to 2. A one-line body is usually a delegation or a
getter, and identical ones are common and cheap. Raise the floor to cut noise
in a large repository; lower it to 1 to see wrappers. The right value depends
on the repository, so run the script at 2 first and raise it only if the report
is dominated by small groups.

### Files read

Files with an extension in `references/languages.md` that git tracks or does
not ignore, or all files when the directory is not a git repository. Excluded:
declaration-only TypeScript files, files with unbalanced brackets, symlinks,
vendored and build output directories, files whose first 512 bytes carry
`@generated`, `DO NOT EDIT`, or `Code generated`, and files over the size limit.
Tracked files that match an ignore rule are still read. A symlinked directory
is skipped so a link cannot make one file appear as two members.

The script reads files as they are on disk, including uncommitted and untracked
ones, in every scope mode. `--diff-base` decides which groups are candidates;
it does not check out the reviewed commit. To review committed work only, run
the script from a clean checkout of that commit. With `--include-working-tree`
the changed set is the merge base against the working tree, so a file restored
to its base contents is not in it.

## Refusal rules

| Rule | Why it exists |
| ---- | ------------- |
| Intentional-duplication comment | The author already decided the question. |
| No package can host the shared function | A new package edge is a different decision from removing a duplicate. |
| Same file, different signatures, distinct names | Per-type entry points of a dispatch family. |
| Nested inside a larger reportable group | The outer group covers the same duplication. |
| Folded into another group over the same files | Many identical pairs between two files are one review decision. |
| Consumer verdict `unknown` | A non-internal name may have callers the search could not see. |

Folding keeps `candidates` equal to `refused` plus `reported`: the first group
over a set of files that no other rule refused is reported and the rest are
refused with the id of the group they folded into. Two unrelated duplicate
bodies in the same pair of files fold together on purpose, because one review
decision covers both; the folded findings name the group that carries them. A
representative later refused for an unknown consumer still folds the others,
because they cover the same files and share the consumer question.

The dispatch-family rule is mechanical: same file, signatures differ, and every
member has a different name. A family such as `applyToString`, `applyToNumber`
can share a body today because no case is populated yet, and a merge removes
the place where the next case goes.

The deliberate-duplication marker looks at comments before a member and inside
its body for these phrases: intentional, deliberate, keep in sync, do not merge
or unify or dedupe, duplicated on purpose. A repository that documents
deliberate duplication elsewhere (a migration plan, a pair of `legacy` and
`current` directories whose snapshots must stay identical) is not detected. The
reviewer applies that rule by reading the docs named in the finding's evidence.

## Consumer verdicts

For each name in a group that is not internal, the script reports:

- `internal-only`: every member is internal by the language rule or nested.
- `exported-no-hits`: no file in the repository spells the name beyond the
  declarations, and `gh search code --owner <org>` found nothing.
- `exported-with-hits`: another file in the repository, or the external search,
  spells the name.
- `unknown`: a member's visibility is not known, the in-repo search failed, the
  name is not a plain identifier, or no external search ran. The group is
  refused.

The search matches spelling over tracked and untracked files. A common name such
as `map` or `get` returns hits from unrelated symbols. A hit is a reason to
check, not proof of a caller. The absence of hits is not proof of absence
either: dynamic imports, string lookups, generated code, and repositories
outside the searched owner do not appear. In a member's own file a hit counts
only when the name occurs more often than the file declares it. A language
server's find-references replaces this search when one is available.

Visibility follows `references/languages.md`. The rules ignore re-exports under
a different name and visibility set elsewhere. In JavaScript and TypeScript, a
class or object method is `unknown`.

## Not checked

- Duplicated types, interfaces, and constants. A finding that points at two
  files may show only the functions of a larger copy.
- A duplicate with one local renamed, by the choice above.
- Whether the surviving name is safe to change. The consumer verdict is
  evidence, and the reviewer decides.
- Layering rules. The script lists the configs and docs it finds under
  `conventions`; the reviewer reads them.
