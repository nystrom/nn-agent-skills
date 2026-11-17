# Check catalog

One entry per check: the rule it rests on, the evidence it uses, and what no
helper or tool proves. Language forms are in `languages.md`. A check with no
stated rule is a guess about the codebase, and a guess that fires is a bug
report against correct code.

Every check asks one question: does any production code read this? Evidence
comes from a language server (`lsp`) when one is available, from text search
(`text`), and always from reading the code (`read`). Text search proves that a
name has no match, not that nothing uses the thing. Each "Bound" below is a
place where the model reads the code itself.

## Scope

A scope (`--diff`, `--scope`) limits which files may yield candidates. It never
limits evidence: `refs` and `verdict` search the whole tree. A change that
removes the last reader of a field makes a candidate in a file the change did
not touch. The scope flags cannot see that, so the model finds it by reading
the removed lines. `--diff` also cannot see a candidate whose declaration moved
without its comment. Read the diff for those.

## What counts as a read

- With `lsp`: a reference that the server resolves to the declaration and that
  is not the declaration, not an import or export list entry, and not in a
  test file.
- With `text` (`survey.mjs refs`): a word match outside comment lines. The
  `access` shape (`.name`, `->name`, `::name`) is a read in most languages. A
  declaration, a keyed literal (`name: value`), and a keyword argument are not
  reads. Quoted names (`"name"`) and destructuring or pattern-matching
  occurrences may be reads: look at each.
- A test is never a read. A test that names an inert field is a finding for
  test review. The proposal names such tests, because a change that leaves
  them out is incomplete.

Bounds of the text search:

- It matches names, not symbols. Two unrelated declarations with one name
  share matches.
- It does not see reflection, serialization by field name, dynamic lookup,
  framework wiring by name, or generated code.
- It does not parse function bodies, destructuring, or nested patterns.
- Source files it cannot read are listed in `skippedFiles`. Open the ones you
  can. When you cannot establish that a skipped file holds no reader, keep the
  refusal.

## `inert-doc`

A comment on a field, option, or parameter that says it does nothing.

- Rule: when comments are the repository's record of intent, a comment that
  says setting a field has no effect is the repository asserting the field is
  inert. The check confirms the assertion against the readers and does not
  trust it.
- Candidates: `survey.mjs inert` lists comments with `is not implemented`,
  `has no effect`, `is accepted but`, `does nothing`, `is ignored`, or
  `is unused` (case-insensitive; `--phrase` replaces the list), and the first
  line after the comment that is neither comment nor blank. The model names the
  symbol from that line.
- Evidence: `lsp` find-references or `text` `refs` on the symbol, then `read`.
- A field whose comment says it has no effect while code reads it is a
  refusal. The comment and the code disagree, and which is wrong is a
  judgment.
- A comment on a function or method often describes an inert parameter. The
  deletion belongs to the parameter or its type, not to the function.
- Bound: it reads comments. A field that is inert and undocumented is not
  found, and neither is one whose comment says so in other words. Survey by
  reading.

## `unread-param`

A parameter with zero readers, or a type used only by such parameters.

- Rule: the language's convention for "deliberately unread" (`_name`, `_`, an
  unnamed parameter, a lint rule) is the repository's own statement that the
  implementation does not read the parameter.
- Candidates: unused-parameter diagnostics from the language server or the
  compiler or linter; `survey.mjs ignored` (identifiers like `_options`; the
  default pattern is a guess, change it with `--pattern` to the repository's
  convention); reading.
- Evidence: the type's own members, each checked for readers with `lsp` or
  `text`. Members that arrive through inheritance belong to the base and are
  not counted.
- One ignoring function is not evidence. A function that ignores an option
  that other functions read does not need it, and the option is live. Report
  only when no code reads any member of the type.
- Refuse when the type is also used outside ignored parameters, takes part in
  inheritance or interface implementation, or is declared more than once or
  merged.
- Bound: the helpers do not parse function bodies. A parameter that a body
  uses, or passes on, is not unread. The model reads each function.

## `empty-options`

An options or config type with no members, threaded through signatures.

- Rule: an optional argument whose type declares nothing carries nothing.
- Candidates: `survey.mjs empty-types` for the listed forms, otherwise a
  manual search.
- Evidence: `usesInFile` and `usesInOtherProductionFiles` from the helper, or
  find-references. Then read each use.
- An empty type can be a marker, an extension point, or a merge target (an
  interface merged in several files, an augmentation). Read for these before
  proposing removal.
- In some languages an empty structural type accepts any non-null value.
  Removing an optional parameter then changes nothing for callers, while
  removing a required parameter or a field type does. Propose removal only
  when every use is an optional parameter, and say so.
- Bound: forms the helper does not list are not found.

## Consumer verdict

The verdict decides every proposal, because every proposal deletes something
that may be part of a public signature. `survey.mjs verdict` computes it per
symbol:

1. Another package in the repository (a different nearest manifest) names the
   symbol: `exported-with-hits`.
2. The package is private (`"private": true`, `publish = false`, the Python
   `Private :: Do Not Upload` classifier, a Go `internal/` directory), or the
   user passed `--assume-unpublished`: `internal-only`.
3. `--offline`: `unknown`.
4. `gh search code "<symbol> <package name>"`, at most 10 queries per run.
   Hits in other repositories: `exported-with-hits`. No hits:
   `exported-no-hits`. Any failure, a missing `gh`, no login, or an unnamed
   package: `unknown`.

The verdict covers a symbol's name. A caller in another package or language
can pass the value without naming the type: an object literal, a keyword
argument, a reflective call. The helpers do not search for those callers. The
proposal names the check that would catch them (the build, the type check, the
tests). The scan also does not check whether a published package re-exports
the symbol from its entry point. It treats every symbol of a published package
as possibly public. This refuses more than necessary, and nothing clears a
symbol that was not shown to be internal.

## The design argument

Hold every proposal against the written argument for its shape: the file's
leading comment, a design or architecture document next to the code, and the
package README. A whole-word mention of the target is quoted into `evidence`.
It does not decide the finding. The word boundary is what makes the quote
worth reading: a substring match pulls in unrelated sentences.

## Not checks

The helpers do not report these. The judgment pass surveys them by reading,
weighs each against a documented reason for the shape, and labels what it
finds `source: reviewer`.

- **An abstraction with one implementation and one caller.** In a language
  with structural typing, an object can satisfy an interface without naming it,
  so an `implements` clause does not enumerate implementations. A caller count
  cannot recover the implementation count either, because the missing
  implementations are the thing being counted. Read the code.
- **A wrapper that only forwards.** A seam is a thin wrapper that lets one
  implementation be replaced without touching a consumer. A forwarding
  wrapper with a written argument for it is correct code.
- **A field that never varies.** A caller that always passes the same value
  does not make the option inert: a test or another caller may pass the other
  value, and the default is behavior.
- **Dead exports.** A type that nothing names at all is dead code. See the
  `dead-code-code-review` skill.
