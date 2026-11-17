// Run with: node --test plugins/nn-agent-skills/skills/dead-code-code-review/scripts/
//
// Builds small repositories in a temp dir and runs scan.mjs over them. Needs
// Node and git only. The fixtures cover TypeScript, Python, Go, Rust, Java, C,
// and Julia declaration lines, which is the extent of what these tests verify.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scan = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

function tempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), "dead-code-code-review-")));
}

function repo(files) {
  const root = tempDir();
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/fx.git"], { cwd: root });
  for (const [file, text] of Object.entries(files)) {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof text === "string" ? text : JSON.stringify(text));
  }
  return root;
}

function run(root, args = [], env = {}) {
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

const FAST = ["--pace-ms", "0", "--retry-ms", "0", "--not-public", "."];
const ext = ["--no-external"];
// The user said nothing here is public API, so publication does not refuse.
const local = [...ext, "--not-public", "."];

const bySymbol = (document) => new Map(document.findings.map((f) => [f.symbol, f]));
const names = (document, refused) =>
  document.findings.filter((f) => f.refused === refused).map((f) => f.symbol).sort();

const fixture = {
  "package.json": { name: "web", private: true },
  "src/ts.ts": [
    "export function tsDead() {}",
    "export default function dflt() {}",
    "export const _hidden = 1;",
    "export function tsUsed() {}",
    "export const reg = register();",
    "export const okArrow = () => 1;",
    "function tsLocal() {}",
    "",
  ].join("\n"),
  "src/ts-user.ts": 'import { tsUsed } from "./ts";\ntsUsed();\n',
  "py/mod.py": "def py_dead():\n    pass\n\ndef _py_private():\n    pass\n\nclass PyDead:\n    def method(self):\n        pass\n",
  "go/go.mod": "module x\n",
  "go/util.go": "package util\n\nfunc GoDead() {}\nfunc goPrivate() {}\n",
  "rust/Cargo.toml": "[package]\nname = \"r\"\n",
  "rust/src/lib.rs": "pub fn rs_dead() {}\nfn rs_private() {}\n",
  "java/pom.xml": "<project/>\n",
  "java/Foo.java":
    "public class JavaDead {\n  public static void main(String[] args) {}\n}\nclass PkgPrivate {}\nprivate class Hidden {}\n",
  "c/Makefile": "all:\n\tcc foo.c\n",
  "c/foo.h": "struct c_dead { int x; };\n",
  "c/foo.c": "struct c_inner { int y; };\n",
  "jl/Project.toml": "name = \"J\"\n",
  "jl/m.jl": "function jl_dead() end\n",
};

test("--help prints usage and exits 0", () => {
  const result = run(tempDir(), ["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: scan\.mjs/);
});

test("an unknown option exits 2", () => {
  const result = run(tempDir(), ["--nope"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option/);
});

test("outside a git repository exits 2", () => {
  const result = run(tempDir(), local);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not inside a git repository/);
});

test("an empty repository has no candidates and exits 0", () => {
  const result = run(repo({}), local);
  assert.equal(result.status, 0);
  assert.equal(result.document.counts.candidates, 0);
});

test("finds dead declarations in seven languages and skips the rest", () => {
  const result = run(repo(fixture), local);
  assert.equal(result.status, 1);
  assert.deepEqual(names(result.document, false), [
    "GoDead", "JavaDead", "PkgPrivate", "PyDead", "c_dead", "jl_dead", "okArrow", "py_dead", "rs_dead", "tsDead",
  ]);
  const found = bySymbol(result.document);
  assert.equal(found.get("GoDead").language, "go");
  assert.equal(found.get("rs_dead").language, "rust");
  assert.equal(found.get("py_dead").visibility_hint, "public-by-convention");
  assert.equal(found.get("PkgPrivate").visibility_hint, "unknown");
  assert.equal(found.get("tsDead").source, "script");
  assert.equal(found.get("tsDead").evidence_source, "text");
  assert.equal(found.get("tsDead").judgment, null);
  assert.match(found.get("tsDead").proposal, /Proposed change/);
  // Used, default-exported, private, nested, or not in a header: no candidate.
  for (const name of ["dflt", "tsUsed", "tsLocal", "goPrivate", "rs_private", "_py_private", "method", "Hidden", "c_inner"]) {
    assert.equal(found.has(name), false, name);
  }
});

test("the scan writes nothing into the repository", () => {
  const root = repo(fixture);
  const before = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
  const out = join(tempDir(), "findings.json");
  run(root, [...local, "--out", out]);
  const after = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
  assert.equal(after, before);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).tool, "dead-code-code-review");
});

test("--out inside the repository exits 2", () => {
  const root = repo(fixture);
  const result = run(root, [...local, "--out", join(root, "findings.json")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /inside the repository/);
});

test("an unwritable --out exits 2", () => {
  const result = run(repo(fixture), [...local, "--out", "/nonexistent-dir/x.json"]);
  assert.equal(result.status, 2);
});

test("local refusals carry a category", () => {
  const root = repo({
    ...fixture,
    "docs/README.md": "documented set\n",
    "docs/thing.ts": "export const Documented = 1;\n",
    "examples/demo.ts": "export function demoOnly() {}\n",
    "tests/helper.py": "def helper_dead():\n    pass\n",
  });
  const found = bySymbol(run(root, [...local, "--keep", "tsDead"]).document);
  assert.equal(found.get("tsDead").category, "kept-by-caller");
  assert.equal(found.get("_hidden").category, "underscore-name");
  assert.equal(found.get("reg").category, "side-effect-initializer");
  assert.equal(found.get("Documented").category, "doc-in-directory");
  assert.equal(found.get("demoOnly").category, "test-support");
  assert.equal(found.has("helper_dead"), false);
});

test("a name used only from a test, a config, a build file, or a doc is live", () => {
  const root = repo({
    "package.json": { name: "web", main: "dist/index.js", bin: { tool: "./bin/tool.js" } },
    "src/a.ts": [
      "export function fromTest() {}",
      "export function fromConfig() {}",
      "export function fromBuild() {}",
      "export function fromDoc() {}",
      "export function trulyDead() {}",
      "",
    ].join("\n"),
    "src/a.test.ts": "fromTest();\n",
    "vite.config.ts": "fromConfig();\n",
    "Makefile": "run:\n\tnode scripts/gen.js # fromBuild\n",
    "scripts/gen.js": "console.log(1);\n",
    "docs/guide.md": "Call fromDoc to start.\n",
    "go/go.mod": "module x\n",
    "go/main.go": "package main\n\nfunc main() {}\n",
    "py/run.py": 'if __name__ == "__main__":\n    pass\n',
  });
  const result = run(root, local);
  assert.deepEqual(names(result.document, false), ["trulyDead"]);
  const kinds = result.document.roots.found.map((r) => r.id);
  for (const kind of [
    "manifests", "package-entry", "main-entry", "build-and-ci-references", "tests", "tool-configs", "docs-and-data", "other-repositories",
  ]) {
    assert.ok(kinds.includes(kind), kind);
  }
  const main = result.document.roots.found.find((r) => r.id === "main-entry").detail;
  assert.match(main, /go\/main\.go/);
  assert.match(main, /py\/run\.py/);
});

test("dynamic loading refuses candidates in its package until the root is accepted", () => {
  const root = repo({
    "a/package.json": { name: "a" },
    "a/loader.py": "import importlib\nmod = importlib.import_module(name)\n",
    "a/mod.py": "def loaded_dead():\n    pass\n",
    "b/pyproject.toml": "[project]\nname = 'b'\n",
    "b/mod.py": "def other_dead():\n    pass\n",
  });
  const first = run(root, local).document;
  assert.equal(bySymbol(first).get("loaded_dead").category, "unevaluated-root");
  assert.equal(bySymbol(first).get("other_dead").refused, false);
  assert.ok(first.roots.unresolved.some((r) => r.id === "dynamic-loading"));
  const accepted = run(root, [...local, "--accept-root", "dynamic-loading"]).document;
  assert.equal(bySymbol(accepted).get("loaded_dead").refused, false);
  assert.ok(accepted.roots.found.some((r) => r.id === "dynamic-loading"));
});

test("an unknown --accept-root exits 2", () => {
  const result = run(repo(fixture), [...local, "--accept-root", "nope"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no such unresolved root/);
});

test("a framework convention is an unresolved root", () => {
  const root = repo({
    "package.json": { name: "site", dependencies: { next: "14" } },
    "pages/index.ts": "export function getServerSideProps() {}\n",
  });
  const document = run(root, local).document;
  assert.equal(bySymbol(document).get("getServerSideProps").category, "unevaluated-root");
  assert.ok(document.roots.unresolved.some((r) => r.id === "framework:next"));
});

test("an FFI export blocks the symbols in its file", () => {
  const root = repo({
    "Cargo.toml": "[package]\nname = \"r\"\n",
    "src/lib.rs": '#[no_mangle]\npub extern "C" fn ffi_fn() {}\npub fn sibling() {}\n',
    "src/other.rs": "pub fn elsewhere() {}\n",
  });
  const found = bySymbol(run(root, local).document);
  assert.equal(found.get("ffi_fn").category, "unevaluated-root");
  assert.equal(found.get("sibling").category, "unevaluated-root");
  assert.equal(found.get("elsewhere").refused, false);
});

test("no manifest leaves every candidate unevaluated", () => {
  const root = repo({ "src/a.py": "def lone():\n    pass\n" });
  const document = run(root, local).document;
  assert.equal(bySymbol(document).get("lone").category, "unevaluated-root");
  assert.ok(document.roots.unresolved.some((r) => r.id === "manifest"));
  assert.equal(run(root, local).status, 1);
});

test("re-exports named by only two files are dead-reexport candidates", () => {
  const root = repo({
    "package.json": { name: "x", private: true },
    "src/index.ts": 'export { reexported } from "./impl";\n',
    "src/impl.ts": "export function reexported() {}\n",
    "pkg/__init__.py": "from .x import y_name\n",
    "pkg/x.py": "def y_name():\n    pass\n",
  });
  const document = run(root, local).document;
  const checks = document.findings.filter((f) => f.check === "dead-reexport").map((f) => `${f.file}:${f.symbol}`);
  assert.ok(checks.includes("src/index.ts:reexported"));
  assert.ok(checks.includes("pkg/__init__.py:y_name"));
});

test("--scope limits declarations at a path boundary; the root means all", () => {
  const root = repo({
    ...fixture,
    "go2/util.go": "package util\n\nfunc Go2Dead() {}\n",
  });
  const scoped = run(root, [...local, "--scope", "go"]).document;
  assert.deepEqual(names(scoped, false), ["GoDead"]);
  const all = run(root, [...local, "--scope", ".", "--scope", "go"]).document;
  assert.ok(names(all, false).length > 5);
});

test("binary files, oversized files, and symlinks do not break the scan", () => {
  const root = repo(fixture);
  writeFileSync(join(root, "blob.bin"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(root, "big.py"), "def big_dead():\n    pass\n" + "# pad\n".repeat(50));
  symlinkSync(join(root, "go"), join(root, "linked"));
  const document = run(root, [...local, "--max-file-bytes", "200"]).document;
  assert.equal(document.binary_file_types[".bin"], 1);
  assert.ok(document.skipped_files.some((s) => s.file === "big.py"));
  assert.equal(bySymbol(document).has("big_dead"), false);
});

test("without gh every candidate is refused as unknown", () => {
  const result = run(repo(fixture), FAST, { DEAD_CODE_SCAN_GH: "/nonexistent/gh" });
  assert.equal(result.status, 1);
  const found = bySymbol(result.document);
  assert.equal(found.get("tsDead").category, "unknown");
  assert.match(found.get("tsDead").evidence, /gh is not installed/);
  assert.ok(result.document.roots.unresolved.some((r) => r.id === "other-repositories"));
});

function fakeGh(body) {
  const script = join(tempDir(), "gh");
  writeFileSync(
    script,
    `#!/bin/sh
case "$1" in
  --version|auth) exit 0;;
  search) case "$3" in
${body}
  *) echo '[]';;
  esac;;
esac
`
  );
  chmodSync(script, 0o755);
  return script;
}

test("a hit in another repository refuses; a hit in this one does not", () => {
  const gh = fakeGh(
    `  GoDead) echo '[{"repository":{"nameWithOwner":"acme/other"},"path":"x.go"}]';;
  rs_dead) echo '[{"repository":{"nameWithOwner":"acme/fx"},"path":"lib.rs"}]';;
  tsDead) echo 'rate limited' >&2; exit 1;;`
  );
  const found = bySymbol(run(repo(fixture), FAST, { DEAD_CODE_SCAN_GH: gh }).document);
  assert.equal(found.get("GoDead").category, "exported-with-hits");
  assert.match(found.get("GoDead").evidence, /acme\/other:x\.go/);
  assert.equal(found.get("rs_dead").refused, false);
  assert.equal(found.get("tsDead").category, "unknown");
});

test("--max-external refuses the symbols past the limit", () => {
  const gh = fakeGh("");
  const document = run(repo(fixture), ["--max-external", "1", ...FAST], { DEAD_CODE_SCAN_GH: gh }).document;
  assert.ok(document.findings.some((f) => /search limit of 1/.test(f.evidence)));
});

test("a capped search with no other repository visible is unknown", () => {
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
  const root = repo({ "package.json": { name: "x" }, "src/a.ts": "export function capped() {}\n" });
  const found = bySymbol(run(root, FAST, { DEAD_CODE_SCAN_GH: gh }).document);
  assert.equal(found.get("capped").category, "unknown");
});

function writeFindings(findings) {
  const file = join(tempDir(), "findings.json");
  writeFileSync(file, JSON.stringify({ findings }));
  return file;
}

const judged = {
  id: "dc-1",
  source: "script",
  evidence_source: "lsp",
  file: "src/a.ts",
  evidence: "find-references: none",
  proposal: "Delete it.",
  refused: false,
  judgment: "confirmed",
  judgment_reason: "no callers in the language server",
};

test("validate accepts judged script findings and reviewer findings", () => {
  const file = writeFindings([
    judged,
    { ...judged, id: "dc-2", source: "reviewer", evidence_source: "read", judgment: undefined, judgment_reason: undefined },
  ]);
  const result = run(tempDir(), ["validate", file]);
  assert.equal(result.status, 0);
});

test("validate rejects a script finding without a judgment", () => {
  const result = run(tempDir(), ["validate", writeFindings([{ ...judged, judgment: null }])]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /needs judgment/);
});

test("validate rejects a bad source, evidence source, or missing reason", () => {
  const file = writeFindings([
    { ...judged, source: "model" },
    { ...judged, id: "dc-2", evidence_source: "guess" },
    { ...judged, id: "dc-3", judgment_reason: "" },
  ]);
  const result = run(tempDir(), ["validate", file]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /source must be/);
  assert.match(result.stderr, /evidence_source must be/);
  assert.match(result.stderr, /judgment_reason is missing/);
});

test("--out as a symlink exits 2", () => {
  const root = repo(fixture);
  const link = join(tempDir(), "link.json");
  symlinkSync(join(root, "package.json"), link);
  const result = run(root, [...local, "--out", link]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /symbolic link/);
});

test("--accept-root with a path lifts the block for that path only", () => {
  const root = repo({
    "a/package.json": { name: "a" },
    "a/loader.py": "import importlib\nmod = importlib.import_module(name)\n",
    "a/plugins/p.py": "def plugin_dead():\n    pass\n",
    "a/core/c.py": "def core_dead():\n    pass\n",
  });
  const found = bySymbol(run(root, [...local, "--accept-root", "dynamic-loading:a/core"]).document);
  assert.equal(found.get("core_dead").refused, false);
  assert.equal(found.get("plugin_dead").category, "unevaluated-root");
});

test("sources with no manifest above them are refused even when another package exists", () => {
  const root = repo({
    "a/package.json": { name: "a" },
    "a/x.py": "def owned_dead():\n    pass\n",
    "b/y.py": "def unowned_dead():\n    pass\n",
  });
  const found = bySymbol(run(root, local).document);
  assert.equal(found.get("owned_dead").refused, false);
  assert.equal(found.get("unowned_dead").category, "unevaluated-root");
});

test("a Makefile owns the sources beside it", () => {
  const root = repo({ "Makefile": "all:\n", "src/a.c": "", "src/a.h": "struct made_dead { int x; };\n" });
  assert.equal(bySymbol(run(root, local).document).get("made_dead").refused, false);
});

test("--accept-root other-repositories means --no-external", () => {
  const result = run(repo(fixture), ["--accept-root", "other-repositories", "--not-public", "."], { DEAD_CODE_SCAN_GH: "/nonexistent/gh" });
  assert.equal(bySymbol(result.document).get("tsDead").refused, false);
});

test("an unread oversized file blocks candidates until accepted", () => {
  const root = repo(fixture);
  writeFileSync(join(root, "big.txt"), "x".repeat(500));
  const blocked = run(root, [...local, "--max-file-bytes", "400"]).document;
  assert.equal(bySymbol(blocked).get("tsDead").category, "unevaluated-root");
  assert.ok(blocked.roots.unresolved.some((r) => r.id === "unread-files"));
  const accepted = run(root, [...local, "--max-file-bytes", "400", "--accept-root", "unread-files"]).document;
  assert.equal(bySymbol(accepted).get("tsDead").refused, false);
});

test("readable files of unlisted languages are reported by extension", () => {
  const root = repo({ ...fixture, "lib/thing.zzz": "fn thing_dead() {}\n" });
  assert.equal(run(root, local).document.unlisted_file_types[".zzz"], 1);
});

test("validate rejects a refused script finding without a judgment", () => {
  const file = writeFindings([{ ...judged, refused: true, judgment: null }]);
  assert.equal(run(tempDir(), ["validate", file]).status, 2);
});

const library = {
  "package.json": { name: "lib", main: "src/index.ts" },
  "src/index.ts": "export function apiFn(): Handle {\n  return {};\n}\n",
  "src/handle.ts": "export interface Handle {}\n",
  "src/internal/util.ts": "export function internalExported() {}\n",
};

test("a published library's exported symbols are refused as public API", () => {
  const document = run(repo(library), ext).document;
  const found = bySymbol(document);
  assert.equal(document.counts.reported, 0);
  assert.equal(found.get("apiFn").category, "public-api");
  assert.equal(found.get("internalExported").category, "public-api");
  assert.ok(document.roots.found.some((r) => r.id === "public-api"));
});

test("a type exposed through a public signature is not a candidate", () => {
  const found = bySymbol(run(repo(library), ext).document);
  assert.equal(found.has("Handle"), false);
});

test("an internal symbol no root reaches is reported", () => {
  const unpublished = { ...library, "package.json": { name: "lib", private: true, main: "src/index.ts" } };
  const found = bySymbol(run(repo(unpublished), ext).document);
  assert.equal(found.get("internalExported").refused, false);
  assert.equal(found.get("apiFn").refused, false);
});

test("the user can say a path of a published library is not public", () => {
  const found = bySymbol(run(repo(library), [...ext, "--not-public", "src/internal"]).document);
  assert.equal(found.get("internalExported").refused, false);
  assert.equal(found.get("apiFn").category, "public-api");
});

test("a search that finds nothing does not replace the public API root", () => {
  const args = ["--pace-ms", "0", "--retry-ms", "0"];
  const found = bySymbol(run(repo(library), args, { DEAD_CODE_SCAN_GH: fakeGh("") }).document);
  assert.equal(found.get("apiFn").external, "none");
  assert.equal(found.get("apiFn").category, "public-api");
});

test("unclear publication is an unresolved root until the user answers", () => {
  const root = repo({ "pom.xml": "<project/>\n", "Foo.java": "public class Lib {}\n" });
  const first = run(root, ext).document;
  assert.ok(first.roots.unresolved.some((r) => r.id.startsWith("publication-status")));
  assert.equal(bySymbol(first).get("Lib").category, "unevaluated-root");
  assert.equal(bySymbol(run(root, [...ext, "--public-api", "."]).document).get("Lib").category, "public-api");
  assert.equal(bySymbol(run(root, [...ext, "--not-public", "."]).document).get("Lib").refused, false);
});

test("a mix of published and unpublished packages asks which are public", () => {
  const root = repo({
    "a/package.json": { name: "a" },
    "a/x.ts": "export function pubFn() {}\n",
    "b/package.json": { name: "b", private: true },
    "b/y.ts": "export function privFn() {}\n",
  });
  const document = run(root, ext).document;
  assert.ok(document.roots.unresolved.some((r) => r.id === "public-api-scope"));
  const found = bySymbol(document);
  assert.equal(found.get("pubFn").category, "public-api");
  assert.equal(found.get("privFn").category, "unevaluated-root");
  const answered = run(root, [...ext, "--public-api", "a"]).document;
  assert.equal(answered.roots.unresolved.some((r) => r.id === "public-api-scope"), false);
  assert.equal(bySymbol(answered).get("privFn").refused, false);
});

test("the most specific public or private path wins, in either flag order", () => {
  const root = repo({
    "package.json": { name: "top", private: true },
    "packages/lib/x.ts": "export function libFn() {}\n",
    "tools/y.ts": "export function toolFn() {}\n",
  });
  for (const flags of [
    ["--not-public", ".", "--public-api", "packages/lib"],
    ["--public-api", "packages/lib", "--not-public", "."],
  ]) {
    const found = bySymbol(run(root, [...ext, ...flags]).document);
    assert.equal(found.get("libFn").category, "public-api");
    assert.equal(found.get("toolFn").refused, false);
  }
});

test("equal public and private paths conflict", () => {
  const result = run(repo(library), [...ext, "--public-api", "src", "--not-public", "src"]);
  assert.equal(result.status, 2);
});

test("a Cargo workspace default does not make a package private", () => {
  const root = repo({
    "Cargo.toml": "[workspace.package]\npublish = false\n\n[package]\nname = \"r\"\n\n[lib]\n",
    "src/lib.rs": "pub fn api() {}\n",
  });
  assert.equal(bySymbol(run(root, ext).document).get("api").category, "public-api");
  const inherited = repo({
    "Cargo.toml": "[package]\nname = \"r\"\npublish.workspace = true\n\n[lib]\n",
    "src/lib.rs": "pub fn api() {}\n",
  });
  const document = run(inherited, ext).document;
  assert.ok(document.roots.unresolved.some((r) => r.id.startsWith("publication-status")));
});

test("a root id with a colon can be accepted whole or by path", () => {
  const root = repo({
    "package.json": { name: "site", private: true, dependencies: { next: "14" } },
    "pages/a/index.ts": "export function pageA() {}\n",
    "pages/b/index.ts": "export function pageB() {}\n",
  });
  const whole = run(root, [...ext, "--accept-root", "framework:next"]).document;
  assert.equal(bySymbol(whole).get("pageA").refused, false);
  const scoped = bySymbol(run(root, [...ext, "--accept-root", "framework:next:pages/a"]).document);
  assert.equal(scoped.get("pageA").refused, false);
  assert.equal(scoped.get("pageB").category, "unevaluated-root");
});

function git(root, ...args) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

/** A repository with a base commit and a change that orphans `helper`. */
function changed() {
  const root = repo({
    "package.json": { name: "p", private: true },
    "src/lib.ts": "export function helper() {}\n",
    "src/use.ts": 'import { helper } from "./lib";\nhelper();\ngone_symbol();\n',
    "src/old.ts": "export function untouchedDead() {}\n",
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "tag", "base");
  writeFileSync(join(root, "src/use.ts"), "export const kept = 1;\n");
  writeFileSync(join(root, "src/new.ts"), "export function newDead() {}\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
  return root;
}

test("diff scope keeps candidates in touched files and orphaned symbols only", () => {
  const document = run(changed(), [...ext, "--not-public", ".", "--base", "base"]).document;
  const found = bySymbol(document);
  assert.deepEqual(names(document, false), ["helper", "kept", "newDead"]);
  assert.equal(found.get("newDead").diff_reason, "touched");
  assert.equal(found.get("helper").diff_reason, "orphaned");
  assert.equal(found.has("untouchedDead"), false);
  assert.deepEqual(document.diff.orphan_symbols, ["helper"]);
  assert.match(document.scope, /diff against base/);
});

test("diff scope still computes roots and references over the whole repository", () => {
  const root = changed();
  writeFileSync(join(root, "README.md"), "Call newDead to start.\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "doc");
  const document = run(root, [...ext, "--not-public", ".", "--base", "base"]).document;
  assert.equal(bySymbol(document).has("newDead"), false);
  assert.ok(document.roots.found.some((r) => r.id === "docs-and-data"));
});

test("diff-scope lists touched files, orphaned symbols, and removed-only symbols", () => {
  const result = run(changed(), ["diff-scope", "--base", "base"]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.document.files, ["src/new.ts", "src/use.ts"]);
  assert.deepEqual(result.document.orphan_symbols, ["helper"]);
  assert.ok(result.document.removed_only_symbols.includes("gone_symbol"));
});

test("--working-tree adds uncommitted and untracked files to the diff scope", () => {
  const root = changed();
  writeFileSync(join(root, "src/dirty.ts"), "export function dirtyDead() {}\n");
  const without = run(root, [...ext, "--not-public", ".", "--base", "base"]).document;
  assert.equal(bySymbol(without).has("dirtyDead"), false);
  const withTree = run(root, [...ext, "--not-public", ".", "--base", "base", "--working-tree"]).document;
  assert.equal(bySymbol(withTree).get("dirtyDead").refused, false);
});

test("a missing base exits 2", () => {
  const result = run(changed(), [...ext, "--base", "no-such-ref"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /merge base/);
});

test("--format wire prints review-lens findings and a headline", () => {
  const result = run(repo(fixture), [...local, "--format", "wire"]);
  assert.ok(Array.isArray(result.document));
  const finding = result.document.find((f) => f.path === "src/ts.ts" && /tsDead/.test(f.title));
  assert.match(finding.title, /^Candidate: /);
  assert.deepEqual(Object.keys(finding), [
    "source", "path", "line", "severity", "title", "body", "suggested_fix", "evidence",
  ]);
  assert.equal(finding.source, "dead-code-code-review");
  assert.equal(finding.severity, "low");
  assert.match(finding.body, /Unjudged scan candidate/);
  assert.match(finding.evidence, /^Inferred: text evidence;/);
  assert.match(finding.evidence, /roots considered:/);
  assert.match(finding.suggested_fix, /Proposed change/);
  assert.match(result.stderr, /headline: approve/);
});

test("wire leaves out refusals and dropped findings, and reports open roots", () => {
  const base = { source: "script", evidence_source: "lsp", file: "a.ts", evidence: "e", proposal: "p", judgment_reason: "r" };
  const file = join(tempDir(), "judged.json");
  writeFileSync(
    file,
    JSON.stringify({
      roots: { found: [{ id: "tests" }], unresolved: [{ id: "dynamic-loading", detail: "x.py:1" }] },
      findings: [
        { ...base, id: "dc-1", symbol: "kept", severity: "medium", check: "dead-export", refused: false, judgment: "confirmed", line: 3 },
        { ...base, id: "dc-2", symbol: "gone", severity: "medium", check: "dead-export", refused: false, judgment: "dropped" },
        { ...base, id: "dc-3", symbol: "api", severity: "question", check: "dead-export", refused: true, category: "public-api", judgment: "confirmed" },
        { ...base, id: "dc-4", symbol: "dead", severity: "question", check: "dead-export", refused: true, judgment: "overturned" },
        { ...base, id: "dc-5", source: "reviewer", evidence_source: "read", symbol: undefined, file: "b.go", severity: "high", signal: "unused table" },
      ],
    })
  );
  const result = run(tempDir(), ["wire", file]);
  assert.equal(result.status, 0);
  const titles = result.document.map((f) => f.title);
  assert.deepEqual(titles, ["Remove unused kept", "Remove unused dead", "Dead code", "Roots the scan could not evaluate"]);
  assert.match(result.document[0].evidence, /^Verified: lsp evidence;/);
  assert.match(result.document[2].body, /Finding source: reviewer/);
  assert.equal(result.document[3].severity, "low");
  assert.match(result.document[3].suggested_fix, /Ask the user/);
  assert.match(result.stderr, /headline: needs-attention/);
});

test("wire exits 2 on an unjudged file", () => {
  const file = join(tempDir(), "unjudged.json");
  writeFileSync(
    file,
    JSON.stringify({
      roots: { found: [], unresolved: [] },
      findings: [{ id: "dc-1", source: "script", evidence_source: "text", file: "a", evidence: "e", proposal: "p", judgment: null }],
    })
  );
  assert.equal(run(tempDir(), ["wire", file]).status, 2);
});

test("diff scope follows renames, ignores header-like content, and accepts a range", () => {
  const root = repo({
    "package.json": { name: "p", private: true },
    "src/old-name.ts": "export function movedDead() {}\n",
    "src/note.txt": "keep\n",
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "tag", "base");
  git(root, "mv", "src/old-name.ts", "src/new-name.ts");
  writeFileSync(join(root, "src/note.txt"), "keep\n++ x\n-- y\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
  const info = run(root, ["diff-scope", "--base", "base..HEAD"]).document;
  assert.deepEqual(info.files, ["src/new-name.ts", "src/note.txt"]);
  const document = run(root, [...ext, "--not-public", ".", "--base", "base..HEAD"]).document;
  assert.deepEqual(names(document, false), ["movedDead"]);
});

test("a dirty working tree is a warning in diff scope", () => {
  const root = changed();
  writeFileSync(join(root, "src/dirty.ts"), "export const dirty = 1;\n");
  const document = run(root, [...ext, "--not-public", ".", "--base", "base"]).document;
  assert.match(document.warnings[0], /uncommitted changes/);
  assert.deepEqual(run(changed(), [...ext, "--not-public", ".", "--base", "base"]).document.warnings, []);
});

test("--working-tree rejects a range", () => {
  const result = run(changed(), [...ext, "--base", "base..HEAD", "--working-tree"]);
  assert.equal(result.status, 2);
});

test("--no-gh runs no gh and refuses candidates as unknown", () => {
  const marker = join(tempDir(), "ran");
  const gh = join(tempDir(), "gh");
  writeFileSync(gh, `#!/bin/sh\ntouch ${marker}\nexit 0\n`);
  chmodSync(gh, 0o755);
  const found = bySymbol(run(repo(fixture), ["--no-gh", "--not-public", "."], { DEAD_CODE_SCAN_GH: gh }).document);
  assert.equal(found.get("tsDead").category, "unknown");
  assert.match(found.get("tsDead").evidence, /--no-gh/);
  assert.equal(spawnSync("test", ["-e", marker]).status, 1);
});

test("a range that does not end at the checked-out revision exits 2", () => {
  const result = run(changed(), [...ext, "--base", "base..base"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not the checked-out revision/);
});

test("wire keeps a finding's own title", () => {
  const file = join(tempDir(), "titled.json");
  writeFileSync(
    file,
    JSON.stringify({
      roots: { found: [], unresolved: [] },
      findings: [
        {
          id: "dc-1", source: "script", evidence_source: "read", file: "a.ts", symbol: "api", severity: "low",
          title: "Verify external callers before removing api", evidence: "e", proposal: "p",
          refused: false, judgment: "downgraded", judgment_reason: "public candidate",
        },
      ],
    })
  );
  const result = run(tempDir(), ["wire", file]);
  assert.equal(result.document[0].title, "Verify external callers before removing api");
  assert.match(result.stderr, /headline: approve/);
});
