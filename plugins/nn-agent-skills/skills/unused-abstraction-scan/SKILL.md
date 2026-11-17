---
name: unused-abstraction-scan
description: >-
  Find TypeScript indirection that no production code reads: an options field
  whose own doc comment says it has no effect, an options type that declares no
  fields but appears in signatures, and an options parameter the lint config
  marks as deliberately unread whose type nothing reads. A bundled script finds
  the candidates and checks the readers and the consumers; every finding comes
  with evidence, and a symbol that may be used outside its package is reported
  as a refusal, not as a deletion. Use when asked to find unused abstractions,
  inert options, dead configuration fields, or pointless parameters, or to
  simplify over-built TypeScript interfaces. It does not report an abstraction
  that has one caller.
---

# Unused Abstraction Scan

Some indirection has no consumer: a field that nothing reads, an options type
with no fields, a parameter the implementation ignores. This skill finds it and
proposes the smallest deletion, with the evidence that no code needs it.

`scripts/scan.mjs` finds candidates. `references/checks.md` lists each check,
what it can and cannot see, and the signals that are not checks. Do not
compute the candidates by hand.

## Run the scan

Run from inside the target repository. The script needs Node 20 or later and
no packages. It reads TypeScript sources only (`.ts`, `.tsx`, `.mts`, `.cts`).

```bash
node <skill-dir>/scripts/scan.mjs --out unused-abstraction.json
```

| Option | Effect |
| ------ | ------ |
| `--scope <path>` | Report only declarations under the path. Readers are searched in the whole tree. Repeatable. |
| `--out <file>` | Write the findings JSON to the file and print a short ranked summary. Without it the JSON goes to stdout. |
| `--offline` | Do not call `gh`. |
| `--assume-unpublished` | Treat every package as unpublished. Use only when the user says no package leaves the repository. |
| `--ignore-pattern <re>` | Name pattern for a deliberately unread parameter. |

Exit status: 0 nothing reported, 1 at least one finding reported, 2 the scan
could not run. Refusals alone give 0.

Write the `--out` file outside the repository or delete it after use. Do not
commit it.

## What the scan checks

| Check | Fires on |
| ----- | -------- |
| `inert-doc` | A declaration whose comment says "is not implemented", "has no effect", "is accepted but", or "does nothing". |
| `unread-param` | A parameter that matches the lint config's `argsIgnorePattern` (default `^_`) and has "option" or "opts" in its name, whose type has fields no production code reads. |
| `empty-options` | An `interface X {}` that annotates parameters or fields. |

The script finds repository conventions at run time:

- The ignore pattern comes from the first `argsIgnorePattern` in an ESLint
  config file or `package.json`. The output records which file it came from.
- A file is a test when it matches `*.test.*`, `*.spec.*`, or sits under
  `__tests__`, `__mocks__`, `test`, `tests`, or `e2e`. Tests never make a
  field live.
- The nearest `package.json` defines a package. `"private": true` marks it
  unpublished. Workspaces need no configuration.
- Files come from `git ls-files`, so `.gitignore` applies. The script does not
  follow symlinks. A link to a file inside the tree is ignored, because the
  target is scanned as itself. A link to a file outside the tree, a file over
  2 MB, or an unreadable file goes in `skippedFiles`. It may hold a reader, so
  a run with skipped files refuses every proposal.

A reader is a member access (`.name`), a quoted key, or a name inside a
destructuring pattern. A caller that writes `{ name: true }` and a declaration
`name: boolean` read nothing, so they do not count.

## Evidence

A finding is reported only when all of these hold:

1. The check fired.
2. No production code reads the field, or any field of the parameter's type.
3. The consumer verdict for the owning interface is `internal-only`.
4. The interface is not part of an `extends` relation, a merged declaration, or
   an augmentation.
5. For `unread-param`, the type has no use except as the type of ignored
   parameters. For `empty-options`, every use is an optional parameter
   (`name?: X`), because `{}` accepts any non-nullish value and removing a
   required parameter or a field type changes what callers may pass.
6. No source file was skipped.

The verdict is quoted in `evidence`. The values:

| Verdict | Meaning |
| ------- | ------- |
| `internal-only` | The package is private, or the user passed `--assume-unpublished`, and no other package in the repository names the symbol. |
| `exported-with-hits` | Another package in the repository names the symbol, or `gh search code` finds it in another repository. |
| `exported-no-hits` | The package is published and `gh search code` found nothing. The code index is incomplete, so this is a refusal. |
| `unknown` | The question could not be asked: `--offline`, no `gh`, no login, an unnamed package, or more than 10 symbols. This is a refusal. |

Only `internal-only` clears an edit. The verdict says whether the interface
leaves its package under that name. A caller can still pass the field in an
object literal to a published function without naming the interface, and it
fails at that caller's type check. Run the repository's type check after
every edit.

If a `DESIGN.md`, `ARCHITECTURE.md`, `README.md`, or the file's leading comment
names the target, the script quotes the line into `evidence`. It does not refuse
because of it. Read the quote and weigh it against the reader count.

## Output

The findings JSON has `tool`, `scope`, `ignorePattern`, `skippedFiles`,
`counts`, and `findings`. Each finding has `id`, `check`, `severity`, `file`,
`line`, `symbol`, `signal`, `evidence`, `proposal`, and `refused`. A refusal
also has `reason`, and its `proposal` is `"none"`.

Report to the user:

- the counts,
- the reported findings, ranked by severity then path, each with file, line,
  proposal, and the evidence in one line,
- the refusals worth a look. A comment that says "no effect" next to code that
  reads the field is one: the comment and the code disagree and a person
  decides which is wrong.

## Edits

Edit only when the user asks. Then fix one finding at a time:

- `inert-doc` on a field: delete the field. Show the user each test the
  proposal names before you change it. A test that asserts the inert field may
  record intended behavior, so the user decides whether to edit or remove it.
  When the interface has no fields left, it becomes an
  `empty-options` candidate on the next run. Remove it as a separate change,
  because it changes the signatures typed by it.
- `unread-param`: drop the parameter and its options type.
- `empty-options`: delete the type and the parameters typed by it.

After each edit, find the repository's type-check and test commands (the
`package.json` scripts, or `tsc --noEmit` with the nearest `tsconfig.json`)
and run them on the affected packages. A reader the scan missed fails there.
Check machine load before a full type check or test run.

## Refuse when

- The verdict is anything but `internal-only`. Keep the finding as a
  refusal and quote the verdict.
- Production code reads the field.
- One function ignores an option that other functions read. That function does
  not need it, and the option is live.
- The only readers are tests. A test that asserts an inert field is a finding
  for test review, not for this skill. Name the test in the proposal.
- The same deletion is already reported elsewhere in the run.
- The shape exists to isolate a seam. A wrapper with one caller is not a
  candidate: the indirection is the point, and the file or its docs usually
  say so.
