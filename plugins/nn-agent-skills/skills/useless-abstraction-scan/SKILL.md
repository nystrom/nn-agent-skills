---
name: useless-abstraction-scan
description: >-
  Find abstractions that give the reader nothing, in any programming language:
  unread ones (an options or config field whose comment says it has no effect,
  a parameter or type with zero readers, an empty options type threaded through
  signatures) and single-use ones (a function, class, interface, wrapper, or
  pass-through layer that exactly one place uses, a forwarder, an interface
  with one implementation that exists by habit). The model uses a language
  server when one is available (find-references, find-implementations,
  diagnostics) and falls back to text search and reading, with small
  text-based helper scripts. Every candidate passes a judgment gate (seam,
  public API, named intent, multiple call sites, dynamic wiring, own tests,
  recursion, interface contract, live readers) and becomes a finding with a
  concrete proposed change, or a refusal with a reason. It reviews a change set
  or a whole repo, reports and proposes, and never edits files. Use when asked
  to find unused abstractions, inert options, dead configuration, pointless
  parameters, single-use abstractions, one-caller wrappers, one-implementation
  interfaces, needless indirection, or code that can be inlined, or as a review
  lens under run-review-lenses.
---

# Useless Abstraction Scan

An abstraction pays for itself when it removes duplication, isolates a seam, or
names a step the reader needs named. One that nothing reads, or that exactly
one place uses, and has none of these, makes the reader jump to another place
for no gain. This skill finds those and proposes the smallest change, with the
evidence that nothing needs the abstraction.

## Review lens

This skill is a review lens. Before you start, read
`../run-review-lenses/references/lens-protocol.md` and
`../run-review-lenses/references/review-scope.md`, and follow them. Two modes:

- **Standalone** (the user invoked this skill): resolve the scope mode
  (`diff` default, `repo`, or `paths`), state it in one line, run the method
  below, and return the compact markdown report that the protocol describes: a
  one-line verdict (`needs-attention` or `approve`), the mode and scope in one
  line, then the summary from "Report".
- **Fan-out** (the prompt says "structured findings" or names the wire format):
  use the scope the orchestrator passed and never re-derive it. Return only the
  structured list in the wire format below and a one-line headline,
  `needs-attention` or `approve`. Do not ask the user questions in this mode;
  if the roots are unclear, say so in one `low` finding.

In both modes the skill returns findings and does not act: no edits, no
commits, no GitHub posts.

### Scope mapping

The scope limits which abstractions are candidates. It never limits the
evidence search: reader counts, use counts, implementers, test uses, and roots
are computed over the whole tree. `refs` and `verdict` take no scope option,
because narrowing the evidence to the diff would make a field read elsewhere
look unread.

| Mode | Candidates |
| ---- | ---------- |
| `diff` (default) | Declarations in the files the change touched, for every check. For `single-use`, also declarations whose production use count the change drops to one (count at the merge base against count at head). |
| `repo` | Every declaration in the tree. Work through it by area, and say what you skipped. |
| `paths` | Declarations under the named paths. With a diff, a file must satisfy both. |

Commands, run from the repository root:

```bash
node <skill-dir>/scripts/scan.mjs diff-scope [--base REF] [--working-tree]
node <skill-dir>/scripts/scan.mjs candidates --diff [--base REF] [--working-tree]   # single-use checks
node <skill-dir>/scripts/scan.mjs inert --diff [--base REF] [--working-tree]        # same flags on empty-types and ignored
node <skill-dir>/scripts/scan.mjs candidates --scope PATH ...                        # paths mode
node <skill-dir>/scripts/scan.mjs candidates                                         # repo mode
```

`diff-scope` lists the changed files. `candidates --diff` adds a `diff` field to
each candidate: the reason (`declared-in-changed-file`, `use-count-fell-to-one`)
and `usesAtBase`. The base is the one the orchestrator passed, else
`origin/main`. The scan compares the checked-out `HEAD` (or, with
`--working-tree`, the working tree and untracked files) with the merge base. To
review a pull request, check out its head first. Without `--working-tree`, the
scan reads the committed content of `HEAD`, so uncommitted edits do not change
the counts.

Scope flags cannot see two things: a candidate in an unchanged file that lost
its last reader or caller because of the change, and a declaration that moved
without its comment. With a language server in diff mode, collect two sets of
symbols: the declarations in changed files, and the symbols that removed or
changed lines reference, including lines in deleted files. Run find-references
on each and compare the count at the merge base with the count at head. Without
one, read the removed lines.

### Wire format

Map each reported finding to
`{ source, path, line, severity, title, body, suggested_fix, evidence }`.
`scan.mjs report - --wire` prints this array (see "Report").

| Wire field | From |
| ---------- | ---- |
| `source` | `useless-abstraction-scan` (this skill's slug). The finding's own `source`, `script` or `reviewer`, goes in `evidence`. |
| `path`, `line` | `file`, `line` |
| `severity` | `high`, `medium`, `low` unchanged. This skill has no `blocker`. |
| `title` | The check and the symbol: "Delete inert option X", "Drop unread parameter X", "Remove empty options type X", "Inline single-use X", "Collapse single-implementation interface X", "Remove forwarder X", "Collapse abstraction X". |
| `body` | `evidence`, `judgmentReason`, and the gates. |
| `suggested_fix` | `proposal` |
| `evidence` | `Verified: ...` when `lsp` backs the finding, else `Inferred: ...`, naming the evidence sources (`lsp`, `text`, `read`) and the finding source. |

Refusals are not findings in fan-out. A refusal that deserves a look (for
example `public-api` on a symbol that may have no outside consumer) is reported
as a `low` finding with `worthALook: true` and `confirm`, the text of what to
confirm; it becomes `suggested_fix`. Other refusals and dropped candidates do
not appear.

### Overlap with other lenses

- `dead-code-code-review` flags symbols and branches that nothing calls.
- `ai-slop-code-review` flags needless wrappers by reading the diff for
  generated residue.

This skill adds what neither does: a check for options and parameters that are
declared but never read (inert options, unread parameters, empty options
types), and for abstractions that are used once, with use counts over the whole
tree from a language server or a script, a consumer verdict that refuses
anything that may leave its package, and a refusal gate for seams, public API,
dynamic wiring, and tests. A finding names the symbol, so the orchestrator can
merge it with a dead-code or wrapper finding on the same symbol and keep the
one with the gate verdict. One symbol can match more than one lens: an options
field that nothing reads is dead code and an inert option. Report it under this
skill when a comment or a parameter convention marks it as an option.

## Contract

The output is findings. Each finding has a concrete proposed change: what to
delete, inline, or remove, where, and the check that verifies it, written as
text or as a patch snippet in the report. The skill does not edit files, commit,
or open or comment on pull requests or issues. The user, or a separate task,
applies the proposals.

The helper script does not write to the repository. The only file it writes is
the findings file you name with `--out`. The path must be outside the
repository and must not be a symlink.

## Checks

Each check is defined without reference to a language. `references/languages.md`
gives the forms in each language, and `references/checks.md` gives the rule, the
evidence, and the bounds of each check.

| Check | A finding when |
| ----- | -------------- |
| `inert-doc` | A comment on a configuration or options field, or on a parameter, says it is not implemented or has no effect, and nothing reads it. |
| `unread-param` | A parameter, or a type used only by such parameters, has zero readers. The language's unused-parameter convention (`_name`, `_`, a lint rule) often marks it. |
| `empty-options` | An options or config type has no members and is threaded through signatures. |
| `single-use` | A function, method, class, type alias, or interface has exactly one production use, and inlining it makes the code simpler. |
| `single-impl` | An interface, trait, or protocol has exactly one implementation, and nothing requires the interface. |
| `forwarder` | A single-use function whose body only calls another function with its own arguments. |
| `reviewer` | An abstraction found by reading that the script did not list: a layer of pass-through types, a factory for one product, a class that wraps one function, an option passed through layers and read at none. |

## Gates and refusals

Each candidate must pass the gates below. A gate is a reason to refuse the
candidate, or to keep it and lower its severity. The ids appear in the findings
as `reason` (a refusal) or in `gates` (a downgrade).

| Id | The candidate fails when | Effect |
| -- | ------------------------ | ------ |
| `seam` | It is a test double, a dependency-injection point, or a documented boundary between layers or packages. | Refuse. |
| `public-api` | It is exported or public and can have consumers outside the repository. See "Consumer verdict". | Refuse. |
| `named-intent` | Its name documents a non-obvious step, and inlining would make the caller harder to read. A body of 8 or more statements, or a doc comment, is a hint only. | Refuse, or downgrade when the body is small. |
| `multi-site` | The one call site is in a loop or a callback, is passed as a value, or sits in a generic function that instances use with several types. That counts as more than one use. | Refuse. |
| `dynamic` | Reflection, a decorator or attribute, a registry, a string-named lookup, or a config file reaches it by name. | Refuse. |
| `has-own-tests` | Tests call it directly. Collapsing it changes what the tests can reach. | Downgrade to low. Name the tests. |
| `recursive` | It calls itself, or the single use is inside its own body. | Refuse. |
| `override-or-interface-contract` | It overrides a method, or is the one implementation that a library consumer or plugin point requires. | Refuse. |
| `read-by-code` | Code reads the field, or one function ignores an option that other functions read. A comment that says "no effect" next to code that reads the field belongs here: the comment and the code disagree. | Refuse. |
| `type-in-use` | A type has uses besides the ignored parameters, takes part in inheritance or interface implementation, is declared more than once, or is used as a required parameter or a field type (a structural empty type accepts any value). | Refuse. |
| `skipped-source` | A skipped file or excluded tree might hold a reader or a use, and you cannot open it. | Refuse. |
| `test-only-readers` | Only tests read the field. A test that asserts an inert field belongs to test review. Name the test in `judgmentReason`. | Refuse. |

Severity of the collapse checks (`single-use`, `single-impl`, `forwarder`) is
low by default. Raise it only when the abstraction adds a layer with no seam, no
documented reason, and no tests of its own, and state that in `raiseReason`. A
finding with any gate stays low. The no-reader checks and `reviewer` state their
own severity.

When the project's docs, a file comment, or a design document argue for the
shape, quote the argument in `evidence` and weigh it. It does not decide the
finding alone.

## Method

### 1. Choose the evidence source

Record which source backs each claim, per finding: `lsp`, `text`, or `read`.

1. **Language server (`lsp`).** Check whether one is configured in your harness
   or startable for the language (`references/languages.md` lists common
   servers; test with `command -v`). Prefer it for every semantic fact:
   references to a symbol (find-references), the implementations of an
   interface (find-implementations), callers (call hierarchy), where a symbol is
   declared (document and workspace symbols), unused diagnostics and code
   actions. A server resolves aliases, re-exports, overloads, and shadowing
   that a text search cannot.
2. **Text (`text`).** When no server exists or it fails, use
   `scripts/scan.mjs`, `rg`, or `git grep`. A text count matches names, not
   symbols, and proves that a name has no match, not that nothing uses the
   thing.
3. **Reading (`read`).** Open the declaration, its readers or its one use, and
   the code around them. Every finding needs this, whatever else backs it.

Say in the findings which sources were used. If you tried a server and it
failed, say that too.

### 2. Name the roots

A use counts from any root of the dependency graph, not only from production
code in this repository:

- production code and entry points,
- tests,
- build files, tool configs, CI files, and scripts,
- framework conventions (a file name, a decorator, a route table),
- other repositories that use this one as a library (the public API).

If the roots are unclear, for example you cannot tell whether the repository is
a library or an application, ask the user before you report. In fan-out mode,
report one `low` finding instead. Do not guess.

### 3. Find candidates

Run from inside the target repository. Node 20 or later, no packages. The
script is text-based and works on any language. It prints JSON.

```bash
node <skill-dir>/scripts/scan.mjs candidates            # one use, or one implementer (single-use, single-impl, forwarder)
node <skill-dir>/scripts/scan.mjs candidates --clean    # only candidates with no gate hint
node <skill-dir>/scripts/scan.mjs inert                 # comments saying "has no effect", and the declaration after each
node <skill-dir>/scripts/scan.mjs empty-types           # empty type declarations (listed forms)
node <skill-dir>/scripts/scan.mjs ignored               # _options-style identifiers
node <skill-dir>/scripts/scan.mjs refs NAME [--head]    # text matches in the whole tree, production vs test
node <skill-dir>/scripts/scan.mjs verdict SYMBOL FILE [--head]   # does it leave its package
node <skill-dir>/scripts/scan.mjs forms                 # declaration forms it knows
```

Options: `--scope`, `--diff`, `--base`, and `--working-tree` limit candidates
(see "Scope mapping"); `--kind <kind>`, `--decl <regex>`, `--limit <n>` shape
`candidates`; `--ext .x` adds a source extension; `--phrase` and `--pattern`
change what `inert` and `ignored` look for. Every candidate command prints the
resolved `scope`. With `--diff` and without `--working-tree`, candidates come
from committed `HEAD` content; pass `--head` to `refs` and `verdict` so their
evidence reads the same snapshot (they read manifests from disk).

Each `candidates` entry lists its declaration, kind, visibility, body size, the
one use (file, line, text, enclosing line), the tests that use it, the files
that import it, implementers for an interface, and `gateHints`: the gate ids its
hints suggest. Entries with no hint come first, then the smallest bodies. You
decide each gate by reading; a hint only tells you where to look. Names declared
more than once are listed as `ambiguous` and are not candidates, because their
uses are shared.

For `inert`, name the symbol from the declaration line, then count its readers
with `refs` or find-references. For `unread-param`, take candidates from
unused-parameter diagnostics, from `ignored` (set `--pattern` to the
repository's convention), and from reading. For `empty-options`, read
`usesInFile` and `usesInOtherProductionFiles` and then each use.

Every command lists `skippedFiles`: source files and directory symlinks it could
not read (a symlink outside the tree, a file over 2 MB, an unreadable file). It
also lists `excludedDirs`: source trees it did not scan, such as `vendor` and
`build`. Search the ones that matter before you report.

With a language server, start from the server's symbol list, reference counts,
and unused diagnostics instead, or confirm each script candidate with
find-references. When the script and the server disagree, trust the server for
resolved symbols and read the code for the difference.

### 4. Consumer verdict

A deletion or collapse is safe only if the symbol stays inside its package.
`verdict` finds the nearest manifest, names the package, and answers:

| Verdict | Meaning |
| ------- | ------- |
| `internal-only` | The package is private (or the user passed `--assume-unpublished`) and no other package in the repository names the symbol. |
| `exported-with-hits` | Another package in the repository names the symbol, or `gh search code` finds it in another repository. |
| `exported-no-hits` | The package is published and `gh search code` found nothing. The code index is incomplete, so this is a refusal. |
| `unknown` | The question could not be asked: `--offline`, no `gh`, no login, an unnamed package, or more than 10 queries. This is a refusal. |

Only `internal-only` clears a proposal. Three more values apply when you decide
without the script: `not-exported` when the language keeps the symbol inside its
package (a Go lowercase name, a Rust item without `pub`, a Java `private`
member), `user-stated-internal` when the user says the package has no outside
consumers, and `reviewer-internal` when you overturn a script verdict by
reading the code or with a language server (for example, a hit on an unrelated
name in another package). `reviewer-internal` needs a `source: reviewer`
finding with `lsp` or `read` evidence, and the reasoning in `judgmentReason`.
A published package with an exported symbol is a
`public-api` refusal unless the user states otherwise. Every finding records its
`consumerVerdict`. For a field, the verdict is for the interface that declares
it.

`verdict` knows manifests for `package.json`, `Cargo.toml`, `pyproject.toml`,
`go.mod`, `pom.xml`, and `Project.toml`, and a Go `internal/` directory. For any
other build system, reason about visibility from the code and the build files,
and say so. `gh search code` needs `gh` and a login; without them the verdict is
`unknown`.

The verdict covers a symbol's name. A caller can pass a field in an object
literal or a keyword argument to a public function without naming the type, so
the proposal's verifying check (the build, the type check, or the tests) decides.

### 5. Judgment pass

The helpers and any single tool give candidates. Do this before you report. A
script result alone never justifies a proposal.

1. **Check every candidate and every refusal against the code.** Open the
   declaration, its readers or its one use, and the surrounding code. Decide
   each gate. Record `confirmed`, `downgraded`, or `dropped`, with the reason in
   one line in `judgmentReason`. A hint can be wrong: a loop hint on a use that
   is outside the loop, a `dynamic` hint from an unrelated config mention. A
   refusal can be wrong too: a field read only by a no-op copy is inert, and a
   hit on an unrelated name in another package is false. To overturn a refusal,
   you need `lsp` or `read` evidence, written in `judgmentReason`. Report the
   result as a `source: reviewer` finding with `refused: false`.
2. **Survey what the helpers cannot see.** See the table below. Look for other
   indirection that nothing reads or that one place uses: wrappers that only
   forward, options passed through layers and read at none, interfaces with one
   implementation that exist by habit. Weigh each against a documented reason
   for the shape: a seam, a published contract, a test double, or a file comment
   or design doc that argues for it. Report only what the code supports, as
   `source: reviewer`.
3. **Read the files in `skippedFiles`** that you can open, and search them and
   `excludedDirs` for uses of every symbol you report. If you cannot establish
   that a skipped file holds no reader or use, refuse (`skipped-source`).
4. **Propose the change.** Say what to delete, inline, or remove, where, and how
   to verify it (the build, the type check, the named tests). Name the tests
   that mention the symbol: a test that asserts an inert field may record
   intended behavior, so the user decides whether to change or drop it. When a
   change leaves a type with no members, propose that removal as a separate
   finding, because it changes the signatures typed by it.

What the helpers cannot see:

| Check | Where to look |
| ----- | ------------- |
| all | Dynamic dispatch, reflection, serialization by name, decorators, registries, and framework wiring by name. Generated code. Other languages in the repository that call the symbol. Callers in other packages that pass a value without naming the type. Files in `skippedFiles` and `excludedDirs`. Consumers outside the repository. Names that two declarations share. |
| `inert-doc` | Inert fields with no comment, or a comment in other words. A comment that is wrong: read the code that receives the options. |
| `unread-param` | Function bodies. The helpers do not parse them. Read each function to see whether it uses the parameter or passes it on. Parameters not named like options. |
| `empty-options` | Each use of the type: a parameter, a field, or a generic argument. A marker type may be intentional. Forms the helper does not list. |
| `single-use` | Uses through an alias, a re-export, a macro, or a string. A use inside a comment or a string that the script counts as a use (it hides a candidate). Overloads. |
| `single-impl` | Implementations that the text pattern does not match: structural typing (Go, TypeScript object literals), multi-line class headers, Julia and Rust blanket methods, test doubles in other files. Read the code. |
| `forwarder` | Whether the arguments are the caller's own, and whether the forwarder adapts a type, an error, or a name. |
| `reviewer` | Layers made of several declarations, each with one use or none. |

### 6. Report

Compose the findings as JSON and pipe them to `report`, which validates and
summarizes them. Do not create the input file inside the repository.

```bash
node <skill-dir>/scripts/scan.mjs report - [--wire] <<'EOF'
{"skippedFiles": [], "excludedDirs": [], "findings": [ ... ]}
EOF
```

Add `--out <path>` only when the user asks for a findings file. A lens run
returns its findings in the reply and writes no file.

`report` checks the shape, counts, and ranks. It writes a file only with
`--out`, and refuses to replace a file that is not an earlier findings file. It
exits 1 when at least one finding is reported, 0 when none, 2 on invalid input.
With `--wire` it prints the wire-format JSON array on stdout and the headline
(`needs-attention` or `approve`) on stderr, and exits 1 when the array is not
empty.

Each finding has `id`, `source` (`script` for a candidate that a helper listed
and you confirmed, `reviewer` for one you found or changed), `check`,
`severity`, `file`, `line`, `symbol`, `evidenceSource` (`lsp`, `text`, `read`, or
a list), `evidence`, `proposal`, `refused`, `consumerVerdict`, `judgment`, and
`judgmentReason`. Add the fields below when they apply.

| Field | When |
| ----- | ---- |
| `reason` | `refused` is true. A gate or refusal id from the table above. The `proposal` is `"none"`. |
| `gates` | The finding is reported with gates. Judgment is `downgraded` and severity is `low`. |
| `testsNamed` | `gates` has `has-own-tests`. The tests that call the symbol. |
| `raiseReason` | A collapse check has severity above `low`. |
| `worthALook`, `confirm` | A refusal that goes into the wire output as a `low` finding, and the text of what to confirm. |

The summary to the user (standalone mode) has:

- a one-line verdict (`needs-attention` or `approve`) and the scope mode,
- the counts,
- each candidate with its judgment and the reason,
- the reported findings, ranked by severity then path, each with the evidence
  sources, file, line, and proposal,
- the `source: reviewer` findings in the same form,
- the refusals worth a look, with the id. A `public-api` refusal on a symbol
  with no outside consumer is worth a question to the user.

## Refuse when

- A gate other than `has-own-tests` applies, and the judgment pass does not
  overturn it with `lsp` or `read` evidence written in `judgmentReason`. A seam
  stays a refusal: a wrapper with one caller is a candidate, and the `seam`
  gate decides whether the indirection has a purpose.
- The consumer verdict is anything but `internal-only`, `not-exported`,
  `reviewer-internal`, or `user-stated-internal`.
- Code reads the field, and the judgment pass does not show the read to be a
  no-op.
- A skipped file or excluded directory might hold a reader or a use and you
  cannot open it.
- The roots are unclear and the user did not answer.
- The same change is already proposed elsewhere in the run.
