# Rules file and edge list

Both are JSON. `scripts/check.mjs` rejects a rules file with an unknown key or a
wrong type and exits 2.

## Rules file

Build it from the repo's docs and lint config. Show it to the user and get it
confirmed. Every key is optional; a check whose data is absent is skipped.

```json
{
  "source_docs": ["docs/architecture.md"],
  "test_globs": ["**/*_test.go", "tests/**"],
  "barrel_globs": ["**/index.ts", "**/__init__.py"],
  "layers": [
    { "name": "app", "paths": ["app/**"] },
    { "name": "lib", "paths": ["lib/**"] },
    { "name": "util", "paths": ["util/**"] }
  ],
  "allow": { "app": ["lib", "util"], "lib": ["util"], "util": [] },
  "packages": [
    { "name": "app", "root": "app", "depends": ["lib"], "import_names": ["acme-app"] },
    { "name": "lib", "root": "lib", "depends": [] }
  ],
  "unchecked": [{ "globs": ["legacy/**"], "reason": "the type checker skips" }],
  "refuse": [{ "check": "foreign-barrel-reexport", "glob": "src/compat/**", "reason": "keeps the published surface" }]
}
```

| Key | Meaning |
| --- | ------- |
| `source_docs` | Documents the rules came from. Informational. |
| `test_globs` | Replaces the default test name patterns. Add directory conventions here (`tests/**`, `test/**`); they are not safe defaults. |
| `barrel_globs` | Replaces the default barrel files (`index.*`, `__init__.py`, `mod.rs`). |
| `layers` | Named layers with path globs. The first layer that matches a file claims it. |
| `allow` | Per layer, the layers it may import. A layer may always import itself. A layer absent from `allow` may import nothing outside itself. |
| `packages` | `root` is the package directory. `depends` lists declared dependencies by package name. `import_names` are the names other code imports it by (default: `name`). |
| `unchecked` | Globs of source files that the repo's checkers skip, with the reason. |
| `refuse` | Known intended exceptions: a check name and a file glob. Matching findings are marked `refused`. |

Globs support `*` (one segment), `**` (any depth), and `{a,b}`. Paths are
relative to the repo root.

## Edge list

A JSON array. `edges.mjs` writes it; a language server session can write it too.

```json
[{ "from": "app/main.py", "to": "lib/core.py", "specifier": "lib.core",
   "line": 1, "kind": "import", "evidence_source": "lsp" }]
```

| Field | Meaning |
| ----- | ------- |
| `from` | Importing file, relative to the root. |
| `to` | Target file in the repo, or `null` when external or unresolved. |
| `specifier` | The import text. Used to match `import_names` when `to` is `null`. |
| `line` | Line of the import, from 1. |
| `kind` | `import`, or `reexport` for an export-from or `pub use`. |
| `evidence_source` | `lsp` or `text`. Default `text`. |
