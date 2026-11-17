---
name: unhandled-case-scan
description: >-
  Find the places in a TypeScript repository where a case can go unhandled and
  neither lint nor the compiler says so: a `switch` over a finite union of
  literals or enum members that has no `default`, whose missing case would
  widen the function's inferred return type instead of failing the build, and
  an empty `catch` that does not say why the error is ignored. Reads types
  with the repository's own `typescript` package and refuses every site the
  compiler already guards. Reports findings and proposes edits; edits only
  when asked. Use when asked about exhaustive switches, unhandled union cases,
  adding an exhaustiveness check, `assertNever`-style helpers, swallowed
  errors, or empty catch blocks.
---

# Unhandled Case Scan

The rule: a `switch` over a finite union handles every case or fails the
build, and an empty `catch` states why. This skill finds the sites that break
the rule and that the compiler does not already report.

Most sites that look like gaps are not. TypeScript reports a new union member
in several ways, and a partial dispatch over a large union is often the
design. The scan asks the type checker before it reports. Read
`references/checks.md` for the bound of each check and for the checks that are
not made.

## Inputs

- **Scope**: the whole repository (default), or one or more subtrees.
- **Mode**: `report` (default) prints findings and a ranked summary. `fix`
  applies the proposals. Use `fix` only when the user asks for edits.

## Signal

`scripts/scan.mjs` is Node ESM and runs on Node 20 or later. It resolves
`typescript` from the target repository's working directory and exits 2 with a
message when the package is absent. Run it from inside the target repository.

```bash
node <skill-dir>/scripts/scan.mjs --out /tmp/unhandled-case-scan.json
node <skill-dir>/scripts/scan.mjs --scope src/lib --out findings.json
```

| Option | Meaning |
| ------ | ------- |
| `--scope <path>` | Restrict to a subtree. Repeatable. Resolved against the working directory. A scope outside the repository, or one that matches no scanned file, exits 2. |
| `--project <tsconfig>` | Scan this config instead of discovering them. Repeatable. |
| `--out <file>` | Write the findings document here. Without it the document goes to stdout. The ranked summary always goes to stderr. |

Exit codes: 0 when nothing is reported, 1 when findings are reported, 2 when
the scan could not run. A refused candidate does not change the exit code.

The scan finds every `tsconfig.json` under the repository root. It does not
enter `node_modules`, build output, hidden directories, or symlinked
directories. Pass `--project` for a config it cannot reach. It builds one program per
config and analyzes each file under the deepest config that lists it. Each
config is read as the repository's compiler would read it, so `extends`,
`paths`, and `strict` apply. The run needs no build output. A config with
errors, such as an unreadable file or an `extends` that does not resolve, is
listed under `skipped`, and the scan reports nothing about its files. A root
file over 1 MiB is skipped the same way.

| Check | Fires on |
| ----- | -------- |
| `no-default` | A `switch` with no `default` whose unhandled case would widen the enclosing function's inferred return type. |
| `empty-catch` | A `catch` block, or a `.catch(() => {})` handler, with no statements. |

Production code only: `.ts`, `.tsx`, `.mts`, `.cts`. Declaration files,
`*.test.*`, `*.spec.*`, and paths with a `test`, `tests`, `__tests__`, or
`__mocks__` segment are not scanned.

## Findings document

A JSON object with `counts`, `skipped`, `exhaustiveness_helpers`, and
`findings`. Reported findings come first, ranked by severity, then refused
ones. Each finding has `id`, `check`, `file`, `line`, `severity`, `signal`,
`evidence`, `refused`, and `proposal`. A refused finding also has a `reason`,
and its `proposal` is "none". A function name appears as `symbol` when the
function has a plain name.

After the run, show the user the summary: counts, the helper found, and the
reported findings in rank order. Do not paste refused findings; give their
count and offer the file.

## Exhaustiveness helper

The scan looks for the repository's helper by signature: a function whose
first parameter has type `never`, called in a `default` clause. It does not
match on a name. The most-used helper becomes the proposal. When no `default`
clause calls one, the proposal is a `const _exhaustive: never = <narrowed value>`
in a new `default`. The narrowed value is the switched-on expression, or its
object when the union is discriminated by that property: for
`switch (shape.kind)` pass `shape`, because `shape.kind` is not valid when
`shape` has narrowed to `never`. Check that the helper is imported in the file
before applying the edit, and that it throws, so the `default` also fails at
run time.

## Evidence

A finite union is the checker's answer, not a list of property names. A
`kind` typed `"a" | "b"` is a union of literals, and a missing case is a gap.
A name read from input is `string`, and a fallback there is the design.

A `no-default` finding must also survive every way TypeScript already reports
a new case. Two adjacent functions can switch on the same field of the same
union, and only the one with a declared return type gets error TS2366 when
the union grows. So the scan reports a switch only when it is the last
statement of its function, every clause exits, and nothing constrains the
function's return type: no annotation, and no contextual type from a call it
is a callback to.

Severity is `medium`, not `high`. Widening the inferred return type still
produces errors where callers use the result, so the diagnostic is misplaced
and not absent. The proposal moves it to the definition. An unexplained empty
`catch` is `high`.

## Transform

One edit per site:

- `no-default`: add the `default` the proposal names, then run the type
  checker. It names the case that is now unhandled. Handle the case, or tell
  the user the switch was a partial dispatch.
- `empty-catch`: handle or report the error, or write the reason the failure
  is not worth reporting.

Do not add a `default` that returns an empty value to silence a `no-default`
finding. That keeps the widened return type and removes the diagnostic the fix
exists to move.

## Refuse when

Each refusal appears in the findings with its reason. For `no-default`:

- **The switched-on type is not a union of literal types.** An open domain.
  Falling through is the design.
- **An exhaustiveness check follows the switch.** A helper call or a
  `const x: never = v` after the clauses closes the union as a `default` would.
- **Control continues past the switch.** A clause that `break`s, falls through
  an `if`, or a statement after the switch makes the clauses a partial dispatch
  with a fallback behind them.
- **The enclosing function declares a return type.** A type that excludes an
  absent value gives TS2366 on a new case. A type that admits one makes the
  unhandled case part of the contract.
- **The function is a callback whose contextual return type excludes an absent
  value.** A new case is a type error at the call that passes it. A callback
  typed to return `void`, `unknown`, or `any` is not refused.
- **`strictNullChecks` is off** for the project. The inferred return type does
  not widen.
- **The inferred return type already admits an absent value.**

For `empty-catch`: the body holds a comment. The comment states the intent the
rule asks for.

## Verify

A report-only run edits nothing and needs no verification. After a fix:

1. Run the repository's type check. If the union has an unhandled case, the
   new `default` makes it fail and name that case.
2. Run the tests of the package the edit touched.
3. Run the scan again on the same scope. The fixed site must be gone.

If the repository's tests do not cover the changed file, say so in the
summary. Do not call the edit verified.
