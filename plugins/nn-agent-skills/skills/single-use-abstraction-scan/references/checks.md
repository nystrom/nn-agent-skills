# Check catalog

One entry per check: the rule it rests on, what it proves, what it cannot see,
and its bounds. Language forms are in `languages.md`. A check with no stated
rule is a guess about the codebase, and a guess that fires is a bug report
against correct code.

Every check asks one question: does anything besides one production caller need
this abstraction? Evidence comes from a language server (`lsp`) when one is
available, from text search (`text`), and always from reading the code
(`read`).

## What counts as a use

- With `lsp`: a reference that the server resolves to the declaration and that
  is not the declaration, not an import or export-list entry, and not in a
  test file.
- With `text` (`scan.mjs candidates`): a word match outside comment lines.
  `candidates` does not count the declaration itself, a match inside the
  declaration's own body (a recursive call), an import or export-list line
  (including a multi-line list), a quoted name, or a C or C++ prototype.
  Quoted names are kept as a `dynamic` hint.
- `scan.mjs refs` is a raw search: it lists every non-comment line that names
  the symbol, including declarations, imports, and quoted names, split into
  production and test files. Read the lines.
- A test is not a production use. The script counts test uses apart, and the
  proposal names the tests.
- A symbol passed as a value (`map(f)`, a registration call) is a use at one
  line and many calls. The script reports `usedAsValue` and the `multi-site`
  hint.

Bounds of the text search:

- It matches names, not symbols. Two declarations with one name share matches,
  so the script lists such names as `ambiguous` and does not flag them. A name
  that other code uses for a field or a local variable counts those as uses,
  which hides a candidate and never creates one.
- A name in a trailing comment, a string, or a docstring body counts as a use.
  This also hides candidates.
- It does not see reflection, serialization by name, dynamic lookup, framework
  wiring by name, or generated code. These create false candidates, which the
  `dynamic` gate catches.
- It cannot match uses through an alias, a re-export under another name, or a
  macro expansion.
- Source files it cannot read are listed in `skippedFiles`. Open the ones you
  can. Files in `excludedDirs` are not scanned. In a git repository, the list
  includes source files and trees that git ignores (generated code, for
  example), which may hold a use.
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

## `single-use`

A function, method, class, type alias, or interface with exactly one production
use.

- Rule: a name with one use adds a jump and a definition to read. Inlining the
  body into the use removes both, unless a gate says the name or the boundary
  has a purpose.
- Candidates: `scan.mjs candidates`, where `uses.production` is 1; the
  language server's references for a symbol with one non-test reference.
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
  `interface B extends X`, `impl X for T`, `class C : X`, `class C(X)`,
  C++ `class C : public X`, and Julia `struct S <: X`.
- Proves: with `lsp` find-implementations, the implementation count. With
  `text`, that one line names the interface in an implementing position.
- Cannot see: structural implementations (Go interfaces, TypeScript object
  literals, duck typing), blanket or generic implementations, implementations
  in other repositories, test doubles written as object literals, and a class
  header that spans lines. The script finds none of these, so a count of one
  can be wrong in the direction of a false candidate. Use find-implementations
  or read the callers.
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
- Proves: only that the body is one call. The model reads whether the
  forwarder adds a default, a type conversion, an error mapping, or a name that
  hides a dependency.
- Bound: a forwarder at a package boundary is a `seam` or a `public-api`
  refusal.

## `reviewer`

An abstraction that reading finds and the script does not list: a chain of
wrappers each used once, a factory that builds one product, a configuration
object read at one place, a class that wraps one function. Label it
`source: reviewer`, give the evidence source, and run the same gates.

## Gates

The script's `gateHints` suggest which gates to decide. The model decides each
gate by reading.

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

When a gate applies and the use is still in the right place to collapse, keep the
finding, set `judgment` to `downgraded`, list the gate ids in `gates`, and keep
severity `low`. `has-own-tests` always downgrades and never refuses on its own.

## Consumer verdict

The verdict decides every proposal, because a collapse deletes a name that may be
part of a public signature. `scan.mjs verdict` computes it per symbol:

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
use the value without naming it. The proposal names the check that would catch
such callers (the build, the type check, the tests). The script also does not
check whether a published package re-exports the symbol from its entry point.
It treats every symbol of a published package as possibly public. This refuses
more than necessary, and nothing clears a symbol that was not shown to be
internal. The Go `internal/` rule clears a symbol because only code under the
parent of `internal/` can import it. That tree is the repository in the usual
layout; if the module path is shared with other repositories, the rule does not
apply and the model says so. `not-exported` is the model's verdict when the language keeps the
symbol inside its package.

## The design argument

Hold every proposal against the written argument for its shape: the file's
leading comment, a design or architecture document next to the code, and the
package README. The script lists whole-word mentions of the symbol in docs and
config files under `mentions`. Quote a relevant one into `evidence`. It does not
decide the finding.

## Not checks

- **A symbol with zero production uses.** That is dead code. See the
  `dead-code-code-review` skill.
- **A field, parameter, or option that nothing reads.** See the
  `unused-abstraction-scan` skill.
- **Duplicated code.** Two uses of one helper are a reason to keep it.
