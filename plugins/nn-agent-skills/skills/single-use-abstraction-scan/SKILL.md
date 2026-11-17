---
name: single-use-abstraction-scan
description: >-
  Find abstractions that exactly one place uses and that can be collapsed into
  that place, in any programming language: a function, method, class,
  interface, trait, protocol, type alias, wrapper, pass-through layer, or an
  interface with one implementation that exists by habit. The model uses a
  language server when one is available (find-references,
  find-implementations, call hierarchy) and falls back to text search and
  reading, with small text-based helper scripts that list declarations and
  count production and test references. Every candidate passes a judgment gate
  (seam, public API, named intent, multiple call sites, dynamic wiring, own
  tests, recursion, interface contract) and becomes a finding with a concrete
  proposed change or a refusal with a reason. The skill reports and proposes;
  it never edits files. Use when asked to find single-use abstractions, needless
  indirection, one-caller wrappers, one-implementation interfaces, or code that
  can be inlined to make it simpler.
---

# Single-Use Abstraction Scan

An abstraction pays for itself when it removes duplication, isolates a seam, or
names a step the reader needs named. One that has a single use and none of
these makes the reader jump to a second place for no gain. This skill finds
those and proposes the smallest collapse, with the evidence that nothing needs
the abstraction.

For fields, parameters, and options that nothing reads, use the
`unused-abstraction-scan` skill. It refuses one-caller wrappers on purpose;
this skill is the dedicated check for them.

## Contract

The output is findings. Each finding has a concrete proposed change: what to
inline or remove, where, and the check that verifies it, written as text or as
a patch snippet in the report. The skill does not edit files, commit, or open
or comment on pull requests or issues. The user, or a separate task, applies
the proposals.

The helper script does not write to the repository. The only file it writes is
the findings file you name with `--out`. The path must be outside the
repository and must not be a symlink.

## Checks

Each check is defined without reference to a language. `references/languages.md`
gives the forms in each language, and `references/checks.md` gives the rule,
the evidence, and the bounds of each check.

| Check | A finding when |
| ----- | -------------- |
| `single-use` | A function, method, class, type alias, or interface has exactly one production use, and inlining it makes the code simpler. |
| `single-impl` | An interface, trait, or protocol has exactly one implementation, and nothing requires the interface. |
| `forwarder` | A single-use function whose body only calls another function with its own arguments. |
| `reviewer` | An abstraction found by reading that the script did not list: a layer of pass-through types, a factory for one product, a class that wraps one function. |

## Gates

Each candidate must pass the gates below. A gate is a reason to refuse the
candidate, or to keep it and lower its severity. Gate ids appear in the
findings.

| Gate id | The candidate fails when | Effect |
| ------- | ------------------------ | ------ |
| `seam` | It is a test double, a dependency-injection point, or a documented boundary between layers or packages. | Refuse. |
| `public-api` | It is exported or public and can have consumers outside the repository. See "Consumer verdict". | Refuse. |
| `named-intent` | Its name documents a non-obvious step, and inlining would make the caller harder to read. A body of 8 or more statements, or a doc comment, is a hint only. | Refuse, or downgrade when the body is small. |
| `multi-site` | The one call site is in a loop or a callback, is passed as a value, or sits in a generic function that instances use with several types. That counts as more than one use. | Refuse. |
| `dynamic` | Reflection, a decorator or attribute, a registry, a string-named lookup, or a config file reaches it by name. | Refuse. |
| `has-own-tests` | Tests call it directly. Collapsing it changes what the tests can reach. | Downgrade to low. Name the tests. |
| `recursive` | It calls itself, or the single use is inside its own body. | Refuse. |
| `override-or-interface-contract` | It overrides a method, or is the one implementation that a library consumer or plugin point requires. | Refuse. |

Severity is low by default. Raise it only when the abstraction adds a layer with
no seam, no documented reason, and no tests of its own, and state that in
`raiseReason`. A finding with any gate stays low.

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
   declared (document and workspace symbols). A server resolves aliases,
   re-exports, overloads, and shadowing that a text search cannot.
2. **Text (`text`).** When no server exists or it fails, use
   `scripts/scan.mjs`, `rg`, or `git grep`. A text count matches names, not
   symbols.
3. **Reading (`read`).** Open the declaration, its one use, and the code around
   both. Every finding needs this, whatever else backs it.

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
a library or an application, ask the user before you report. Do not guess.

### 3. Find candidates

Run from inside the target repository. Node 20 or later, no packages. The
script is text-based and works on any language. It prints JSON.

```bash
node <skill-dir>/scripts/scan.mjs candidates            # one use, or one implementer
node <skill-dir>/scripts/scan.mjs candidates --clean    # only candidates with no gate hint
node <skill-dir>/scripts/scan.mjs refs NAME             # text matches, production vs test
node <skill-dir>/scripts/scan.mjs verdict SYMBOL FILE   # does it leave its package
node <skill-dir>/scripts/scan.mjs forms                 # declaration forms it knows
```

Options: `--scope <path>` limits which declarations are listed (references are
counted in the whole tree), `--kind <kind>` filters, `--ext .x` adds a source
extension, `--decl <regex>` adds a declaration form for a language the table
lacks (named group `(?<name>...)`), `--limit <n>` limits the output.

Each candidate lists its declaration, kind, visibility, body size, the one use
(file, line, text, enclosing line), the tests that use it, the files that
import it, implementers for an interface, and `gateHints`: the gate ids its
hints suggest. Candidates with no hint come first, then the smallest bodies.
You decide each gate by reading; a hint only tells you where to look. Names declared more than once are
listed as `ambiguous` and are not candidates, because their uses are shared.

Every command lists `skippedFiles`: source files and directory symlinks it could
not read (a symlink outside the tree, a file over 2 MB, an unreadable file). It
also lists `excludedDirs`: source trees it did not scan, such as `vendor` and
`build`. Search the ones that matter before you report.

With a language server, start from the server's symbol list and reference
counts instead, or confirm each script candidate with find-references. When
the script and the server disagree, trust the server for resolved symbols and
read the code for the difference.

### 4. Consumer verdict

A collapse is safe only if the symbol stays inside its package. `verdict`
finds the nearest manifest, names the package, and answers:

| Verdict | Meaning |
| ------- | ------- |
| `internal-only` | The package is private (or the user passed `--assume-unpublished`) and no other package in the repository names the symbol. |
| `exported-with-hits` | Another package in the repository names the symbol, or `gh search code` finds it in another repository. |
| `exported-no-hits` | The package is published and `gh search code` found nothing. The code index is incomplete, so this is a refusal. |
| `unknown` | The question could not be asked: `--offline`, no `gh`, no login, an unnamed package, or more than 10 queries. This is a refusal. |

Only `internal-only` clears a proposal. Two more values apply when you decide
without the script: `not-exported` when the language keeps the symbol inside its
package (a Go lowercase name, a Rust item without `pub`, a Java `private`
member), and `user-stated-internal` when the user says the package has no
outside consumers. A published package with an exported symbol is a
`public-api` refusal unless the user states otherwise.

`verdict` knows manifests for `package.json`, `Cargo.toml`, `pyproject.toml`,
`go.mod`, `pom.xml`, and `Project.toml`, and a Go `internal/` directory. For any
other build system, reason about visibility from the code and the build files,
and say so. `gh search code` needs `gh` and a login; without them the verdict
is `unknown`.

### 5. Judgment pass

The helpers and any single tool give candidates. Do this before you report. A
script result alone never justifies a proposal.

1. **Check every candidate against the code.** Open the declaration, the one
   use, and the surrounding code. Decide each gate. Record `confirmed`,
   `downgraded`, or `dropped`, with the reason in one line in `judgmentReason`.
   A hint can be wrong: a loop hint on a use that is outside the loop, a
   `dynamic` hint from an unrelated config mention.
2. **Survey what the script cannot see.** See the table below. Report what you
   find as `source: reviewer`. Report only what the code supports.
3. **Read the files in `skippedFiles`** that you can open, and search them and
   `excludedDirs` for uses of every symbol you report. If you cannot establish
   that a skipped file holds no use, refuse.
4. **Propose the collapse.** Say what to inline or remove, where, and how to
   verify it (the build, the type check, the named tests).

What the script cannot see:

| Check | Where to look |
| ----- | ------------- |
| all | Dynamic dispatch, reflection, decorators, registries, and framework wiring by name. Generated code. Other languages in the repository that call the symbol. Files in `skippedFiles`. Consumers outside the repository. Names that two declarations share. |
| `single-use` | Uses through an alias, a re-export, a macro, or a string. A use inside a comment or a string that the script counts as a use (it hides a candidate). Overloads. |
| `single-impl` | Implementations that the text pattern does not match: structural typing (Go, TypeScript object literals), multi-line class headers, Julia and Rust blanket methods, test doubles in other files. Read the code. |
| `forwarder` | Whether the arguments are the caller's own, and whether the forwarder adapts a type, an error, or a name. |
| `reviewer` | Layers made of several declarations, each with one use. |

### 6. Report

Compose the findings as JSON and pipe them to `report`, which validates and
summarizes them. Do not create the input file inside the repository.

```bash
node <skill-dir>/scripts/scan.mjs report - --out /tmp/single-use.json <<'EOF'
{"skippedFiles": [], "excludedDirs": [], "findings": [ ... ]}
EOF
```

`report` checks the shape, counts, ranks, and writes the named file. It refuses
to replace a file that is not an earlier findings file. It exits 1 when at least
one finding is reported, 0 when none, 2 on invalid input.

Each finding has `id`, `source` (`script` for a candidate that the script
listed and you confirmed, `reviewer` for one you found), `check`, `severity`,
`file`, `line`, `symbol`, `evidenceSource` (`lsp`, `text`, `read`, or a list),
`evidence`, `proposal`, `refused`, `consumerVerdict`, `judgment`, and
`judgmentReason`. Add the fields below when they apply.

| Field | When |
| ----- | ---- |
| `reason` | `refused` is true. A gate id. The `proposal` is `"none"`. |
| `gates` | The finding is reported with gates. Judgment is `downgraded` and severity is `low`. |
| `testsNamed` | `gates` has `has-own-tests`. The tests that call the symbol. |
| `raiseReason` | Severity is above `low`. |

The summary to the user has:

- the counts,
- each candidate with its judgment and the reason,
- the reported findings, ranked by severity then path, each with the evidence
  sources, file, line, and proposal,
- the `source: reviewer` findings in the same form,
- the refusals worth a look, with the gate id. A `public-api` refusal on a
  symbol with no outside consumer is worth a question to the user.

## Refuse when

- A gate other than `has-own-tests` applies, and the judgment pass does not
  overturn it with `lsp` or `read` evidence written in `judgmentReason`.
- The consumer verdict is anything but `internal-only`, `not-exported`, or
  `user-stated-internal`.
- A skipped file or excluded directory might hold a second use and you cannot
  open it.
- The roots are unclear and the user did not answer.
- The same change is already proposed elsewhere in the run.
