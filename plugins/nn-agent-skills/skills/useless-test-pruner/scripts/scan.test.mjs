// Run with: node --test plugins/nn-agent-skills/skills/useless-test-pruner/scripts/
//
// The scan needs the `typescript` package from the repo under test. These
// tests skip when it cannot be resolved from a temp directory (set NODE_PATH
// to a node_modules directory that has it).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

const cli = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

function tempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), "utp-")));
}

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

function run(dir, args = [], env = {}) {
  return spawnSync("node", [cli, "--root", dir, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const probe = spawnSync(
  "node",
  ["-e", "require('module').createRequire(process.cwd() + '/x.js')('typescript')"],
  { cwd: tempDir(), encoding: "utf8" }
);
const hasTypeScript = probe.status === 0;
const needTs = { skip: hasTypeScript ? false : "typescript not resolvable" };

const FIXTURE = {
  "package.json": JSON.stringify({ name: "fixture", workspaces: ["packages/*"] }),
  "tsconfig.json": `{
    // comments are allowed in tsconfig
    "compilerOptions": { "paths": { "@app/*": ["src/*"] } }
  }`,
  "packages/lib/package.json": JSON.stringify({ name: "@fixture/lib" }),
  "src/code.ts": "export const double = (n: number) => n * 2;\n",
  "src/code.test.ts": `
import { double } from "./code";
import { helperAsserts } from "./shared.test";
import { parse } from "some-dep";
import { readFileSync } from "node:fs";
import { thing } from "@fixture/lib";
import { aliased } from "@app/code";
import snap from "./snap";

let total = 0;
const same = (v: number) => { expect(v).toBe(1); };

describe("a", () => {
  it("no assertion", () => { [1].map((n) => n + 1); });
  it("calls an imported symbol only", () => { double(2); });
  it("asserts through a local helper", () => { same(double(1)); });
  it("asserts through assert", () => { assert.equal(double(1), 2); });
  it("asserts through the case context", (t) => { t.ok(double(1)); });
  it("calls an imported helper", () => { helperAsserts(double(1)); });
  it("same reference", () => { const r = double(1); expect(r).toEqual(r); });
  it("same call", () => { expect(double(1)).toEqual(double(1)); });
  it("literals", () => { expect(1).toBe(1.0); });
  it("existence on literal", () => { expect(5).toBeDefined(); });
  it("any", () => { expect(double(1)).toEqual(expect.anything()); });
  it("literal that fails", () => { double(1); expect(null).toBeTruthy(); expect(1).toBe(2); });
  it("snapshot and tautology", () => { expect(double(1)).toMatchSnapshot(); expect(1).toBe(1); });
  it("not tautology", () => { expect(double(1)).not.toBe(double(1)); });
  it("real", () => { expect(double(2)).toBe(4); });
  it("snapshot", () => { expect(double(2)).toMatchSnapshot(); });
  it("untethered", () => { expect(1 + 1).toEqual(2); });
  it("dependency", () => { expect(parse("a")).toEqual("a"); });
  it("filesystem", () => { expect(readFileSync("x", "utf8")).toContain("y"); });
  it("accumulator", () => { total += 1; expect(total).toBeGreaterThan(0); });
  it("workspace package", () => { expect(thing()).toBe(1); });
  it("tsconfig alias", () => { expect(aliased).toBe(1); });
  it.skip("skip", () => { double(1); });
  it.todo("todo");
  xit("xit", () => { double(1); });
  it("dynamic import", async () => {
    const { double: d } = await import("./code");
    expect(d(1) + 1).toBe(3);
  });
});

describe.skip("skipped suite", () => {
  it("inside", () => { double(1); });
});
`,
  "src/shared.test.ts": `
export function helperAsserts(v: number) { expect(v).toBe(2); }
it("placeholder", () => { expect(1 + 1).toBe(2); });
`,
  "src/exempt.test.ts": `it("whole tree", () => { double(1); });\n`,
};

function fixture() {
  const dir = tempDir();
  write(dir, FIXTURE);
  // A link back to the root would loop a walk that follows symlinks.
  symlinkSync(dir, join(dir, "src", "loop"));
  return dir;
}

const key = (f) => `${f.stage}:${f.signal}`;

test("reports and refuses as designed", needTs, () => {
  const dir = fixture();
  const out = join(dir, "out.json");
  const r = run(dir, ["--exempt", "src/exempt.test.ts", "--out", out]);
  assert.equal(r.status, 1, r.stderr);
  const doc = JSON.parse(readFileSync(out, "utf8"));
  const reported = doc.findings.filter((f) => !f.refused);
  const refused = doc.findings.filter((f) => f.refused);

  const expectedPrefixes = [
    'A:the case "no assertion" runs an',
    "B:both sides of the comparison are",
    "B:an existence matcher that passes",
    "B:subject and expected value are t",
    "B:subject and expected value are t",
    "B:the expected value is expect.any",
    'C:the case "untethered" asserts w',
  ];
  const reportedKeys = reported.map(key).sort();
  assert.equal(reportedKeys.length, expectedPrefixes.length, reportedKeys.join("\n"));
  expectedPrefixes.sort().forEach((prefix, i) => {
    assert.ok(reportedKeys[i].startsWith(prefix), `${reportedKeys[i]} vs ${prefix}`);
  });

  const severities = Object.fromEntries(reported.map((f) => [f.evidence.slice(0, 30), f.severity]));
  assert.equal(severities["`expect(double(1)).toEqual(dou"], "medium");
  assert.equal(severities["`expect(r).toEqual(r)` in \"sam"], "high");
  assert.ok(reported.filter((f) => f.stage === "C").every((f) => f.severity === "question"));

  const reasons = refused.map((f) => f.reason).join("\n");
  for (const expected of [
    "asserts through an assertion helper",
    "inside a helper this file declares",
    "imported symbol this scan does not follow",
    "may pin a dependency",
    "reads the filesystem",
    "aggregate guard",
    "structural",
    "folded into the stage B",
    "exempt",
  ]) {
    assert.match(reasons, new RegExp(expected), expected);
  }
  assert.equal(doc.counts.candidates, reported.length + refused.length);
  assert.ok(doc.findings.every((f) => f.source === "script"));
  assert.deepEqual(doc.own_packages, ["@fixture/lib", "fixture"]);
  assert.deepEqual(doc.own_aliases, ["@app/"]);
  // Snapshot, `.not`, skipped, todo and xit cases are never candidates.
  const titles = doc.findings.map((f) => f.signal + f.evidence).join("\n");
  for (const absent of ['"snapshot"','"skip"', '"todo"', '"xit"', '"inside"', '"real"', '"dynamic import"', '"literal that fails"', '"snapshot and tautology"']) {
    assert.ok(!titles.includes(`case ${absent}`) && !titles.includes(`in ${absent}`), absent);
  }
  assert.ok(!doc.findings.some((f) => f.file.includes("loop")));
});

test("workspace and alias imports count as own code", needTs, () => {
  const dir = fixture();
  const r = run(dir);
  const doc = JSON.parse(r.stdout);
  const titles = doc.findings.map((f) => f.signal).join("\n");
  assert.ok(!titles.includes('"workspace package"'));
  assert.ok(!titles.includes('"tsconfig alias"'));
});

test("stdout is the JSON document without --out", needTs, () => {
  const dir = fixture();
  const r = run(dir, ["--scope", "src/code.test.ts"]);
  assert.equal(JSON.parse(r.stdout).tool, "useless-test-pruner");
});

test("a clean tree exits 0", needTs, () => {
  const dir = tempDir();
  write(dir, {
    "a.test.js": `import { f } from "./a.js";\ntest("ok", () => { expect(f()).toBe(1); });\n`,
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).counts.reported, 0);
});

test("a repo with no tests exits 2, not 0", needTs, () => {
  const dir = tempDir();
  write(dir, { "readme.md": "x\n" });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no test files/);
});

test("no tsconfig and no package.json still scans", needTs, () => {
  const dir = tempDir();
  write(dir, { "t.test.js": `test("x", () => { const a = 1; expect(a).toBe(a); });\n` });
  const r = run(dir);
  assert.equal(r.status, 1, r.stderr);
});

test("a scope outside the root exits 2", needTs, () => {
  const dir = fixture();
  const r = run(dir, ["--scope", tmpdir()]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /outside/);
});

test("a scope that links out of the root exits 2", needTs, () => {
  const dir = fixture();
  const outside = tempDir();
  write(outside, { "x.test.js": "test('x', () => {});\n" });
  symlinkSync(outside, join(dir, "escape"));
  const r = run(dir, ["--scope", "escape"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /outside/);
});

test("a file with syntax errors is skipped and listed", needTs, () => {
  const dir = tempDir();
  write(dir, {
    "ok.test.js": `test("x", () => { const a = 1; expect(a).toBe(a); });\n`,
    "bad.test.js": "test('x', () => { ;;; ) \n",
  });
  const doc = JSON.parse(run(dir).stdout);
  assert.deepEqual(doc.skipped_files, [{ file: "bad.test.js", reason: "syntax errors" }]);
  assert.equal(doc.counts.test_files, 1);
});

test("a tree where no file can be scanned exits 2", needTs, () => {
  const dir = tempDir();
  write(dir, { "bad.test.js": "test('x', () => { ;;; ) \n" });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /could be scanned/);
});

test("an unknown argument exits 2", () => {
  const r = run(tempDir(), ["--nope"]);
  assert.equal(r.status, 2);
});

test("a missing typescript exits 2 rather than reporting clean", () => {
  const dir = tempDir();
  write(dir, { "a.test.js": "test('x', () => {});\n" });
  const r = run(dir, [], { NODE_PATH: "" });
  const resolvable = spawnSync(
    "node",
    ["-e", "require('module').createRequire(process.cwd() + '/x.js')('typescript')"],
    { cwd: dir, env: { ...process.env, NODE_PATH: "" } }
  ).status === 0;
  if (resolvable) return;
  assert.equal(r.status, 2);
  assert.match(r.stderr, /typescript/);
});
