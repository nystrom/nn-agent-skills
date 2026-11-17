// Run with: node --test plugins/nn-agent-skills/skills/unhandled-case-scan/scripts/
//
// Runs candidates.mjs against fixtures built in a temp dir. Needs no packages.
// The tests check that the pattern table finds the constructs below. They do
// not run any compiler.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "candidates.mjs");

const SOURCES = {
  "gaps.ts": `export function a(k: Kind) {
  switch (k) {
    case "x":
      return 1;
  }
}
export function b(k: Kind) {
  switch (k) {
    case "x":
      return 1;
    default:
      return 2;
  }
}
export function c() {
  try {
    f();
  } catch {}
}
export function d() {
  try {
    f();
  } catch {
    // The input is optional.
  }
}
export function e(p: Promise<number>) {
  p.catch(() => {});
}
`,
  "gaps.py": `def a(v):
    match v:
        case 1:
            return 1

def b(v):
    match v:
        case 1:
            return 1
        case _:
            assert_never(v)

def c():
    try:
        f()
    except ValueError:
        pass

def d():
    try:
        f()
    except ValueError:
        pass  # optional input
`,
  "gaps.rs": `fn a(v: Kind) -> i32 {
    match v {
        Kind::X => 1,
        _ => 0,
    }
}
fn b(v: Kind) -> i32 {
    match v {
        Kind::X => 1,
        Kind::Y => 2,
    }
}
fn c() {
    let _ = fallible();
    let n = parse().unwrap_or_default();
}
`,
  "gaps.go": `package gaps

func a(k Kind) int {
	switch k {
	case X:
		return 1
	}
	return 0
}

func b(k Kind) int {
	switch k {
	case X:
		return 1
	default:
		panic("unreachable")
	}
}

func c() {
	_ = err
}
`,
  "Gaps.java": `class Gaps {
  int a(Kind k) {
    switch (k) {
      case X: return 1;
    }
    return 0;
  }
  void c() {
    try { f(); } catch (Exception e) {}
  }
}
`,
  "gaps.kt": `fun a(k: Kind) = when (k) {
    Kind.X -> 1
    else -> 0
}
`,
  "gaps.c": `int a(enum Kind k) {
  switch (k) {
    case X: return 1;
  }
  return 0;
}
`,
  "gaps.swift": `func a(k: Kind) -> Int {
    switch k {
    case .x: return 1
    default: return 0
    }
}
`,
  "gaps.rb": `def c
  f
rescue nil
end
`,
  "gaps.jl": `function c()
    try
        f()
    catch
    end
end
`,
  "gaps.test.ts": 'try { f(); } catch {}\n',
  "test/helper.py": "try:\n    f()\nexcept Exception:\n    pass\n",
  "notes.txt": "switch (x) {}\n",
};

function project(sources = SOURCES) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unhandled-case-")));
  for (const [path, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function run(cwd, ...args) {
  const outFile = args.includes("--out")
    ? undefined
    : join(realpathSync(mkdtempSync(join(tmpdir(), "unhandled-out-"))), "f.json");
  const result = spawnSync(
    process.execPath,
    [cli, ...(outFile ? ["--out", outFile] : []), ...args],
    { cwd, encoding: "utf8" }
  );
  let document;
  try {
    document = JSON.parse(readFileSync(outFile ?? args[args.indexOf("--out") + 1], "utf8"));
  } catch {
    document = undefined;
  }
  return { ...result, document };
}

const find = (document, file) =>
  document.findings.filter((f) => f.file === file);
const sig = (findings) =>
  findings.map((f) => [f.check, f.line, f.refused]).sort();

test("typescript: a dispatch with no default and empty handlers", () => {
  const { status, document } = run(project());
  assert.equal(status, 1);
  assert.deepEqual(sig(find(document, "gaps.ts")), [
    ["dispatch-no-default", 2, false],
    ["empty-handler", 18, false],
    ["empty-handler", 23, true],
    ["empty-handler", 28, false],
  ]);
});

test("python: match without case _ and except: pass", () => {
  const { document } = run(project());
  assert.deepEqual(sig(find(document, "gaps.py")), [
    ["dispatch-no-default", 2, false],
    ["empty-handler", 16, false],
    ["empty-handler", 22, true],
  ]);
});

test("rust: a wildcard arm and discarded results", () => {
  const { document } = run(project());
  const rust = find(document, "gaps.rs");
  assert.deepEqual(
    rust.map((f) => [f.check, f.line]).sort(),
    [
      ["dispatch-wildcard", 2],
      ["empty-handler", 14],
      ["empty-handler", 15],
    ]
  );
});

test("go, java, kotlin, ruby, julia entries", () => {
  const { document } = run(project());
  assert.deepEqual(sig(find(document, "gaps.go")), [
    ["dispatch-no-default", 4, false],
    ["empty-handler", 21, false],
  ]);
  assert.deepEqual(sig(find(document, "Gaps.java")), [
    ["dispatch-no-default", 3, false],
    ["empty-handler", 9, false],
  ]);
  assert.deepEqual(sig(find(document, "gaps.kt")), [
    ["dispatch-wildcard", 1, false],
  ]);
  assert.deepEqual(sig(find(document, "gaps.c")), [
    ["dispatch-no-default", 2, false],
  ]);
  assert.deepEqual(sig(find(document, "gaps.swift")), [
    ["dispatch-wildcard", 2, false],
  ]);
  assert.deepEqual(sig(find(document, "gaps.rb")), [
    ["empty-handler", 3, false],
  ]);
  assert.deepEqual(sig(find(document, "gaps.jl")), [
    ["empty-handler", 4, false],
  ]);
});

test("skips test files and unknown extensions, and lists the latter", () => {
  const { document } = run(project());
  const files = new Set(document.findings.map((f) => f.file));
  assert.ok(!files.has("gaps.test.ts"));
  assert.ok(!files.has("test/helper.py"));
  assert.ok(!files.has("notes.txt"));
  assert.equal(document.extensions_without_entry[".txt"], 1);
});

test("findings carry source, evidence, and a proposal", () => {
  const { document } = run(project());
  for (const f of document.findings) {
    assert.equal(f.source, "script");
    assert.equal(f.evidence, "text");
    assert.equal(typeof f.proposal, "string");
    f.refused || assert.equal(typeof f.verify, "string");
  }
});

test("a closing marker found in the repository is named in proposals", () => {
  const { document } = run(project());
  assert.ok(document.closing_markers.some((m) => /assert_never/.test(m.pattern)));
  const py = find(document, "gaps.py").find((f) => f.check === "dispatch-no-default");
  assert.match(py.proposal, /assert_never/);
  const go = find(document, "gaps.go").find((f) => f.check === "dispatch-no-default");
  assert.doesNotMatch(go.proposal, /assert_never/);
});

test("--language restricts the scan", () => {
  const { document } = run(project(), "--language", "go");
  assert.deepEqual([...new Set(document.findings.map((f) => f.file))], ["gaps.go"]);
});

test("exits 0 on a clean project", () => {
  const { status, document } = run(project({ "a.py": "x = 1\n" }));
  assert.equal(status, 0);
  assert.equal(document.counts.reported, 0);
});

test("--scope narrows the scan, and a bad scope exits 2", () => {
  const dir = project({ ...SOURCES, "pkg/b.py": "x = 1\n" });
  assert.equal(run(dir, "--scope", "pkg").status, 0);
  assert.equal(run(dir, "--scope", "nowhere").status, 2);
  assert.equal(run(dir, "--scope", "..").status, 2);
  assert.equal(run(dir, "--scope", ".").status, 1);
});

test("exits 2 when no file has a language entry", () => {
  const { status, stderr } = run(project({ "a.txt": "x\n" }));
  assert.equal(status, 2);
  assert.match(stderr, /no file with a language entry/);
});

test("exits 2 on an unknown option or language", () => {
  assert.equal(run(project(), "--bogus").status, 2);
  assert.equal(run(project(), "--language", "cobol").status, 2);
});

test("refuses an --out path inside the repository", () => {
  const dir = project();
  const result = spawnSync(process.execPath, [cli, "--out", join(dir, "f.json")], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /inside the repository/);
});

test("writes nothing into the repository, and not through symlinks", () => {
  const dir = project();
  symlinkSync(join(dir, "gaps.ts"), join(dir, "link.ts"));
  const before = readdirSync(dir).sort();
  const { document } = run(dir);
  assert.deepEqual(readdirSync(dir).sort(), before);
  assert.ok(!document.findings.some((f) => f.file === "link.ts"));
});

test("refuses an --out path that reaches the repository through a symlink", () => {
  const dir = project();
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "unhandled-link-")));
  symlinkSync(dir, join(elsewhere, "inside"));
  const result = spawnSync(
    process.execPath,
    [cli, "--out", join(elsewhere, "inside", "f.json")],
    { cwd: dir, encoding: "utf8" }
  );
  assert.equal(result.status, 2);
  assert.ok(!readdirSync(dir).includes("f.json"));
});

test("exits 2 when the --out directory does not exist", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "--out", join(tmpdir(), "no-such-dir-x", "f.json")],
    { cwd: project(), encoding: "utf8" }
  );
  assert.equal(result.status, 2);
});

test("a long run of block comments in a catch scans in linear time", () => {
  const comments = "/* a */ ".repeat(50000);
  const start = Date.now();
  const { status } = run(
    project({ "a.ts": `try { f(); } catch { ${comments} x\n` })
  );
  assert.equal(status, 0);
  assert.ok(Date.now() - start < 5000);
});

test("--scope counts only scanned files, and unknown extensions respect scope", () => {
  const dir = project({ "a/x.py": "x = 1\n", "b/y.txt": "t\n", "b/z.zzz": "t\n" });
  const { document } = run(dir, "--scope", "a");
  assert.deepEqual(document.extensions_without_entry, {});
});

test("without --out the document goes to a file outside the repository", () => {
  const dir = project();
  const result = spawnSync(process.execPath, [cli], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 1);
  const path = result.stderr.match(/written to (\S+)/)[1];
  assert.ok(!path.startsWith(dir));
  assert.equal(JSON.parse(readFileSync(path, "utf8")).tool, "unhandled-case-scan");
});
