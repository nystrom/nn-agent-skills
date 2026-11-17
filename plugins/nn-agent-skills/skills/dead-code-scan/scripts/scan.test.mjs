// Run with: node --test plugins/nn-agent-skills/skills/dead-code-scan/scripts/
//
// Builds a small repository in a temp dir and runs scan.mjs over it. The scan
// needs the `typescript` package. Tests that parse code look for it through
// TYPESCRIPT_DIR (the package directory) or the normal module path, and skip
// when they find none.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scan = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

function findTypescript() {
  if (process.env.TYPESCRIPT_DIR && existsSync(process.env.TYPESCRIPT_DIR)) {
    return process.env.TYPESCRIPT_DIR;
  }
  try {
    return dirname(createRequire(import.meta.url).resolve("typescript/package.json"));
  } catch {
    return undefined;
  }
}

const tsDir = findTypescript();
const needsTs = { skip: tsDir === undefined ? "typescript package not found" : false };

function tempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), "dead-code-scan-")));
}

function put(root, files) {
  for (const [file, text] of Object.entries(files)) {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof text === "string" ? text : JSON.stringify(text));
  }
}

function repo(files, { typescript = true } = {}) {
  const root = tempDir();
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/fx.git"], { cwd: root });
  put(root, files);
  if (typescript && tsDir !== undefined) {
    mkdirSync(join(root, "node_modules"));
    symlinkSync(tsDir, join(root, "node_modules", "typescript"));
  }
  return root;
}

function scanRepo(root, args = [], env = {}) {
  const result = spawnSync("node", [scan, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  let document;
  try {
    document = JSON.parse(result.stdout);
  } catch {
    document = undefined;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, document };
}

const FAST = ["--pace-ms", "0", "--retry-ms", "0"];

const fixture = {
  "package.json": { name: "root", private: true },
  "pkg-pub/package.json": { name: "pub", exports: { ".": "./dist/index.js" } },
  "pkg-pub/src/index.ts":
    'export { Shown } from "./shown";\nexport default function defaulted() {}\n',
  "pkg-pub/src/shown.ts": "export function Shown() {}\nexport const Exposed = 1;\n",
  "pkg-pub/src/internal/dead.ts": [
    "export function deadFn() {}",
    "export interface Member {}",
    "export type Union = Member | string;",
    "export function used() {}",
    "export const _ignored = 1;",
    "export const registered = register();",
    "export const keptName = 1;",
    "export default function defaultOnly() {}",
    "",
  ].join("\n"),
  "pkg-pub/src/internal/consumer.ts":
    'import { used, Union } from "./dead";\nconst consumerValue: Union = used;\n',
  "pkg-pub/src/internal/index.ts":
    'export { barrelDead } from "./barrel-dead";\nexport { used } from "./dead";\n',
  "pkg-pub/src/internal/barrel-dead.ts": "export function barrelDead() {}\n",
  "pkg-pub/src/internal/dead.test.ts": "export const inTest = 1;\n",
  "pkg-pub/src/documented/README.md": "The documented set.\n",
  "pkg-pub/src/documented/thing.ts": "export const Documented = 1;\n",
  "pkg-private/package.json": { name: "priv", private: true },
  "pkg-private/src/a.ts": "export function privDead() {}\n",
  "pkg-private2/package.json": { name: "priv2", private: true },
  "pkg-private2/src/a.ts": "export function priv2Dead() {}\n",
  "pkg-open/package.json": { name: "open" },
  "pkg-open/src/b.ts": "export function openFn() {}\n",
};

function bySymbol(document) {
  return new Map(document.findings.map((f) => [f.symbol, f]));
}

test("--help prints usage and exits 0", () => {
  const result = scanRepo(tempDir(), ["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: scan\.mjs/);
});

test("an unknown option exits 2", () => {
  const result = scanRepo(tempDir(), ["--nope"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option/);
});

test("outside a git repository exits 2", () => {
  const result = scanRepo(tempDir());
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not inside a git repository/);
});

test("a missing typescript package exits 2 with a message", () => {
  const root = repo({ "package.json": { name: "x" } }, { typescript: false });
  const result = scanRepo(root, [], { NODE_PATH: "" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot resolve the "typescript" package/);
});

test("an empty repository reports nothing and exits 0", needsTs, () => {
  const result = scanRepo(repo({}));
  assert.equal(result.status, 0);
  assert.deepEqual(result.document.counts, { candidates: 0, refused: 0, reported: 0 });
});

test("reports internal dead exports and refuses the rest", needsTs, () => {
  const result = scanRepo(repo(fixture), ["--no-external", "--keep", "keptName"]);
  assert.equal(result.status, 1);
  const found = bySymbol(result.document);
  const reported = [...found.values()].filter((f) => !f.refused).map((f) => f.symbol);
  assert.deepEqual(reported.sort(), ["barrelDead", "deadFn", "priv2Dead", "privDead"]);
  assert.equal(found.get("barrelDead").check, "dead-barrel-reexport");
  assert.equal(found.get("deadFn").check, "dead-export");
  assert.equal(found.get("Exposed").category, "published");
  assert.equal(found.get("Shown").category, "published");
  assert.equal(found.get("openFn").category, "published");
  assert.equal(found.get("_ignored").category, "underscore-name");
  assert.equal(found.get("registered").category, "side-effect-initializer");
  assert.equal(found.get("keptName").category, "kept-by-caller");
  assert.equal(found.get("Documented").category, "doc-in-directory");
  // Used, default-exported, aliased through a union, or in a test file: no candidate.
  for (const name of ["used", "Member", "Union", "defaulted", "defaultOnly", "inTest"]) {
    assert.equal(found.has(name), false, name);
  }
});

test("--scope limits declarations at a path boundary", needsTs, () => {
  const result = scanRepo(repo(fixture), ["--no-external", "--scope", "pkg-private"]);
  assert.deepEqual(
    result.document.findings.map((f) => f.symbol),
    ["privDead"]
  );
});

test("--out writes the document to a file", needsTs, () => {
  const root = repo(fixture);
  const out = join(root, "..", `${Date.now()}-out.json`);
  const result = scanRepo(root, ["--no-external", "--out", out]);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(readFileSync(out, "utf8")).tool, "dead-code-scan");
});

test("a symlink in the tree is skipped", needsTs, () => {
  const root = repo(fixture);
  symlinkSync(join(root, "pkg-private"), join(root, "linked"));
  const result = scanRepo(root, ["--no-external", "--scope", "pkg-private"]);
  assert.equal(result.status, 1);
});

test("without gh every internal candidate is refused as unknown", needsTs, () => {
  const result = scanRepo(repo(fixture), FAST, { DEAD_CODE_SCAN_GH: "/nonexistent/gh" });
  assert.equal(result.status, 0);
  const found = bySymbol(result.document);
  assert.equal(found.get("privDead").verdict, "unknown");
  assert.match(found.get("privDead").evidence, /gh is not installed/);
  assert.equal(result.document.counts.reported, 0);
});

/** A gh stand-in: `names` map to hits, `fail` names exit 1, the rest have none. */
function fakeGh(hits, fail = []) {
  const dir = tempDir();
  const script = join(dir, "gh");
  const cases = Object.entries(hits)
    .map(
      ([name, repoName]) =>
        `${name}) echo '[{"repository":{"nameWithOwner":"${repoName}"},"path":"x.ts"}]';;`
    )
    .join("\n");
  const failures = fail.map((name) => `${name}) echo 'rate limited' >&2; exit 1;;`).join("\n");
  writeFileSync(
    script,
    `#!/bin/sh
case "$1" in
  --version) exit 0;;
  auth) exit 0;;
  search) case "$3" in
${cases}
${failures}
  *) echo '[]';;
  esac;;
esac
`
  );
  chmodSync(script, 0o755);
  return script;
}

test("a hit in another repository refuses; a hit in this one does not", needsTs, () => {
  const gh = fakeGh({ privDead: "acme/other", priv2Dead: "acme/fx" });
  const result = scanRepo(repo(fixture), ["--keep", "keptName", ...FAST], { DEAD_CODE_SCAN_GH: gh });
  const found = bySymbol(result.document);
  assert.equal(found.get("privDead").verdict, "exported-with-hits");
  assert.match(found.get("privDead").evidence, /acme\/other:x\.ts/);
  assert.equal(found.get("priv2Dead").refused, false);
  assert.equal(found.get("deadFn").refused, false);
});

test("a failed search is unknown, and the symbol is refused", needsTs, () => {
  const gh = fakeGh({}, ["deadFn"]);
  const result = scanRepo(repo(fixture), FAST, { DEAD_CODE_SCAN_GH: gh });
  const found = bySymbol(result.document);
  assert.equal(found.get("deadFn").verdict, "unknown");
  assert.equal(found.get("deadFn").refused, true);
  assert.equal(found.get("privDead").refused, false);
});

test("--max-external refuses the symbols past the limit", needsTs, () => {
  const gh = fakeGh({});
  const result = scanRepo(repo(fixture), ["--max-external", "1", ...FAST], { DEAD_CODE_SCAN_GH: gh });
  const verdicts = result.document.findings
    .filter((f) => f.verdict === "unknown")
    .map((f) => f.evidence);
  assert.ok(verdicts.length > 0);
  assert.match(verdicts[0], /search limit of 1/);
});

test("a repository with no package.json refuses as unknown", needsTs, () => {
  const root = repo({ "src/a.ts": "export function lone() {}\n" });
  const result = scanRepo(root, ["--no-external"]);
  assert.equal(result.status, 0);
  assert.equal(result.document.findings[0].verdict, "unknown");
});

test("effectful initializers and sibling declarators are refused", needsTs, () => {
  const root = repo({
    "package.json": { name: "x", private: true },
    "src/a.ts": [
      "export const arr = [register()];",
      "export const obj = { k: register() };",
      "export const cast = register() as number;",
      "export const okPlain = { a: [1, -2], f: () => 1 };",
      "export const first = 1, second = register();",
      "export class Cls { static x = register(); }",
      "export enum E { A = compute() }",
      "export class PlainCls { y = 1; }",
      "",
    ].join("\n"),
  });
  const found = bySymbol(scanRepo(root, ["--no-external"]).document);
  for (const name of ["arr", "obj", "cast", "first", "second", "Cls", "E"]) {
    assert.equal(found.get(name).category, "side-effect-initializer", name);
  }
  assert.equal(found.get("okPlain").refused, false);
  assert.equal(found.get("PlainCls").refused, false);
});

test("--scope . means the whole repository", needsTs, () => {
  const result = scanRepo(repo(fixture), ["--no-external", "--scope", "."]);
  assert.equal(result.document.counts.reported, 5);
});

test("an unwritable --out exits 2", needsTs, () => {
  const result = scanRepo(repo(fixture), ["--no-external", "--out", "/nonexistent-dir/x.json"]);
  assert.equal(result.status, 2);
});

test("a manifest entry no source file maps to makes the surface unknown", needsTs, () => {
  const root = repo({
    "package.json": { name: "x", exports: { ".": "./dist/main.js" } },
    "src/index.ts": "export function a() {}\n",
    "src/other.ts": "export function other() {}\n",
  });
  const found = bySymbol(scanRepo(root, ["--no-external"]).document);
  assert.equal(found.get("other").verdict, "unknown");
  assert.match(found.get("other").evidence, /no source file maps/);
});

test("a re-export through an alias makes the surface unknown", needsTs, () => {
  const root = repo({
    "package.json": { name: "x", exports: { ".": "./dist/index.js" } },
    "src/index.ts": 'export * from "@/lib";\n',
    "src/lib/index.ts": "export function viaAlias() {}\n",
    "src/other.ts": "export function other() {}\n",
  });
  const found = bySymbol(scanRepo(root, ["--no-external"]).document);
  assert.equal(found.get("other").verdict, "unknown");
  assert.match(found.get("other").evidence, /cannot follow/);
});

test("a capped search with no other repository visible is unknown", needsTs, () => {
  const gh = join(tempDir(), "gh");
  writeFileSync(
    gh,
    `#!/bin/sh
case "$1" in
  --version|auth) exit 0;;
  search) printf '['; i=0
    while [ $i -lt 100 ]; do
      [ $i -gt 0 ] && printf ','
      printf '{"repository":{"nameWithOwner":"acme/fx"},"path":"f%s.ts"}' $i
      i=$((i+1))
    done
    printf ']';;
esac
`
  );
  chmodSync(gh, 0o755);
  const root = repo({
    "package.json": { name: "x", private: true },
    "src/a.ts": "export function capped() {}\n",
  });
  const found = bySymbol(scanRepo(root, FAST, { DEAD_CODE_SCAN_GH: gh }).document);
  assert.equal(found.get("capped").verdict, "unknown");
});

test("class heritage and computed names count as effects", needsTs, () => {
  const root = repo({
    "package.json": { name: "x", private: true },
    "src/a.ts": [
      "export class Ext extends mixin() {}",
      "export class Comp { [key()]() {} }",
      "export class Sub extends Base {}",
      "export const o = { [k()]() {} };",
      "",
    ].join("\n"),
  });
  const found = bySymbol(scanRepo(root, ["--no-external"]).document);
  for (const name of ["Ext", "Comp", "o"]) {
    assert.equal(found.get(name).category, "side-effect-initializer", name);
  }
  assert.equal(found.get("Sub").refused, false);
});

test("an invalid nested package.json does not inherit the parent verdict", needsTs, () => {
  const root = repo({
    "package.json": { name: "x", private: true },
    "inner/package.json": "{ not json",
    "inner/src/a.ts": "export function innerFn() {}\n",
  });
  const found = bySymbol(scanRepo(root, ["--no-external"]).document);
  assert.equal(found.get("innerFn").verdict, "unknown");
});

test("a re-export of a declared dependency is followed past", needsTs, () => {
  const root = repo({
    "package.json": {
      name: "x",
      exports: { ".": "./dist/index.js" },
      dependencies: { lodash: "1" },
    },
    "src/index.ts": 'export * from "lodash";\nexport { x } from "node:path";\n',
    "src/other.ts": "export function other() {}\n",
  });
  const found = bySymbol(scanRepo(root, ["--no-external"]).document);
  assert.equal(found.get("other").refused, false);
});

test("a root scope among several scopes means the whole repository", needsTs, () => {
  const result = scanRepo(repo(fixture), ["--no-external", "--scope", ".", "--scope", "pkg-private"]);
  assert.equal(result.document.counts.reported, 5);
});
