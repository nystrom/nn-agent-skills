// Run with: node --test plugins/nn-agent-skills/skills/duplicate-function-unifier/scripts/
//
// The scan needs the `typescript` package. The tests use the copy that
// `createRequire` finds from this repository, or the directory named by
// SCAN_TEST_TYPESCRIPT_DIR, and skip the scan tests when neither exists.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCAN = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

function findTypescript() {
  if (process.env.SCAN_TEST_TYPESCRIPT_DIR) {
    return process.env.SCAN_TEST_TYPESCRIPT_DIR;
  }
  try {
    const require = createRequire(join(process.cwd(), "package.json"));
    return dirname(require.resolve("typescript/package.json"));
  } catch {
    return undefined;
  }
}

function write(root, rel, text) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function scan(root, ...args) {
  const run = spawnSync(process.execPath, [SCAN, "--root", root, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { ...run, json: run.status === 2 ? undefined : JSON.parse(run.stdout) };
}

const body = (tag) => `{
  const first = input + 1;
  const second = first * ${tag};
  return second;
}`;

describe("scan.mjs without typescript", () => {
  test("exits 2 with a clear message", () => {
    const root = mkdtempSync(join(tmpdir(), "dfu-nots-"));
    try {
      write(root, "a.ts", `export function f(input: number) ${body(2)}\n`);
      const run = scan(root);
      assert.equal(run.status, 2);
      assert.match(run.stderr, /cannot resolve the `typescript` package/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--help exits 0", () => {
    const run = spawnSync(process.execPath, [SCAN, "--help"], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /usage: scan\.mjs/);
  });
});

const tsDir = findTypescript();

describe("scan.mjs on a fixture", { skip: tsDir === undefined }, () => {
  let root;
  let result;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "dfu-"));
    mkdirSync(join(root, "node_modules"), { recursive: true });
    symlinkSync(tsDir, join(root, "node_modules", "typescript"));

    write(root, "package.json", JSON.stringify({ name: "fixture-root" }));
    write(root, "packages/a/package.json", JSON.stringify({ name: "a" }));
    write(
      root,
      "packages/b/package.json",
      JSON.stringify({ name: "b", dependencies: { a: "*" } })
    );
    write(root, "packages/c/package.json", JSON.stringify({ name: "c" }));

    // Same tokens, different comments and whitespace: one group, a and b.
    write(
      root,
      "packages/a/src/clamp.ts",
      `function scale(input: number) ${body(3)}\n`
    );
    write(
      root,
      "packages/b/src/clamp.ts",
      `// Copy for b.\nfunction scale(input: number) {\n  const first = input + 1; // add\n\n  const second = first * 3;\n  /* done */ return second;\n}\n`
    );

    // a and c have no dependency edge: refused.
    write(root, "packages/a/src/edge.ts", `function edge(input: number) ${body(5)}\n`);
    write(root, "packages/c/src/edge.ts", `function edge(input: number) ${body(5)}\n`);

    // Exported in the same package, no --gh-owner: refused as unknown.
    write(root, "packages/a/src/pub1.ts", `export function pub(input: number) ${body(7)}\n`);
    write(root, "packages/a/src/pub2.ts", `export function pub(input: number) ${body(7)}\n`);

    // A comment says the copy is intentional: refused.
    write(
      root,
      "packages/a/src/keep1.ts",
      `// Intentionally duplicated from keep2.\nfunction keep(input: number) ${body(11)}\n`
    );
    write(root, "packages/a/src/keep2.ts", `function keep(input: number) ${body(11)}\n`);

    // Same file, different names and signatures: refused.
    write(
      root,
      "packages/a/src/family.ts",
      `function toString(input: string) ${body(13)}\nfunction toNumber(input: number) ${body(13)}\n`
    );

    // Template text that differs after a `//` must not be treated as a comment.
    write(
      root,
      "packages/a/src/tpl1.ts",
      "function tpl(x: string) {\n  const a = x;\n  return `${a} // one`;\n}\n"
    );
    write(
      root,
      "packages/a/src/tpl2.ts",
      "function tpl(x: string) {\n  const a = x;\n  return `${a} // two`;\n}\n"
    );

    // A renamed local is a different body: no group.
    write(
      root,
      "packages/a/src/rename1.ts",
      "function r(x: number) {\n  const p = x;\n  return p + 17;\n}\n"
    );
    write(
      root,
      "packages/a/src/rename2.ts",
      "function r(x: number) {\n  const q = x;\n  return q + 17;\n}\n"
    );

    // A line break after return changes the meaning: not the same body.
    write(
      root,
      "packages/a/src/asi1.ts",
      "function asi(x: number) {\n  const a = x;\n  return\n  a;\n}\n"
    );
    write(
      root,
      "packages/a/src/asi2.ts",
      "function asi(x: number) {\n  const a = x;\n  return a;\n}\n"
    );

    // Exported through a separate `export { }` statement: consumers unknown.
    write(
      root,
      "packages/a/src/lst1.ts",
      `function lst(input: number) ${body(19)}\nexport { lst };\n`
    );
    write(root, "packages/a/src/lst2.ts", `function lst(input: number) ${body(19)}\n`);

    // A dev-only dependency is a home for test files only.
    write(
      root,
      "packages/d/package.json",
      JSON.stringify({ name: "d", devDependencies: { a: "*" } })
    );
    write(root, "packages/a/src/dev.ts", `function dev(input: number) ${body(23)}\n`);
    write(root, "packages/d/src/dev.ts", `function dev(input: number) ${body(23)}\n`);
    write(root, "packages/a/src/tdev.test.ts", `function tdev(input: number) ${body(29)}\n`);
    write(root, "packages/d/src/tdev.test.ts", `function tdev(input: number) ${body(29)}\n`);

    // A file with parse errors is skipped and reported.
    write(root, "packages/a/src/bad.ts", "function ( {{{\n");

    // Generated files and symlinked directories are not scanned.
    write(
      root,
      "packages/a/src/gen.ts",
      `// @generated\nfunction scale(input: number) ${body(3)}\n`
    );
    symlinkSync(join(root, "packages/a/src"), join(root, "packages/b/link"));

    result = scan(root);
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  const find = (symbol) => result.json.findings.filter((f) => f.symbol === symbol);

  test("exits 1 when groups exist", () => {
    assert.equal(result.status, 1);
  });

  test("ignores comments and whitespace, and reports the group", () => {
    const [finding] = find("scale");
    assert.equal(find("scale").length, 1);
    assert.equal(finding.refused, false);
    assert.match(finding.signal, /packages\/a\/src\/clamp\.ts:1/);
    assert.match(finding.signal, /packages\/b\/src\/clamp\.ts:2/);
    assert.match(finding.proposal, /keep one scale in a/);
  });

  test("does not count generated files or symlinked copies", () => {
    const [finding] = find("scale");
    assert.match(finding.signal, /^2 functions/);
  });

  test("refuses a group with no shared home", () => {
    const [finding] = find("edge");
    assert.equal(finding.refused, true);
    assert.match(finding.reason, /declare no dependency on each other/);
  });

  test("refuses exported names when the consumer check is unknown", () => {
    const [finding] = find("pub");
    assert.equal(finding.refused, true);
    assert.match(finding.reason, /consumer check is unknown/);
  });

  test("refuses a group a comment marks intentional", () => {
    const [finding] = find("keep");
    assert.equal(finding.refused, true);
    assert.match(finding.reason, /intentional/);
  });

  test("refuses same-file different-signature groups", () => {
    const refused = result.json.findings.filter((f) =>
      f.reason?.startsWith("same file, different signatures")
    );
    assert.equal(refused.length, 1);
  });

  test("keeps template text that contains slashes", () => {
    assert.equal(find("tpl").length, 0);
  });

  test("does not match a renamed local", () => {
    assert.equal(find("r").length, 0);
  });

  test("a line break after return keeps bodies apart", () => {
    assert.equal(find("asi").length, 0);
  });

  test("treats `export { name }` as exported", () => {
    const [finding] = find("lst");
    assert.equal(finding.refused, true);
    assert.match(finding.reason, /consumer check is unknown/);
  });

  test("accepts a devDependency host only for test files", () => {
    assert.match(find("dev")[0].reason, /declare no dependency/);
    assert.equal(find("tdev")[0].refused, false);
  });

  test("lists files with parse errors as skipped", () => {
    assert.ok(result.json.skipped.some((s) => /bad\.ts: parse errors/.test(s)));
  });

  test("--scope . keeps every group", () => {
    const run = scan(root, "--scope", ".");
    assert.equal(run.json.counts.candidates, result.json.counts.candidates);
  });

  test("counts add up", () => {
    const { candidates, refused, reported } = result.json.counts;
    assert.equal(candidates, refused + reported);
    assert.equal(candidates, result.json.findings.length);
  });

  test("--scope drops groups with no member in scope", () => {
    const run = scan(root, "--scope", "packages/c");
    assert.deepEqual(
      run.json.findings.map((f) => f.symbol),
      ["edge"]
    );
  });

  test("--out writes the file and prints a summary", () => {
    const out = join(root, "findings.json");
    const run = spawnSync(
      process.execPath,
      [SCAN, "--root", root, "--out", out],
      { cwd: root, encoding: "utf8" }
    );
    assert.equal(run.status, 1);
    assert.match(run.stdout, /2 reported/);
    assert.match(run.stdout, /findings written to/);
  });

  test("a repository with no source files exits 0", () => {
    const empty = mkdtempSync(join(tmpdir(), "dfu-empty-"));
    try {
      mkdirSync(join(empty, "node_modules"));
      symlinkSync(tsDir, join(empty, "node_modules", "typescript"));
      const run = scan(empty);
      assert.equal(run.status, 0);
      assert.equal(run.json.counts.candidates, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
