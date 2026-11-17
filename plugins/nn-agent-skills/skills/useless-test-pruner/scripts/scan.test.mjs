// Run with: node --test plugins/nn-agent-skills/skills/useless-test-pruner/scripts/
//
// The scan has no dependency, so these tests need no extra package. Each
// language row marked `verified` in languages.mjs has a fixture below.

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
import { LANGUAGES } from "./languages.mjs";

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

function run(dir, args = []) {
  return spawnSync("node", [cli, "--root", dir, ...args], { cwd: dir, encoding: "utf8" });
}

/** A case whose only assertion sits inside a template literal interpolation. */
const INTERP = 'it("interp", () => { const s = `${expect(run()).toBe(1)}`; });';

/** One fixture per verified language. `expect` lists `stage:case` that must be reported. */
const FIXTURES = {
  javascript: {
    file: "src/a.test.ts",
    text: `
describe("a", () => {
  it("no assertion", () => { const x = 1 + 1; });
  it("calls unknown", () => { run(); });
  it("local helper", () => { same(1); });
  it("real", () => { expect(run()).toBe(2); });
  it("same ref", () => { const r = run(); expect(r).toEqual(r); });
  it("same call", () => { expect(run(1)).toEqual(run(1)); });
  it("literals", () => { expect(1).toBe(1.0); });
  it("literals differ", () => { expect(1).toBe(2); });
  it("not tautology", () => { expect(run()).not.toBe(run()); });
  it("snapshot", () => { expect(run()).toMatchSnapshot(); expect(1).toBe(1); });
  it("string mentions expect", () => { const s = "expect(x).toBe(x)"; });
  ${INTERP}
  it.skip("skipped", () => { run(); });
  it.each([[1, 2]])("table %i", (a, b) => { run(a); });
});
describe.skip("suite", () => { it("inside", () => { run(); }); });
function same(v) { expect(v).toBe(1); }
`,
    expect: [
      "A:no assertion",
      "A:calls unknown",
      "B:same ref",
      "B:same call",
      "B:literals",
      "A:table %i",
      "A:string mentions expect",
    ],
    absent: ["local helper", "real", "literals differ", "not tautology", "snapshot", "skipped", "inside", "interp"],
  },
  python: {
    file: "tests/test_a.py",
    text: `
import pytest

def test_none():
    x = 1

def test_assert_true():
    assert True

def test_same():
    y = f()
    assert y == y

def test_ok():
    assert f() == 2

@pytest.mark.skip
def test_skipped():
    f()

def helper(v):
    assert v

def test_via_helper():
    helper(1)

def test_multi(
    value,
):
    assert value

def test_bigint():
    assert 9007199254740992 == 9007199254740993

def test_docstring():
    """assert x == x"""
    f()

class TestX(unittest.TestCase):
    def test_eq(self):
        self.assertEqual(a, a)
`,
    expect: ["A:test_none", "B:test_assert_true", "B:test_same", "A:test_docstring", "B:test_eq"],
    absent: ["test_ok", "test_skipped", "test_via_helper", "test_multi", "test_bigint"],
  },
  go: {
    file: "pkg/a_test.go",
    text: `package pkg

func TestNone(t *testing.T) { x := 1; _ = x }

func TestOk(t *testing.T) {
	if got := f(); got != 2 {
		t.Errorf("x")
	}
}

func TestTautology(t *testing.T) { assert.Equal(t, a, a) }

func TestSkip(t *testing.T) { t.Skip("x") }
`,
    expect: ["A:TestNone", "B:TestTautology"],
    absent: ["TestOk", "TestSkip"],
  },
  rust: {
    file: "src/lib.rs",
    text: `
fn compute() -> i32 { 1 }

/* outer /* inner */
#[test]
fn ghost() { let x = 1; }
*/

#[cfg(test)]
mod tests {
    #[test]
    fn none() { let x = 1 + 1; }

    #[test]
    fn check_it_only() { let y = compute(); }

    #[test]
    fn ok() { assert_eq!(f(), 2); }

    #[test]
    fn same() { assert_eq!(a, a); }

    #[test]
    #[ignore]
    fn skipped() { f(); }

    #[test]
    #[should_panic]
    fn panics() { f(); }
}
`,
    expect: ["A:none", "A:check_it_only", "B:same"],
    absent: ["ok", "skipped", "panics", "ghost"],
  },
  java: {
    file: "src/test/java/ATest.java",
    text: `
class ATest {
  @Test void none() { int x = 1; }
  @Test void ok() { assertEquals(2, f()); }
  @Test void same() { assertEquals(a, a); }
  @Test void msg() { assertEquals("m", "m", actual); }
  @Disabled @Test void skipped() { f(); }
  @Test(expected = Foo.class) void throwsIt() { f(); }
}
`,
    expect: ["A:none", "B:same"],
    absent: ["ok", "skipped", "throwsIt", "msg"],
  },
  cpp: {
    file: "tests/a_test.cc",
    text: `
TEST(S, None) { int x = 1; }
TEST(S, Ok) { EXPECT_EQ(f(), 2); }
TEST(S, Same) { EXPECT_EQ(a, a); }
TEST(S, DISABLED_Off) { f(); }
`,
    expect: ["A:S, None", "B:S, Same"],
    absent: ["S, Ok", "DISABLED_Off"],
  },
  julia: {
    file: "test/runtests.jl",
    text: `
@testset "x" begin
    y = 1
end
@testset "ok" begin
    @test f() == 2
end
@testset "same" begin
    @test a == a
end
@testset "idx" begin
    v = [1, 2]
    @test v[end] == 2
end
@testset "nested" begin
    @testset "inner" begin
        z = 1
    end
end
`,
    expect: ["A:x", "B:same", "A:inner"],
    absent: ["ok", "idx"],
  },
};

const fixtureRepo = () => {
  const dir = tempDir();
  for (const f of Object.values(FIXTURES)) {
    write(dir, { [f.file]: f.text });
  }
  return dir;
};

const keys = (doc, language) =>
  doc.findings
    .filter((f) => f.language === language && !f.refused)
    .map((f) => `${f.stage}:${f.case}`);

test("every verified language row has a fixture and every fixture is verified", () => {
  const verified = LANGUAGES.filter((l) => l.verified).map((l) => l.id).sort();
  assert.deepEqual(Object.keys(FIXTURES).sort(), verified);
});

for (const [language, fixture] of Object.entries(FIXTURES)) {
  test(`${language}: reports the expected leads and refuses the rest`, () => {
    const dir = fixtureRepo();
    const r = run(dir, ["--languages", language]);
    assert.equal(r.status, 1, r.stderr);
    const doc = JSON.parse(r.stdout);
    const got = keys(doc, language).sort();
    assert.deepEqual(got, [...fixture.expect].sort());
    for (const name of fixture.absent) {
      assert.ok(!got.some((k) => k.endsWith(`:${name}`)), `${name} was reported`);
    }
  });
}

test("findings carry source and evidence source, and the scan writes no repo file", () => {
  const dir = fixtureRepo();
  const out = join(tempDir(), "out.json");
  const r = run(dir, ["--out", out]);
  assert.equal(r.status, 1, r.stderr);
  const doc = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(doc.findings.every((f) => f.source === "script" && f.evidence_source === "text"));
  assert.equal(doc.counts.candidates, doc.counts.reported + doc.counts.refused);
  const status = spawnSync("find", [dir, "-newer", out, "-type", "f"], { encoding: "utf8" });
  assert.equal(status.stdout.trim(), "");
  assert.match(r.stdout, /refused \d+:/);
});

test("--out inside the repository exits 2 and writes nothing", () => {
  const dir = fixtureRepo();
  const r = run(dir, ["--out", join(dir, "reports", "findings.json")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /inside the repository/);
  assert.equal(spawnSync("ls", [join(dir, "reports")]).status !== 0, true);
});

test("a --table row cannot claim fixture coverage", () => {
  const dir = tempDir();
  write(dir, { "x_test.go": "package a\nfunc TestA(t *testing.T) { y := 1 }\n" });
  const table = join(tempDir(), "go.json");
  writeFileSync(table, JSON.stringify([{ ...LANGUAGES.find((l) => l.id === "go"), verified: true }]));
  assert.equal(JSON.parse(run(dir, ["--table", table]).stdout).languages.go.verified, false);
});

test("every script finding has a change, a location, and a verify step", () => {
  const doc = JSON.parse(run(fixtureRepo()).stdout);
  for (const f of doc.findings.filter((x) => !x.refused)) {
    assert.ok(f.change && f.where && f.verify, f.id);
    assert.equal(f.proposal, undefined);
  }
});

test("severity: unresolved calls are a question, a bare case is medium", () => {
  const dir = fixtureRepo();
  const doc = JSON.parse(run(dir, ["--languages", "javascript"]).stdout);
  const sev = Object.fromEntries(doc.findings.filter((f) => !f.refused).map((f) => [f.case, f.severity]));
  assert.equal(sev["no assertion"], "medium");
  assert.equal(sev["calls unknown"], "question");
  assert.equal(sev["same ref"], "medium");
  assert.equal(sev.literals, "high");
  assert.equal(sev["same call"], "medium");
});

test("an --exempt file is refused, not reported", () => {
  const dir = fixtureRepo();
  const doc = JSON.parse(run(dir, ["--languages", "go", "--exempt", "pkg/a_test.go"]).stdout);
  assert.equal(doc.counts.reported, 0);
  assert.ok(doc.counts.refused_by_reason["exempt: the caller passed this file with --exempt"] >= 2);
});

test("a --table row adds a language and replaces nothing else", () => {
  const dir = tempDir();
  write(dir, {
    "spec/a.spec.lua": `it("empty", function()\n  local x = 1\nend)\nit("ok", function()\n  assert.are.equal(1, f())\nend)\n`,
  });
  const table = join(tempDir(), "lua.json");
  writeFileSync(table, JSON.stringify([{
    id: "lua", name: "Lua (busted)", files: "\\.spec\\.lua$", mode: "parens",
    comment: { line: ["--"] }, strings: ['"', "'"],
    head: "^\\s*it\\s*\\(\\s*\"([^\"]*)\"", title: [1],
    assert: ["\\bassert\\."], funcDecl: [], tautology: [], trivial: [],
  }]));
  const doc = JSON.parse(run(dir, ["--table", table]).stdout);
  assert.deepEqual(keys(doc, "lua"), ["A:empty"]);
  assert.equal(doc.languages.lua.verified, false);
});

test("a repo with no recognized test file exits 2", () => {
  const dir = tempDir();
  write(dir, { "readme.md": "x\n" });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no test files matched/);
});

test("test files with no recognized case exit 2, not 0", () => {
  const dir = tempDir();
  write(dir, { "a_test.go": "package a\n// nothing\n" });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no test cases recognized/);
});

test("a clean tree exits 0", () => {
  const dir = tempDir();
  write(dir, { "a_test.go": "package a\nfunc TestA(t *testing.T) { if f() != 1 { t.Fatal(1) } }\n" });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).counts.reported, 0);
});

test("an unclosed block is listed in skipped_files", () => {
  const dir = tempDir();
  write(dir, {
    "a_test.go": "package a\nfunc TestA(t *testing.T) { if f() != 1 { t.Fatal(1) } }\n",
    "b_test.go": "package a\nfunc TestB(t *testing.T) {\n  x := 1\n",
  });
  const doc = JSON.parse(run(dir).stdout);
  assert.equal(doc.skipped_files.length, 1);
  assert.match(doc.skipped_files[0].reason, /does not close/);
});

test("symlinks are not followed and a scope that links out exits 2", () => {
  const dir = fixtureRepo();
  const outside = tempDir();
  write(outside, { "x_test.go": "package a\nfunc TestX(t *testing.T) { y := 1 }\n" });
  symlinkSync(outside, join(dir, "pkg", "link"));
  const doc = JSON.parse(run(dir, ["--languages", "go"]).stdout);
  assert.ok(!doc.findings.some((f) => f.file.includes("link")));
  symlinkSync(outside, join(dir, "escape"));
  const r = run(dir, ["--scope", "escape"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /outside/);
});

test("--list-languages reports which rows a fixture covers", () => {
  const r = spawnSync("node", [cli, "--list-languages"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /kotlin\tguidance only/);
  assert.match(r.stdout, /julia\tfixture-tested/);
});

test("an unknown argument exits 2", () => {
  assert.equal(run(tempDir(), ["--nope"]).status, 2);
});
