# Check catalog

One entry per check: the rule it rests on, what it proves, what it cannot see,
and its bounds. Language forms are in `languages.md`. A check with no stated
rule is a guess about the codebase, and a guess that fires is a bug report
against correct code.

Every check asks one question: does anything need this abstraction, besides at
most one production caller? The no-reader checks ask it with zero callers or
readers, the collapse checks with one. Evidence comes from a language server
(`lsp`) when one is available, from text search (`text`), and always from
reading the code (`read`). Text search proves that a name has no match, not
that nothing uses the thing. Each "Cannot see" and "Bound" below is a place
where the model reads the code itself.

## What counts as a use or a read

- With `lsp`: a reference that the server resolves to the declaration and that
  is not the declaration, not an import or export-list entry, and not in a
  test file.
- With `text` (`scan.mjs candidates`): a word match outside comment lines.
  `candidates` does not count the declaration itself, a match inside the
  declaration's own body (a recursive call), an import or export-list line
  (including a multi-line list), a quoted name, or a C or C++ prototype.
  Quoted names are kept as a `dynamic` hint.
- `scan.mjs refs` is a raw search over the whole tree: it lists every
  non-comment line that names the symbol, including declarations, imports, and
  quoted names, split into production and test files, with the shape `access`
  (`.name`, `->name`, `::name`), `quoted`, or `other`. An `access` is a read in
  most languages. A declaration, a keyed literal (`name: value`), and a keyword
  argument are not reads. Destructuring and pattern-matching occurrences may be
  reads: look at each line.
- A test is not a production use or read. The script counts test uses apart,
  and the proposal names the tests, because a change that leaves them out is
  incomplete.
- A symbol passed as a value (`map(f)`, a registration call) is a use at one
  line and many calls. The script reports `usedAsValue` and the `multi-site`
  hint.

Bounds of the text search:

- It matches names, not symbols. Two declarations with one name share matches,
  so `candidates` lists such names as `ambiguous` and does not flag them. A name
  that other code uses for a field or a local variable counts those as uses,
  which hides a candidate and never creates one.
- A name in a trailing comment, a string, or a docstring body counts as a use.
  This also hides candidates.
- It does not see reflection, serialization by name, dynamic lookup, framework
  wiring by name, or generated code. These create false candidates, which the
  `dynamic` gate catches.
- It cannot match uses through an alias, a re-export under another name, a
  macro expansion, or destructuring nested in patterns.
- Source files it cannot read are listed in `skippedFiles`. Open the ones you
  can. When you cannot establish that a skipped file holds no reader or use,
  keep the refusal (`skipped-source`). Files in `excludedDirs` are not scanned.
  In a git repository, the list includes source files and trees that git
  ignores (generated code, for example), which may hold a use.
- Declarations come from a per-language table of one-line forms. A declaration
  the table does not match is not listed. `--decl` adds a form.
- Lines over 2000 characters (minified or generated code) are not searched for
  declarations. Their names still count as uses.
- A declaration is found only when the form starts on one line. Go grouped
  `type ( ... )` blocks and declarations split across lines before the name are
  not listed.
- The body end comes from braces, indentation, or `end`. A string or comment
  that holds unbalanced braces can shorten or lengthen the body. The body size
  is a hint.

## Scope and diff scope

A scope (`--diff`, `--scope`) limits which files may yield candidates. It never
limits evidence: `refs`, `verdict`, and the use counts cover the whole tree.

`--diff` keeps a candidate when its file is in the change. `candidates --diff`
also keeps a `single-use` candidate whose production use count at the merge base
was above one and is one at head.

- Only a `single-use` candidate can fall to one. An interface with several uses
  and one implementer is selected only when its file changed.
- Without `--working-tree`, files that differ between the working tree and
  `HEAD` are read from `HEAD`, so the review covers committed content. With it,
  the change is the merge base against the working tree, plus untracked files.
  A committed change that the working tree reverted does not count.
- The comparison is the checked-out `HEAD` (or the working tree) against the
  merge base. A range `base..head` and a pull request are not resolved: check
  out the head first.
- The base count comes from the same text counting, with each changed file
  replaced by its merge-base version (a deleted file restored, an added file
  removed, a renamed file read under its old path). It has the bounds of the
  text search above.
- A file the script cannot read at the merge base (over 2 MB, not text) keeps
  its head version, so a use that moved out of it is not seen.
- A name declared more than once at the merge base has no base count and is not
  selected for a drop. It is still selected when its file changed.
- The rule selects declarations in changed files whole, not only the added
  lines. The model decides whether an old declaration in a changed file belongs
  in the review.
- A symbol whose use count fell by a rename of the symbol itself shows as
  added, because the old name no longer exists at head.
- A change that removes the last reader of a field makes a candidate in a file
  the change did not touch. The flags cannot see it. The model finds it by
  reading the removed lines and searching the symbols they used.
- Ambiguity is decided over the whole tree. `--scope` and `--diff` only filter
  which declarations are listed, so a same-named declaration outside the scope
  still makes the name ambiguous.
- `refs` and `verdict` read the working tree unless given `--head`, which reads
  committed content like a `--diff` run without `--working-tree`. Both read
  manifests from disk.
- `diff-scope` and `--diff` need a git repository and a base ref. Without one
  they exit 2; the model then reviews in `repo` or `paths` mode.

## `inert-doc`

A comment on a field, option, or parameter that says it does nothing.

- Rule: when comments are the repository's record of intent, a comment that
  says setting a field has no effect is the repository asserting the field is
  inert. The check confirms the assertion against the readers and does not
  trust it.
- Candidates: `scan.mjs inert` lists comments with `is not implemented`,
  `has no effect`, `is accepted but`, `does nothing`, `is ignored`, or
  `is unused` (case-insensitive; `--phrase` replaces the list), and the first
  line after the comment that is neither comment nor blank. The model names the
  symbol from that line.
- Evidence: `lsp` find-references or `text` `refs` on the symbol, then `read`.
- A field whose comment says it has no effect while code reads it is a refusal
  (`read-by-code`). The comment and the code disagree, and which is wrong is a
  judgment.
- A comment on a function or method often describes an inert parameter. The
  deletion belongs to the parameter or its type, not to the function.
- Cannot see: an inert field with no comment, or a comment in other words.
  Survey by reading.

## `unread-param`

A parameter with zero readers, or a type used only by such parameters.

- Rule: the language's convention for "deliberately unread" (`_name`, `_`, an
  unnamed parameter, a lint rule) is the repository's own statement that the
  implementation does not read the parameter.
- Candidates: unused-parameter diagnostics from the language server, compiler,
  or linter; `scan.mjs ignored` (identifiers like `_options`; the default
  pattern is a guess, change it with `--pattern` to the repository's
  convention); reading.
- Evidence: the type's own members, each checked for readers with `lsp` or
  `text`. Members that arrive through inheritance belong to the base and are
  not counted.
- One ignoring function is not evidence. A function that ignores an option that
  other functions read does not need it, and the option is live
  (`read-by-code`). Report only when no code reads any member of the type.
- Refuse (`type-in-use`) when the type is also used outside ignored parameters,
  takes part in inheritance or interface implementation, or is declared more
  than once or merged.
- Cannot see: function bodies. A parameter that a body uses, or passes on, is
  not unread. The model reads each function.

## `empty-options`

An options or config type with no members, threaded through signatures.

- Rule: an optional argument whose type declares nothing carries nothing.
- Candidates: `scan.mjs empty-types` for the listed forms, otherwise a manual
  search.
- Evidence: `usesInFile` and `usesInOtherProductionFiles` from the helper, or
  find-references. Then read each use.
- An empty type can be a marker, an extension point, or a merge target (an
  interface merged in several files, an augmentation). Read for these before
  proposing removal.
- In some languages an empty structural type accepts any non-null value.
  Removing an optional parameter then changes nothing for callers, while
  removing a required parameter or a field type does. Propose removal only when
  every use is an optional parameter, and say so; otherwise refuse
  (`type-in-use`).
- Cannot see: forms the helper does not list.

## `single-use`

A function, method, class, type alias, or interface with exactly one production
use.

- Rule: a name with one use adds a jump and a definition to read. Inlining the
  body into the use removes both, unless a gate says the name or the boundary
  has a purpose. A wrapper with one caller is a candidate here. The `seam` gate
  decides whether its indirection has a purpose.
- Candidates: `scan.mjs candidates`, where `uses.production` is 1; the language
  server's references for a symbol with one non-test reference.
- Proves: with `lsp`, that the server finds one reference. With `text`, that
  exactly one line outside the declaration, imports, and tests names it.
- Cannot see: uses by name through reflection or config (the `dynamic` hints
  cover string and config mentions), uses by other repositories, and uses in
  skipped or excluded files.
- Bound: a type alias or interface with one use may carry a domain name (a
  branded type, a unit). That is `named-intent`, not a collapse.

## `single-impl`

An interface, trait, or protocol with exactly one implementation.

- Rule: an interface exists so that several implementations can stand behind
  one contract. With one implementation and no outside implementer, the
  interface repeats the class. Callers can name the class.
- Candidates: `scan.mjs candidates` lists interface-like declarations whose
  `implementers` has one entry. The text patterns are `class C implements X`,
  `interface B extends X`, `impl X for T`, `class C : X`, `class C(X)`, C++
  `class C : public X`, and Julia `struct S <: X`.
- Proves: with `lsp` find-implementations, the implementation count. With
  `text`, that one line names the interface in an implementing position.
- Cannot see: structural implementations (Go interfaces, TypeScript object
  literals, duck typing), blanket or generic implementations, implementations
  in other repositories, test doubles written as object literals, and a class
  header that spans lines. A count of one can be wrong in the direction of a
  false candidate. Use find-implementations or read the callers.
- Bound: a test double in a test file is a second implementation. The script
  counts production implementers only. Search the test files before you report.
  A double or a plugin point is the `seam` or `override-or-interface-contract`
  gate.

## `forwarder`

A single-use function whose body is one call that passes its own arguments to
another function.

- Rule: a forwarder with one caller is a pass-through layer. The caller can call
  the target.
- Candidates: `forwards: true` on a `scan.mjs candidates` entry.
- Proves: only that the body is one call. The model reads whether the forwarder
  adds a default, a type conversion, an error mapping, or a name that hides a
  dependency.
- Bound: a forwarder at a package boundary is a `seam` or a `public-api`
  refusal.

## `reviewer`

An abstraction that reading finds and the script does not list: a chain of
wrappers each used once, a factory that builds one product, a configuration
object read at one place, an option passed through layers and read at none, a
class that wraps one function. Label it `source: reviewer`, give the evidence
source, and run the same gates.

## Gates

The script's `gateHints` suggest which gates to decide for a collapse
candidate. The model decides each gate by reading.

| Gate | Hint source | What the hint cannot tell |
| ---- | ----------- | ------------------------- |
| `public-api` | The language visibility rule, a re-export line. | Whether the package is published, and whether anyone outside uses the symbol. See the consumer verdict. |
| `dynamic` | A quoted occurrence of the name, a decorator or attribute on the line above, a mention in a config file. | Reflection with computed names, and wiring by file name. |
| `has-own-tests` | A test file that uses the name. | Whether the tests only cover the abstraction or also the caller. |
| `multi-site` | The use is inside a loop, a callback, or is passed as a value; the declaration is generic. | Whether the callback runs once. A loop hint on a use outside the loop is wrong. |
| `override-or-interface-contract` | An `override` keyword, an `@Override` line, an `impl ... for` parent. | Overrides in languages that mark none (Python, Julia, Go). |
| `recursive` | A use inside the declaration's own body. | Mutual recursion. |
| `named-intent` | A doc comment above the declaration, or a body of 8 or more statements. | Whether the name documents a step that a reader needs. Only the model judges that. |
| `seam` | None. | Seams are a design fact. Look for test doubles, dependency-injection setup, a layer or package boundary, and a design document. |
| `read-by-code` | None. `refs` shows `access` lines. | Whether a read is a no-op, such as a copy that nothing uses. |
| `type-in-use` | None. | Other uses, inheritance, and merged declarations: `refs` and find-references show them. |
| `skipped-source` | `skippedFiles`, `excludedDirs`. | What the unread files contain. |
| `test-only-readers` | `refs` counts test and production lines apart. | Whether the test asserts intended behavior. |

When a gate applies and the abstraction is still in the right place to change,
keep the finding, set `judgment` to `downgraded`, list the gate ids in `gates`,
and keep severity `low`. `has-own-tests` always downgrades and never refuses on
its own.

## Consumer verdict

The verdict decides every proposal, because every proposal deletes a name that
may be part of a public signature. `scan.mjs verdict` computes it per symbol:

1. Another package in the repository (a different nearest manifest) names the
   symbol: `exported-with-hits`.
2. The package is private (`"private": true`, `publish = false`, the Python
   `Private :: Do Not Upload` classifier, a Go `internal/` directory), or the
   user passed `--assume-unpublished`: `internal-only`.
3. `--offline`: `unknown`.
4. `gh search code "<symbol> <package name>"`, at most 10 queries per run. Hits
   in other repositories: `exported-with-hits`. No hits: `exported-no-hits`.
   Any failure, a missing `gh`, no login, or an unnamed package: `unknown`.

The verdict covers a symbol's name. A caller in another package or language can
pass the value without naming the type: an object literal, a keyword argument,
a reflective call. The script does not search for those callers. The proposal
names the check that would catch them (the build, the type check, the tests).
The script also does not check whether a published package re-exports the
symbol from its entry point. It treats every symbol of a published package as
possibly public. This refuses more than necessary, and nothing clears a symbol
that was not shown to be internal. The Go `internal/` rule clears a symbol
because only code under the parent of `internal/` can import it. That tree is
the repository in the usual layout; if the module path is shared with other
repositories, the rule does not apply and the model says so. `not-exported` is
the model's verdict when the language keeps the symbol inside its package.

## The design argument

Hold every proposal against the written argument for its shape: the file's
leading comment, a design or architecture document next to the code, and the
package README. For collapse candidates the script lists whole-word mentions of
the symbol in docs and config files under `mentions`. Quote a relevant one into
`evidence`. It does not decide the finding. The word boundary is what makes the
quote worth reading: a substring match pulls in unrelated sentences.

## Not checks

- **A symbol with zero production uses and no option semantics.** That is dead
  code. See the `dead-code-code-review` skill.
- **A field that never varies.** A caller that always passes the same value does
  not make the option inert: a test or another caller may pass the other value,
  and the default is behavior.
- **Duplicated code.** Two uses of one helper are a reason to keep it.
