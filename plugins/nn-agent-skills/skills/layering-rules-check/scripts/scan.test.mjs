import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCAN = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");
const dirs = [];

after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "layering-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function run(root, ...extra) {
  const result = spawnSync("node", [SCAN, "--root", root, ...extra], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function findings(root, ...extra) {
  const { stdout } = run(root, ...extra);
  return JSON.parse(stdout).findings;
}

const pkg = (name, deps = {}) =>
  JSON.stringify({ name, dependencies: deps, devDependencies: {} });

const FIXTURE = {
  "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
  "packages/a/package.json": pkg("@x/a"),
  "packages/a/tsconfig.json": "{ // comment\n \"include\": [\"src\"] }",
  "packages/a/src/util.test.ts": "export const helper = 1;\n",
  "packages/a/src/prod.ts": 'import { helper } from "./util.test.js";\nimport "@x/b";\n',
  "packages/a/src/legacy.js": "export const legacy = 1;\n",
  "packages/a/src/uses-legacy.ts": 'import { legacy } from "./legacy.js";\n',
  "packages/a/src/test/index.ts": 'export * from "../util.test.js";\n',
  "packages/a/src/feature/index.ts": 'export { x } from "../other/x.js";\n',
  "packages/a/src/other/x.ts": "export const x = 1;\n",
  "packages/a/src/other/y.test.ts": 'import "@x/c";\n',
  "packages/b/package.json": pkg("@x/b"),
  "packages/b/src/index.ts": "export const b = 1;\n",
  "packages/c/package.json": pkg("@x/c"),
  "packages/c/src/index.ts": "export const c = 1;\n",
  "packages/a/src/layers/DEPENDENCIES.md": [
    "### Production Dependencies",
    "| Dir | Imports |",
    "| --- | --- |",
    "| **core** | util |",
    "| **ui** | _(none)_ |",
    "### Test-Only Dependencies",
    "| **core** | ui |",
  ].join("\n"),
  "packages/a/src/layers/core/a.ts": 'import "../util/u.js";\nimport "../ui/v.js";\nimport "./b.js";\n',
  "packages/a/src/layers/core/b.ts": "export {};\n",
  "packages/a/src/layers/util/u.ts": "export {};\n",
  "packages/a/src/layers/ui/v.ts": "export {};\n",
};

describe("scan.mjs", () => {
  const root = makeRepo(FIXTURE);
  const all = findings(root);
  const byCheck = (check) => all.filter((f) => f.check === check);

  it("flags a production import of a test module and refuses the test-support barrel", () => {
    const hits = byCheck("test-import");
    const prod = hits.find((f) => f.file === "packages/a/src/prod.ts");
    const barrel = hits.find((f) => f.file === "packages/a/src/test/index.ts");
    assert.equal(prod.refused, false);
    assert.equal(prod.line, 1);
    assert.equal(barrel.refused, true);
    assert.ok(barrel.reason);
  });

  it("flags a non-TS file under src in a package with tsconfig, as imported", () => {
    const hit = byCheck("unchecked-source").find((f) => f.file.endsWith("legacy.js"));
    assert.equal(hit.severity, "medium");
  });

  it("flags an undeclared workspace import, production over test", () => {
    const hits = byCheck("undeclared-package-dep");
    const names = hits.map((f) => f.id);
    assert.ok(names.some((id) => id.includes("@x/b production")));
    assert.ok(names.some((id) => id.includes("@x/c test")));
  });

  it("flags a barrel that re-exports from outside its directory", () => {
    const hits = byCheck("foreign-barrel-reexport");
    assert.ok(hits.some((f) => f.file === "packages/a/src/feature/index.ts"));
    assert.ok(hits.some((f) => f.file === "packages/a/src/test/index.ts"));
  });

  it("reports a missing edge in the dependency table and ignores test tables", () => {
    const hits = byCheck("dependency-doc-drift");
    assert.equal(hits.length, 1);
    assert.match(hits[0].signal, /row for core does not list ui/);
  });

  it("exits 1 with findings, 0 without, and 2 on a bad argument", () => {
    assert.equal(run(root).status, 1);
    assert.equal(run(makeRepo({ "README.md": "x\n" })).status, 0);
    assert.equal(run(root, "--bogus").status, 2);
    assert.equal(run(root, "--root", join(root, "missing")).status, 2);
  });

  it("restricts findings to a scope", () => {
    const scoped = findings(root, "--scope", join(root, "packages/b"));
    assert.equal(scoped.length, 0);
    const inside = findings(root, "--scope", join(root, "packages/a/src/feature"));
    assert.deepEqual([...new Set(inside.map((f) => f.check))], ["foreign-barrel-reexport"]);
    // An aggregate finding stays when a contributing import is in scope.
    const viaImport = findings(root, "--scope", "packages/a/src/prod.ts");
    assert.ok(viaImport.some((f) => f.check === "undeclared-package-dep"));
    assert.equal(run(root, "--scope", "../elsewhere").status, 2);
  });

  it("writes the JSON file and prints a ranked summary with --out", () => {
    const out = join(makeRepo({}), "out.json");
    const result = run(root, "--out", out);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[high\]/);
    assert.ok(result.stdout.indexOf("[high]") < result.stdout.indexOf("[low]"));
    assert.equal(JSON.parse(readFileSync(out, "utf8")).tool, "layering-rules-check");
  });

  it("exits 2 when the output file cannot be written", () => {
    assert.equal(run(root, "--out", join(root, "no/such/dir/out.json")).status, 2);
  });

  it("reports only the production finding when both production and test import a package", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({ workspaces: ["packages/**"] }),
      "packages/a/package.json": pkg("a"),
      "packages/b/package.json": pkg("b"),
      "packages/a/src/x.ts": "import \"b\";\n",
      "packages/a/src/x.test.ts": "import \"b/sub\";\n",
    });
    const hits = findings(repo).filter((f) => f.check === "undeclared-package-dep");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "high");
    assert.equal(hits[0].sources.length, 2);
  });

  it("reads pnpm-workspace.yaml with comments and ignores non-member manifests", () => {
    const repo = makeRepo({
      "pnpm-workspace.yaml": "# comment\npackages: # members\n  # first\n  - \"libs/*\"\n",
      "libs/a/package.json": pkg("a"),
      "libs/b/package.json": pkg("b"),
      "fixtures/c/package.json": pkg("c"),
      "libs/a/src/x.ts": "import \"c\";\nimport \"b\";\n",
    });
    const hits = findings(repo).filter((f) => f.check === "undeclared-package-dep");
    assert.deepEqual(hits.map((f) => f.signal.match(/imports (\S+)/)[1]), ["b"]);
  });

  it("ignores imports in trailing comments but keeps URLs in strings", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({ workspaces: ["p/*"] }),
      "p/a/package.json": pkg("a"),
      "p/b/package.json": pkg("b"),
      "p/a/src/x.ts": "const u = \"http://h\"; import \"b\";\nconst k = 1; // import \"b\"\n",
    });
    const hit = findings(repo).find((f) => f.check === "undeclared-package-dep");
    assert.deepEqual(hit.sources, ["p/a/src/x.ts:1"]);
  });

  it("reports a skipped check when no dependency document exists", () => {
    const repo = makeRepo({ "src/a.ts": "export {};\n" });
    const report = JSON.parse(run(repo).stdout);
    assert.deepEqual(report.skipped_checks.map((s) => s.check), ["dependency-doc-drift"]);
  });

  it("does not follow symlinks and survives invalid manifests", () => {
    const repo = makeRepo({
      "package.json": "{ not json",
      "src/a.ts": 'import "./b.test.js";\n',
    });
    symlinkSync(repo, join(repo, "src/loop"));
    const result = run(repo);
    const report = JSON.parse(result.stdout);
    assert.equal(report.skipped_files[0].path, "package.json");
    assert.equal(report.findings.filter((f) => f.check === "test-import").length, 1);
  });

  it("skips the unchecked-source check when allowJs is on", () => {
    const repo = makeRepo({
      "package.json": pkg("p"),
      "tsconfig.json": '{"compilerOptions":{"allowJs":true}}',
      "src/a.js": "export {};\n",
      "src/b.mjs": "export {};\n",
    });
    assert.equal(findings(repo).filter((f) => f.check === "unchecked-source").length, 0);
  });
});
