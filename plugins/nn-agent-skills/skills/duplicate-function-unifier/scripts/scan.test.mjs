// Run with: node --test plugins/nn-agent-skills/skills/duplicate-function-unifier/scripts/
//
// The tests need only Node. Each language the script claims as verified has a
// pair of copies that differ in comments and layout, and a near-copy that must
// stay apart.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCAN = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

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

function listTree(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listTree(join(dir, e.name), `${prefix}${e.name}/`)
      : [`${prefix}${e.name}`]
  );
}

describe("scan.mjs", () => {
  test("--help exits 0", () => {
    const run = spawnSync(process.execPath, [SCAN, "--help"], { encoding: "utf8" });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /usage: scan\.mjs/);
  });

  test("a missing root exits 2", () => {
    const run = spawnSync(process.execPath, [SCAN, "--root", "/no/such/dir"], {
      encoding: "utf8",
    });
    assert.equal(run.status, 2);
  });
});

describe("scan.mjs diff scope and wire format", () => {
  let root;
  const git = (...args) =>
    spawnSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
      { cwd: root, encoding: "utf8" }
    );
  const fn = (name, k) =>
    `def ${name}(x):\n    y = x + ${k}\n    if y:\n        y += 2\n    return y\n`;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "dfu-diff-"));
    git("init", "-q", "-b", "main");
    // Two old copies of one body, and one old unrelated copy pair.
    write(root, "old/a.py", fn("_old", 1));
    write(root, "old/b.py", fn("_old", 1));
    write(root, "old/c.py", fn("_same", 9));
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feature");
    // The change adds a third copy of _same, and touches nothing else.
    write(root, "new/d.py", fn("_same", 9));
    git("add", "-A");
    git("commit", "-q", "-m", "feature");
    // An uncommitted copy of _old.
    write(root, "wip/e.py", fn("_old", 1));
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  test("diff scope keeps only groups with a copy in the change", () => {
    const run = scan(root, "--diff-base", "main");
    assert.equal(run.json.scope_mode, "diff");
    assert.deepEqual(run.json.findings.map((f) => f.symbol), ["_same"]);
    const [finding] = run.json.findings;
    assert.equal(finding.file, "new/d.py");
    assert.equal(finding.copies.length, 2);
    assert.match(finding.signal, /old\/c\.py:1/);
  });

  test("diff scope computes evidence from the whole tree", () => {
    const [finding] = scan(root, "--diff-base", "main").json.findings;
    assert.match(finding.evidence, /one package/);
    assert.equal(finding.refused, false);
  });

  test("--include-working-tree adds uncommitted files", () => {
    const run = scan(root, "--diff-base", "main", "--include-working-tree");
    assert.deepEqual(run.json.findings.map((f) => f.symbol).sort(), ["_old", "_same"]);
    const old = run.json.findings.find((f) => f.symbol === "_old");
    assert.equal(old.file, "wip/e.py");
    assert.equal(old.copies.length, 3);
  });

  test("--scope intersects with the diff", () => {
    const run = scan(root, "--diff-base", "main", "--include-working-tree", "--scope", "wip");
    assert.deepEqual(run.json.findings.map((f) => f.symbol), ["_old"]);
  });

  test("a bad base exits 2", () => {
    assert.equal(scan(root, "--diff-base", "no-such-ref").status, 2);
  });

  test("repo scope reports every group", () => {
    const run = scan(root);
    assert.equal(run.json.scope_mode, "repo");
    assert.deepEqual(run.json.findings.map((f) => f.symbol).sort(), ["_old", "_same"]);
  });

  test("--format wire prints review-lens findings", () => {
    const run = spawnSync(
      process.execPath,
      [SCAN, "--root", root, "--diff-base", "main", "--format", "wire"],
      { cwd: root, encoding: "utf8" }
    );
    const wire = JSON.parse(run.stdout);
    assert.equal(wire.length, 1);
    assert.deepEqual(Object.keys(wire[0]).sort(), [
      "body",
      "evidence",
      "line",
      "path",
      "severity",
      "source",
      "suggested_fix",
      "title",
    ]);
    assert.equal(wire[0].source, "duplicate-function-unifier");
    assert.equal(wire[0].path, "new/d.py");
    assert.equal(wire[0].line, 1);
    assert.ok(["blocker", "high", "medium", "low"].includes(wire[0].severity));
    assert.match(wire[0].body, /old\/c\.py:1/);
    assert.match(wire[0].evidence, /^Verified: .*Inferred: /);
    assert.match(wire[0].suggested_fix, /keep one _same/);
    assert.equal(run.stderr.trim(), "needs-attention");
  });

  test("wire output lists a refusal worth a look as low, and approves when empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "dfu-wire-"));
    try {
      write(dir, "a.py", fn("pub", 3));
      write(dir, "b.py", fn("pub", 3));
      const run = spawnSync(process.execPath, [SCAN, "--root", dir, "--format", "wire"], {
        cwd: dir,
        encoding: "utf8",
      });
      const wire = JSON.parse(run.stdout);
      assert.equal(wire.length, 1);
      assert.equal(wire[0].severity, "low");
      assert.match(wire[0].suggested_fix, /^Confirm before merging: consumer check is unknown/);
      assert.equal(run.stderr.trim(), "approve");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--format wire with --out writes only that file", () => {
    const outDir = mkdtempSync(join(tmpdir(), "dfu-wout-"));
    try {
      const out = join(outDir, "wire.json");
      const run = spawnSync(
        process.execPath,
        [SCAN, "--root", root, "--diff-base", "main", "--format", "wire", "--out", out],
        { cwd: root, encoding: "utf8" }
      );
      assert.match(run.stdout, /^needs-attention\n1 finding/);
      assert.deepEqual(listTree(outDir), ["wire.json"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("scan.mjs on a fixture", () => {
  let root;
  let before_files;
  let result;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "dfu-"));
    write(root, "package.json", JSON.stringify({ name: "fixture-root" }));
    write(root, "packages/a/package.json", JSON.stringify({ name: "a" }));
    write(
      root,
      "packages/b/package.json",
      JSON.stringify({ name: "b", dependencies: { a: "*" } })
    );
    write(root, "packages/c/package.json", JSON.stringify({ name: "c" }));
    write(
      root,
      "packages/d/package.json",
      JSON.stringify({ name: "d", devDependencies: { a: "*" } })
    );

    // JavaScript/TypeScript. Same tokens, different comments and layout.
    write(
      root,
      "packages/a/src/scale.ts",
      "function scale(input: number) {\n  const first = input + 1;\n  const second = first * 3;\n  return second;\n}\n"
    );
    write(
      root,
      "packages/b/src/scale.ts",
      "// Copy for b.\nfunction scale(input: number) {\n  const first = input + 1; // add\n\n  const second = first * 3;\n  /* done */ return second;\n}\n"
    );
    // Separate packages with no dependency edge: refused.
    write(
      root,
      "packages/a/src/edge.ts",
      "function edge(x: number) {\n  const y = x * 5;\n  return y;\n}\n"
    );
    write(
      root,
      "packages/c/src/edge.ts",
      "function edge(x: number) {\n  const y = x * 5;\n  return y;\n}\n"
    );
    // Exported, no --gh-owner: refused as unknown.
    const pub = "export function pub(x: number) {\n  const y = x * 7;\n  return y;\n}\n";
    write(root, "packages/a/src/pub1.ts", pub);
    write(root, "packages/a/src/pub2.ts", pub);
    // Exported through a separate statement.
    write(
      root,
      "packages/a/src/lst1.ts",
      "function lst(x: number) {\n  const y = x * 9;\n  return y;\n}\nexport { lst };\n"
    );
    write(
      root,
      "packages/a/src/lst2.ts",
      "function lst(x: number) {\n  const y = x * 9;\n  return y;\n}\n"
    );
    // A comment marks the copy as intentional.
    write(
      root,
      "packages/a/src/keep1.ts",
      "// Intentionally duplicated from keep2.\nfunction keep(x: number) {\n  const y = x * 11;\n  return y;\n}\n"
    );
    write(
      root,
      "packages/a/src/keep2.ts",
      "function keep(x: number) {\n  const y = x * 11;\n  return y;\n}\n"
    );
    // Same file, different names and signatures.
    write(
      root,
      "packages/a/src/family.ts",
      "function toText(x: string) {\n  const y = x + 13;\n  return y;\n}\nfunction toNum(x: number) {\n  const y = x + 13;\n  return y;\n}\n"
    );
    // String text with slashes is not a comment.
    write(
      root,
      "packages/a/src/tpl1.ts",
      'function tpl(x: string) {\n  const a = x;\n  return a + "// one";\n}\n'
    );
    write(
      root,
      "packages/a/src/tpl2.ts",
      'function tpl(x: string) {\n  const a = x;\n  return a + "// two";\n}\n'
    );
    // A renamed local is a different body.
    write(
      root,
      "packages/a/src/rn1.ts",
      "function rn(x: number) {\n  const p = x;\n  return p + 17;\n}\n"
    );
    write(
      root,
      "packages/a/src/rn2.ts",
      "function rn(x: number) {\n  const q = x;\n  return q + 17;\n}\n"
    );
    // A line break after return changes the meaning.
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
    // Dev-only dependency: a host for test files only.
    const dev = "function dev(x: number) {\n  const y = x * 23;\n  return y;\n}\n";
    write(root, "packages/a/src/dev.ts", dev);
    write(root, "packages/d/src/dev.ts", dev);
    const tdev = "function tdev(x: number) {\n  const y = x * 29;\n  return y;\n}\n";
    write(root, "packages/a/src/tdev.test.ts", tdev);
    write(root, "packages/d/src/tdev.test.ts", tdev);
    // Arrow functions bound to a name.
    const arrow = "const arr = (x: number) => {\n  const y = x * 31;\n  return y;\n};\n";
    write(root, "packages/a/src/arr1.ts", arrow);
    write(root, "packages/a/src/arr2.ts", arrow);

    // Python. Indentation is structure: dedenting the last line is a different body.
    write(
      root,
      "py/pkg/a.py",
      "def _scale(x):\n    # note\n    y = x + 1\n    if y:\n        y += 2\n    return y\n"
    );
    write(
      root,
      "py/pkg/b.py",
      "def _scale(x):\n    y = x + 1\n\n    if y:\n        y += 2\n    return y\n"
    );
    write(
      root,
      "py/pkg/c.py",
      "def _dedent(x):\n    y = x + 5\n    if y:\n        y += 2\n    return y\n"
    );
    write(
      root,
      "py/pkg/d.py",
      "def _dedent(x):\n    y = x + 5\n    if y:\n        y += 2\n        return y\n"
    );

    // Go.
    write(root, "go/go.mod", "module example.com/go\n\ngo 1.21\n");
    const go = (c) =>
      `func scale(x int) int {\n\t${c}\ty := x + 1\n\tif y > 3 {\n\t\ty++\n\t}\n\treturn y\n}\n`;
    write(root, "go/a.go", `package a\n\n${go("")}`);
    write(root, "go/b.go", `package a\n\n${go("// extra\n")}`);

    // Rust.
    const rs = "fn scale(x: i32) -> Result<(), String> {\n    let y = x + 1;\n    if y > 3 {\n        return Err(String::new());\n    }\n    Ok(())\n}\n";
    write(root, "rs/a.rs", rs);
    write(root, "rs/b.rs", `/* b */\n${rs}`);

    // Java.
    const java = (c) =>
      `class K {\n  ${c}private static int scale(int x) {\n    int y = x + 1;\n    if (y > 3) {\n      y++;\n    }\n    return y;\n  }\n}\n`;
    write(root, "java/A.java", java(""));
    write(root, "java/B.java", java("// extra\n  "));

    // C.
    const c = (cm) =>
      `${cm}static int scale(int x) {\n  int y = x + 1;\n  if (y > 3) {\n    y++;\n  }\n  return y;\n}\n`;
    write(root, "c/a.c", c(""));
    write(root, "c/b.c", c("/* extra */\n"));

    // Julia.
    const jl = (cm) =>
      `${cm}function _scale(x)\n    y = x + 1\n    if y > 3\n        y += 1\n    end\n    return y\nend\n`;
    write(root, "jl/a.jl", jl(""));
    write(root, "jl/b.jl", jl("#= extra =#\n"));

    // Ruby.
    const rb = (cm) =>
      `${cm}def _scale(x)\n  y = x + 1\n  y += 1 if y > 3\n  [1, 2].each do |i|\n    y += i\n  end\n  y\nend\n`;
    write(root, "rb/a.rb", rb(""));
    write(root, "rb/b.rb", rb("# extra\n"));

    // Unbalanced brackets: skipped and reported. Unscanned language: reported.
    write(root, "bad/bad.ts", 'function ( {{{ "unterminated\n');
    write(root, "other/a.swift", "func f() {}\n");
    // Generated files and symlinked directories are not scanned.
    write(
      root,
      "packages/a/src/gen.ts",
      "// @generated\nfunction scale(input: number) {\n  const first = input + 1;\n  const second = first * 3;\n  return second;\n}\n"
    );
    symlinkSync(join(root, "packages/a/src"), join(root, "packages/b/link"));

    before_files = listTree(root).sort();
    result = scan(root);
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  const find = (symbol) => result.json.findings.filter((f) => f.symbol === symbol);

  test("exits 1 when groups exist", () => {
    assert.equal(result.status, 1);
  });

  test("writes nothing into the scanned tree", () => {
    assert.deepEqual(listTree(root).sort(), before_files);
  });

  test("ignores comments and layout, and reports the group", () => {
    const [finding] = find("scale").filter((f) => f.language === "JavaScript/TypeScript");
    assert.equal(finding.refused, false);
    assert.equal(finding.source, "script");
    assert.deepEqual(finding.evidence_source, ["text"]);
    assert.match(finding.signal, /^2 functions/);
    assert.match(finding.signal, /packages\/a\/src\/scale\.ts:1/);
    assert.match(finding.signal, /packages\/b\/src\/scale\.ts:2/);
    assert.match(finding.proposal, /keep one scale in a/);
  });

  test("refuses a group with no shared home", () => {
    assert.match(find("edge")[0].reason, /declare no dependency on each other/);
  });

  test("refuses exported names when the consumer check is unknown", () => {
    assert.match(find("pub")[0].reason, /consumer check is unknown/);
    assert.match(find("lst")[0].reason, /consumer check is unknown/);
  });

  test("refuses a group a comment marks intentional", () => {
    assert.match(find("keep")[0].reason, /intentional/);
  });

  test("refuses same-file different-signature groups", () => {
    const refused = result.json.findings.filter((f) =>
      f.reason?.startsWith("same file, different signatures")
    );
    assert.equal(refused.length, 1);
  });

  test("keeps string text, renamed locals, and line-break meaning apart", () => {
    assert.equal(find("tpl").length, 0);
    assert.equal(find("rn").length, 0);
    assert.equal(find("asi").length, 0);
  });

  test("accepts a dev dependency host only for test files", () => {
    assert.match(find("dev")[0].reason, /declare no dependency/);
    assert.equal(find("tdev")[0].refused, false);
  });

  test("finds arrow functions bound to a name", () => {
    assert.equal(find("arr")[0].refused, false);
  });

  test("Python: groups copies and respects indentation", () => {
    const [scale] = find("_scale").filter((f) => f.language === "Python");
    assert.equal(scale.refused, false);
    assert.match(scale.signal, /py\/pkg\/a\.py:1/);
    assert.equal(find("_dedent").length, 0);
  });

  for (const [language, symbol] of [
    ["Go", "scale"],
    ["Rust", "scale"],
    ["Java", "scale"],
    ["C", "scale"],
    ["Julia", "_scale"],
    ["Ruby", "_scale"],
  ]) {
    test(`${language}: groups copies that differ in comments`, () => {
      const [finding] = find(symbol).filter((f) => f.language === language);
      assert.ok(finding, `no ${language} group`);
      assert.equal(finding.refused, false, finding.reason);
      assert.match(finding.signal, /^2 functions/);
    });
  }

  test("reports languages scanned, skipped files, and unscanned languages", () => {
    assert.equal(result.json.languages.go.verified, true);
    assert.ok(result.json.skipped.some((s) => /bad\.ts: brackets do not balance/.test(s)));
    assert.equal(result.json.unscanned.swift, 1);
  });

  test("does not count generated files or symlinked copies", () => {
    const [finding] = find("scale").filter((f) => f.language === "JavaScript/TypeScript");
    assert.match(finding.signal, /^2 functions/);
  });

  test("counts add up", () => {
    const { candidates, refused, reported } = result.json.counts;
    assert.equal(candidates, refused + reported);
    assert.equal(candidates, result.json.findings.length);
  });

  test("--scope drops groups with no member in scope", () => {
    const run = scan(root, "--scope", "packages/c");
    assert.deepEqual(run.json.findings.map((f) => f.symbol), ["edge"]);
    assert.equal(scan(root, "--scope", ".").json.counts.candidates, result.json.counts.candidates);
  });

  test("--out writes only the named file and prints a summary", () => {
    const outDir = mkdtempSync(join(tmpdir(), "dfu-out-"));
    try {
      const out = join(outDir, "findings.json");
      const run = spawnSync(process.execPath, [SCAN, "--root", root, "--out", out], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(run.status, 1);
      assert.match(run.stdout, /reported/);
      assert.match(run.stdout, /not scanned, read these yourself: swift/);
      assert.deepEqual(listTree(root).sort(), before_files);
      assert.deepEqual(listTree(outDir), ["findings.json"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("a repository with no source files exits 0", () => {
    const empty = mkdtempSync(join(tmpdir(), "dfu-empty-"));
    try {
      const run = scan(empty);
      assert.equal(run.status, 0);
      assert.equal(run.json.counts.candidates, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
