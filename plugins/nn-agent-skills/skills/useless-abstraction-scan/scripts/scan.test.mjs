// Run with: node --test plugins/nn-agent-skills/skills/useless-abstraction-scan/scripts/
//
// Each test builds a small multi-language repo in a temp dir and runs the CLI
// in it. The helpers find candidates by text, so the tests check the exact
// declaration forms they claim to handle and that nothing in the repo is
// written.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

const files = {
  "package.json": JSON.stringify({ name: "fx", private: true }),
  "README.md": "The `helperOnce` function exists for speed.\n",
  ".github/ci.yml": "run: rotateKeys\n",
  "web/a.ts": `export function usedTwice(x: number) { return x + 1; }
function helperOnce(x: number) {
  return x * 2;
}
const arrowOnce = (a: number) => a + 1;
interface Store { get(): number }
class MemStore implements Store {
  get() { return 1; }
}
type Alias = string[];
class Box {
  private unwrapOnce() {
    return 1;
  }
  open() { return this.unwrapOnce(); }
}
function sub() {}
function subtotal() {}
function handlerA() {}
function walk(n: number): number {
  return walk(n - 1);
}
function rotateKeys() {}
function wrapper(a: number) {
  return arrowOnce(a);
}
function onlyTest() {}
export function main2() {
  for (const v of [1]) {
    helperOnce(v);
  }
  usedTwice(1);
  usedTwice(2);
  const s: Store = new MemStore();
  const a: Alias = [];
  subtotal();
  subtotal();
  register("handlerA", handlerA);
  walk(3);
  rotateKeys();
  wrapper(1);
}
`,
  "web/a.test.ts": `import { usedTwice } from "./a";
usedTwice(3);
arrowOnce(5);
onlyTest();
`,
  "web/b.ts": `import {
  twiceImported,
  reexp,
} from "./c";
twiceImported();
`,
  "web/c.ts": `export function twiceImported() {}
export function reexp() {}
`,
  "web/index.ts": `export { reexp } from "./c";
`,
  "py/m.py": `def helper_once(x):
    return x + 1


class Config:
    pass


def helper_twice():
    return 1


def other(a):
    return a


def forwarder(a):
    return other(a)


def run():
    helper_twice()
    helper_twice()
    c = Config()
    forwarder(1)
    return helper_once(1)
`,
  "go/s.go": `package s

type Sink interface{ Put(int) }
type fileSink struct{}

func (f fileSink) Put(x int) {}
func newSink() Sink { return fileSink{} }
func Run() { _ = newSink() }
`,
  "rs/lib.rs": `pub trait Shape {
    fn area(&self) -> f64;
}
struct Sq(f64);
impl Shape for Sq {
    fn area(&self) -> f64 { self.0 }
}
fn helper(x: f64) -> f64 { x }
pub fn total() -> f64 { helper(1.0) }
`,
  "java/Svc.java": `public class Svc {
    private int compute(int x) {
        return x + 1;
    }
    public int run() {
        return compute(2);
    }
}
interface Port {
    void send();
}
class Adapter implements Port {
    public void send() {
    }
}
`,
  "kt/K.kt": `private fun onlyOnce(x: Int): Int = x + 1
fun caller() = onlyOnce(1)
typealias Ids = List<Int>
val ids: Ids = listOf()
`,
  "c/box.h": "int box_area(int w);\n",
  "c/box.c": `#include "box.h"
int box_area(int w) {
    return w * 2;
}
int box_use(void) {
    return box_area(3);
}
`,
  "jl/m.jl": `module M
function jl_helper(x)
    return x + 1
end
double_it(x) = 2x
abstract type Animal end
struct Dog <: Animal
    name::String
end
function bump!(x)
    return x
end
function use()
    return jl_helper(1) + double_it(2) + bump!(3)
end
end
`,
};

function makeRepo(extra = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "single-use-")));
  for (const [path, text] of Object.entries({ ...files, ...extra })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function scan(dir, args, input) {
  const run = spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    encoding: "utf8",
    input,
  });
  let json = null;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    // Text output or an error.
  }
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, json };
}

const snapshot = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => [join(e.parentPath, e.name), readFileSync(join(e.parentPath, e.name), "utf8")])
    .sort();

const byName = (json) => Object.fromEntries(json.candidates.map((c) => [c.name, c]));
const outside = () => realpathSync(mkdtempSync(join(tmpdir(), "single-use-out-")));

test("candidates flags one-use declarations in every listed language", () => {
  const { status, json } = scan(makeRepo(), ["candidates"]);
  assert.equal(status, 0);
  const found = byName(json);
  const expected = {
    helperOnce: "typescript-javascript",
    arrowOnce: "typescript-javascript",
    MemStore: "typescript-javascript",
    Alias: "typescript-javascript",
    unwrapOnce: "typescript-javascript",
    helper_once: "python",
    Config: "python",
    newSink: "go",
    Sink: "go",
    helper: "rust",
    Sq: "rust",
    compute: "java",
    onlyOnce: "kotlin",
    Ids: "kotlin",
    box_area: "c-cpp",
    double_it: "julia",
    "bump!": "julia",
    jl_helper: "julia",
  };
  for (const [name, language] of Object.entries(expected)) {
    assert.ok(found[name], `${name} is a candidate`);
    assert.equal(found[name].language, language, name);
    assert.ok(found[name].checks.includes("single-use"), name);
    assert.equal(found[name].uses.production, 1, name);
  }
});

test("candidates does not flag used-twice, unused, test-only, or substring names", () => {
  const found = byName(scan(makeRepo(), ["candidates"]).json);
  for (const name of ["usedTwice", "helper_twice", "sub", "subtotal", "onlyTest", "main2", "run", "total"]) {
    assert.equal(found[name], undefined, name);
  }
});

test("candidates lists names declared more than once as ambiguous, not as candidates", () => {
  const { json } = scan(makeRepo(), ["candidates"]);
  const names = json.ambiguous.map((a) => a.name);
  assert.ok(names.includes("area"));
  assert.ok(names.includes("send"));
  assert.equal(byName(json).area, undefined);
  assert.equal(byName(json).send, undefined);
});

test("candidates finds interfaces with one implementer", () => {
  const found = byName(scan(makeRepo(), ["candidates"]).json);
  for (const name of ["Store", "Shape", "Port", "Animal"]) {
    assert.ok(found[name], name);
    assert.ok(found[name].checks.includes("single-impl"), name);
    assert.equal(found[name].implementers.length, 1, name);
  }
  assert.equal(found.Store.checks.includes("single-use"), false);
  const bound = byName(scan(makeRepo({
    "web/g.ts": "interface Ref { n: number }\nexport function f<R extends Ref>(r: R) {\n  return r;\n}\n",
  }), ["candidates"]).json);
  assert.equal(bound.Ref.checks.includes("single-impl"), false);
  assert.equal(found.Sink.checks.includes("single-impl"), false);
});

test("candidates records the site and the hints the gate needs", () => {
  const found = byName(scan(makeRepo(), ["candidates"]).json);
  assert.equal(found.helperOnce.site.file, "web/a.ts");
  assert.equal(found.helperOnce.site.loopOrCallbackHint, true);
  assert.equal(found.helperOnce.bodyLines, 1);
  assert.equal(found.helperOnce.mentions[0].file, "README.md");
  assert.equal(found.helperOnce.hints.dynamicHint, false);
  assert.equal(found.arrowOnce.site.loopOrCallbackHint, false);
  assert.deepEqual(found.arrowOnce.testFiles, ["web/a.test.ts"]);
  assert.equal(found.handlerA.hints.dynamicHint, true);
  assert.equal(found.handlerA.uses.quoted, 1);
  assert.equal(found.rotateKeys.hints.dynamicHint, true);
  assert.equal(found.walk.hints.recursiveHint, true);
  assert.equal(found.walk.uses.production, 1);
  assert.equal(found.wrapper.forwards, true);
  assert.equal(found.forwarder.forwards, true);
  assert.equal(found.helper_once.forwards, false);
  assert.equal(found.unwrapOnce.kind, "method");
  assert.equal(found.unwrapOnce.visibility, "private");
  assert.equal(found.Shape.hints.overrideHint, false);
});

test("candidates maps hints to gate ids and sorts hint-free candidates first", () => {
  const { json } = scan(makeRepo(), ["candidates"]);
  const found = byName(json);
  assert.equal(found.handlerA.site.usedAsValue, true);
  assert.equal(found.helperOnce.site.usedAsValue, false);
  assert.ok(found.handlerA.gateHints.includes("dynamic"));
  assert.ok(found.handlerA.gateHints.includes("multi-site"));
  assert.ok(found.helperOnce.gateHints.includes("multi-site"));
  assert.ok(found.walk.gateHints.includes("recursive"));
  assert.ok(found.arrowOnce.gateHints.includes("has-own-tests"));
  assert.ok(found.reexp === undefined);
  assert.deepEqual(found.compute.gateHints, []);
  const counts = json.candidates.map((c) => c.gateHints.length);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
  const clean = scan(makeRepo(), ["candidates", "--clean"]).json;
  assert.ok(clean.candidates.length > 0);
  assert.ok(clean.candidates.every((c) => c.gateHints.length === 0));
});

test("a multi-line signature with a default object does not end the body early", () => {
  const dir = makeRepo({
    "web/sig.ts": `function toElk(
  a: number,
  options: Opts = {},
): Out {
  const x = a;
  const y = x;
  return y;
}
export function user() {
  return toElk(1);
}
`,
  });
  const found = byName(scan(dir, ["candidates"]).json);
  assert.equal(found.toElk.bodyLines, 3);
});

test("candidates reads visibility from each language's rule", () => {
  const found = byName(scan(makeRepo(), ["candidates"]).json);
  assert.equal(found.newSink.visibility, "private");
  assert.equal(found.Sink.visibility, "exported");
  assert.equal(found.helper.visibility, "private");
  assert.equal(found.helper_once.visibility, "exported");
  assert.equal(found.onlyOnce.visibility, "private");
  assert.equal(found.compute.visibility, "private");
});

test("a multi-line import list is not a use, and a re-export marks the symbol exported", () => {
  const found = byName(scan(makeRepo(), ["candidates"]).json);
  assert.equal(found.twiceImported.uses.production, 1);
  assert.deepEqual(found.twiceImported.importedIn, ["web/b.ts"]);
  assert.equal(found.reexp, undefined);
});

test("a C prototype is not a use", () => {
  const found = byName(scan(makeRepo(), ["candidates"]).json);
  assert.equal(found.box_area.uses.production, 1);
});

test("an exported-by-reexport symbol with one use is flagged exported", () => {
  const dir = makeRepo({
    "web/d.ts": "export function lonely() {}\n",
    "web/e.ts": 'import { lonely } from "./d";\nlonely();\n',
    "web/index2.ts": 'export { lonely } from "./d";\n',
  });
  const found = byName(scan(dir, ["candidates"]).json);
  assert.equal(found.lonely.reexported, true);
  assert.equal(found.lonely.visibility, "exported");
});

test("--scope limits declarations but references stay global", () => {
  const { json } = scan(makeRepo(), ["candidates", "--scope", "py"]);
  assert.ok(json.candidates.every((c) => c.file.startsWith("py/")));
  assert.ok(byName(json).helper_once);
  assert.equal(byName(json).helper_once.uses.production, 1);
});

test("--kind filters and --limit truncates", () => {
  const dir = makeRepo();
  const only = scan(dir, ["candidates", "--kind", "type-alias"]).json;
  assert.ok(only.candidates.length > 0);
  assert.ok(only.candidates.every((c) => c.kind === "type-alias"));
  const limited = scan(dir, ["candidates", "--limit", "2"]).json;
  assert.equal(limited.candidates.length, 2);
  assert.ok(limited.truncated > 0);
  assert.equal(scan(dir, ["candidates", "--limit", "0"]).status, 2);
});

test("--decl adds a declaration form for another language", () => {
  const dir = makeRepo({
    "rb/x.rb": "def tidy(a)\n  a\nend\n\ndef go\n  tidy(1)\nend\n",
  });
  assert.equal(byName(scan(dir, ["candidates"]).json).tidy, undefined);
  const withForm = scan(dir, ["candidates", "--decl", "^\\s*def\\s+(?<name>\\w+)"]).json;
  assert.ok(byName(withForm).tidy);
  assert.equal(byName(withForm).tidy.language, "custom");
  assert.equal(scan(dir, ["candidates", "--decl", "("]).status, 2);
});

test("refs separates production from test and ignores comments", () => {
  const dir = makeRepo({ "web/c2.ts": "// helperOnce here\nconst helperOnces = 1;\n" });
  const { json } = scan(dir, ["refs", "helperOnce"]);
  assert.equal(json.evidenceSource, "text");
  assert.equal(json.counts.production, 2);
  assert.equal(json.counts.test, 0);
  assert.equal(scan(dir, ["refs", "arrowOnce"]).json.counts.test, 1);
  assert.equal(scan(dir, ["refs"]).status, 2);
});

// One declaration per table row, each with one use. @@ becomes a prefix that
// keeps names unique across languages.
const formFixtures = {
  "ts.ts": ["Ts", `function @@Func() {}
const @@Arrow = () => 1;
class @@Class {}
interface @@Iface {}
type @@Alias = number;
class @@Host {
  @@Meth() {
    return 1;
  }
}
export function @@Use(a: @@Class, b: @@Iface, c: @@Alias) {
  @@Func();
  @@Arrow();
  new @@Host().@@Meth();
}
`],
  "py.py": ["Py", `def @@_def():
    return 1


class @@Cls:
    def @@_method(self):
        return 1


def @@_use():
    @@_def()
    @@Cls().@@_method()
`],
  "go.go": ["Go", `package f

func @@Func() {}

type @@Iface interface{ M() }
type @@Struct struct{}
type @@Alias int

func @@Use(a @@Iface, b @@Struct, c @@Alias) { @@Func() }
`],
  "rs.rs": ["Rs", `fn @@_fn() {}
struct @@Struct { a: u8 }
enum @@Enum { A }
trait @@Trait { }
type @@Alias = u8;
pub fn @@_use(a: @@Struct, b: @@Enum, c: &dyn @@Trait, d: @@Alias) { @@_fn() }
`],
  "Jv.java": ["Jv", `class @@Class {}
interface @@Iface {}
enum @@Enum { A }
record @@Rec(int a) {}
class @@Use {
    int @@Meth() {
        return 1;
    }
    void use(@@Class a, @@Iface b, @@Enum c, @@Rec d) {
        @@Meth();
    }
}
`],
  "kt.kt": ["Kt", `fun @@Fun() {}
class @@Class
interface @@Iface
object @@Obj
typealias @@Alias = Int
fun @@Use(a: @@Class, b: @@Iface, c: @@Obj, d: @@Alias) { @@Fun() }
`],
  "cc.cpp": ["Cc", `int @@_fn(int a) {
    return a;
}
struct @@Struct {
};
class @@Class {
};
union @@Union {
    int a;
};
enum class @@Enum {
    A
};
using @@Alias = int;
int @@_use(@@Struct s, @@Class c, @@Union u, @@Enum e, @@Alias a) {
    return @@_fn(1);
}
`],
  "jl.jl": ["Jl", `function @@_fun(x)
    return x
end
@@_short(x) = x
struct @@Struct
    a::Int
end
abstract type @@Abs end
function @@_use(a::@@Struct, b::@@Abs)
    return @@_fun(1) + @@_short(2)
end
`],
};

test("every declaration form in the table is found and counted in a fixture", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "single-use-forms-")));
  for (const [file, [prefix, text]] of Object.entries(formFixtures)) {
    writeFileSync(join(dir, file), text.replaceAll("@@", prefix));
  }
  const { json } = scan(dir, ["candidates"]);
  const seen = new Set(json.candidates.map((c) => c.form));
  const table = scan(dir, ["forms"]).json.languages.flatMap((l) => l.rows.map((r) => r.form));
  assert.ok(table.length >= 28);
  assert.deepEqual(table.filter((form) => !seen.has(form)), []);
  const found = byName(json);
  assert.equal(found.TsMeth.kind, "method");
  assert.equal(found.Py_method.kind, "method");
  assert.equal(found.TsIface.kind, "interface");
  assert.equal(found.RsTrait.kind, "interface");
  assert.equal(found.JlAbs.kind, "interface");
  assert.equal(found.GoAlias.kind, "type-alias");
  assert.equal(found.KtObj.kind, "class");
  assert.equal(found.CcUnion.kind, "class");
});

test("comment lines are not uses, in the slash and hash families", () => {
  const dir = makeRepo({
    "web/cm.ts": "function onlyCm() {}\n// onlyCm is here\n/* onlyCm */\n * onlyCm\nonlyCm();\n",
    "py/cm.py": "def only_cm():\n    return 1\n# only_cm\nonly_cm()\n",
  });
  const found = byName(scan(dir, ["candidates"]).json);
  assert.equal(found.onlyCm.uses.production, 1);
  assert.equal(found.only_cm.uses.production, 1);
});

test("visibility hints for C static, C header, Julia export, and Go internal", () => {
  const dir = makeRepo({
    "c/s.c": "static int stat_fn(void) {\n    return 1;\n}\nint s_use(void) {\n    return stat_fn();\n}\n",
    "c/h.h": "int hdr_fn(void) {\n    return 1;\n}\n",
    "c/h2.c": "int h_use(void) {\n    return hdr_fn();\n}\n",
    "jl/e.jl": "export pub_fn\nfunction pub_fn(x)\n    return x\nend\nfunction priv_fn(x)\n    return x\nend\nuse2() = pub_fn(1) + priv_fn(2)\n",
  });
  const found = byName(scan(dir, ["candidates"]).json);
  assert.equal(found.stat_fn.visibility, "private");
  assert.equal(found.hdr_fn.visibility, "exported");
  assert.equal(found.pub_fn.visibility, "exported");
  assert.equal(found.priv_fn.visibility, "unknown");
});

test("forms lists the table", () => {
  const { json, status } = scan(makeRepo(), ["forms"]);
  assert.equal(status, 0);
  const ids = json.languages.map((l) => l.id);
  for (const id of ["typescript-javascript", "python", "go", "rust", "java", "kotlin", "c-cpp", "julia"]) {
    assert.ok(ids.includes(id), id);
  }
});

test("no command writes to the repository", () => {
  const dir = makeRepo();
  const before = snapshot(dir);
  for (const args of [["candidates"], ["refs", "helperOnce"], ["forms"], ["verdict", "x", "web/a.ts", "--offline"]]) {
    scan(dir, args);
  }
  assert.deepEqual(snapshot(dir), before);
});

test("in a git repository, ignored files are not scanned", () => {
  const dir = makeRepo({
    ".gitignore": "gen/\n",
    "gen/g.ts": "function genOnly() {}\ngenOnly();\nhelperOnce(1);\n",
  });
  const run = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  run("init", "-q");
  const { json } = scan(dir, ["candidates"]);
  const found = byName(json);
  assert.equal(found.genOnly, undefined);
  assert.equal(found.helperOnce.uses.production, 1);
  assert.ok(json.excludedDirs.includes("gen"));
});

test("a use on the same line as the declaration, outside the body, counts", () => {
  const dir = makeRepo({
    "web/same.ts": "function sameLine() { return 1; } sameLine();\nsameLine();\n",
  });
  assert.equal(byName(scan(dir, ["candidates"]).json).sameLine, undefined);
  const one = makeRepo({ "web/same.ts": "function sameLine() { return 1; } sameLine();\n" });
  assert.equal(byName(scan(one, ["candidates"]).json).sameLine.uses.production, 1);
});

test("very long lines do not stall the scan", () => {
  const params = "int a, ".repeat(150000);
  const dir = makeRepo({
    "c/long.c": `int long_fn(${params}int z) {\n    return 1;\n}\n`,
    "web/long.ts": `function longFn(${params.replaceAll("int ", "")}z) { return 1; }\n`,
    "web/min.js": `${"var q=function(){return 1};".repeat(50000)}\n`,
  });
  const started = Date.now();
  const { status } = scan(dir, ["candidates"]);
  assert.equal(status, 0);
  assert.ok(Date.now() - started < 20000);
});

test("an empty repository gives no candidates and exit 0", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "single-use-empty-")));
  const { status, json } = scan(dir, ["candidates"]);
  assert.equal(status, 0);
  assert.deepEqual(json.candidates, []);
});

test("a symlink outside the tree, a large file, and a directory link are skipped", () => {
  const dir = makeRepo({ "big/huge.ts": `${"//".padEnd(100, "x")}\n`.repeat(30000) });
  const elsewhere = outside();
  writeFileSync(join(elsewhere, "far.ts"), "export function far() {}\n");
  symlinkSync(join(elsewhere, "far.ts"), join(dir, "web/far.ts"));
  symlinkSync(elsewhere, join(dir, "linked"));
  const { json } = scan(dir, ["candidates"]);
  assert.ok(json.skippedFiles.includes("web/far.ts"));
  assert.ok(json.skippedFiles.includes("big/huge.ts"));
  assert.ok(json.skippedFiles.includes("linked"));
  assert.equal(byName(json).far, undefined);
});

test("a source tree under vendor is reported in excludedDirs", () => {
  const dir = makeRepo({ "vendor/lib.js": "function v() {}\n" });
  assert.ok(scan(dir, ["candidates"]).json.excludedDirs.includes("vendor"));
});

test("verdict: private package is internal-only; another package naming the symbol is exported", () => {
  const dir = makeRepo({
    "pkgb/package.json": JSON.stringify({ name: "other" }),
    "pkgb/use.ts": "helperOnce();\n",
  });
  const priv = scan(dir, ["verdict", "arrowOnce", "web/a.ts", "--offline"]).json;
  assert.equal(priv.verdict, "internal-only");
  const hit = scan(dir, ["verdict", "helperOnce", "web/a.ts", "--offline"]).json;
  assert.equal(hit.verdict, "exported-with-hits");
});

test("verdict: published package is unknown offline; Go internal/ and the flag clear it", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "single-use-pkg-")));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pub" }));
  writeFileSync(join(dir, "a.ts"), "export function f() {}\n");
  mkdirSync(join(dir, "internal"));
  writeFileSync(join(dir, "internal/x.go"), "package x\nfunc F() {}\n");
  assert.equal(scan(dir, ["verdict", "f", "a.ts", "--offline"]).json.verdict, "unknown");
  assert.equal(scan(dir, ["verdict", "f", "a.ts", "--assume-unpublished"]).json.verdict, "internal-only");
  assert.equal(scan(dir, ["verdict", "F", "internal/x.go", "--offline"]).json.verdict, "internal-only");
});

const good = (over = {}) => ({
  id: "f1",
  source: "script",
  check: "single-use",
  severity: "low",
  file: "web/a.ts",
  line: 2,
  symbol: "helperOnce",
  evidenceSource: ["text", "read"],
  evidence: "one call at web/a.ts:30",
  proposal: "Inline helperOnce into main2; run the web tests.",
  refused: false,
  judgment: "confirmed",
  judgmentReason: "body is one expression, no seam",
  consumerVerdict: "internal-only",
  ...over,
});

const report = (dir, findings, extra = []) =>
  scan(dir, ["report", "-", ...extra], JSON.stringify({ skippedFiles: [], excludedDirs: [], findings }));

test("report validates, ranks, and exits 1 when a finding is reported", () => {
  const dir = makeRepo();
  const out = join(outside(), "f.json");
  const { status, stdout } = report(dir, [good(), good({ id: "f2", symbol: "other", severity: "medium", raiseReason: "adds a layer with no seam" })], ["--out", out]);
  assert.equal(status, 1);
  assert.match(stdout, /candidates 2, reported 2/);
  assert.match(stdout, /1\. \[medium\]/);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).tool, "useless-abstraction-scan");
});

test("report exits 0 when every finding is refused or dropped", () => {
  const dir = makeRepo();
  const refused = good({ refused: true, reason: "seam", proposal: "none" });
  const dropped = good({ id: "f2", symbol: "b", judgment: "dropped" });
  const { status, stdout } = report(dir, [refused, dropped]);
  assert.equal(status, 0);
  assert.match(stdout, /refused \(seam\)/);
});

test("report rejects malformed findings with exit 2", () => {
  const dir = makeRepo();
  const bad = [
    good({ check: "nonsense" }),
    good({ refused: true, reason: "because", proposal: "none" }),
    good({ refused: true, reason: "seam" }),
    good({ consumerVerdict: "exported-no-hits" }),
    good({ consumerVerdict: "maybe" }),
    good({ proposal: "none" }),
    good({ severity: "medium" }),
    good({ gates: ["has-own-tests"], judgment: "downgraded" }),
    good({ gates: ["named-intent"], judgment: "confirmed" }),
    good({ judgment: "downgraded" }),
    good({ gates: ["bogus"], judgment: "downgraded" }),
    good({ evidenceSource: "guess" }),
    good({ judgmentReason: "" }),
  ];
  for (const finding of bad) {
    const { status, stderr } = report(dir, [finding]);
    assert.equal(status, 2, JSON.stringify(finding));
    assert.match(stderr, /invalid findings/);
  }
  assert.equal(report(dir, [good(), good()]).status, 2);
  assert.equal(scan(dir, ["report", "-"], "not json").status, 2);
});

test("report accepts a downgrade that names its gate and its tests", () => {
  const dir = makeRepo();
  const finding = good({
    gates: ["has-own-tests"],
    judgment: "downgraded",
    testsNamed: ["web/a.test.ts"],
  });
  assert.equal(report(dir, [finding]).status, 1);
});

test("report --out must be outside the repository and not a symlink", () => {
  const dir = makeRepo();
  assert.equal(report(dir, [good()], ["--out", join(dir, "findings.json")]).status, 2);
  assert.equal(report(dir, [good()], ["--out", "findings.json"]).status, 2);
  const elsewhere = outside();
  const target = join(elsewhere, "target.json");
  writeFileSync(target, "{}\n");
  const link = join(elsewhere, "link.json");
  symlinkSync(target, link);
  const viaLink = report(dir, [good()], ["--out", link]);
  assert.equal(viaLink.status, 2);
  assert.match(viaLink.stderr, /symlink/);
  assert.equal(readFileSync(target, "utf8"), "{}\n");
  const missing = report(dir, [good()], ["--out", join(elsewhere, "nodir", "f.json")]);
  assert.equal(missing.status, 2);
});

test("report --out refuses a file with another hard link", () => {
  const dir = makeRepo();
  const elsewhere = outside();
  const first = join(elsewhere, "first.json");
  report(dir, [good()], ["--out", first]);
  const second = join(dir, "linked.json");
  linkSync(first, second);
  const before = readFileSync(second, "utf8");
  const run = report(dir, [good({ symbol: "next" })], ["--out", first]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /hard links/);
  assert.equal(readFileSync(second, "utf8"), before);
});

test("report --out refuses to replace a file that is not a findings file", () => {
  const dir = makeRepo();
  const target = join(outside(), "notes.txt");
  writeFileSync(target, "keep me\n");
  assert.equal(report(dir, [good()], ["--out", target]).status, 2);
  assert.equal(readFileSync(target, "utf8"), "keep me\n");
  const fresh = join(outside(), "again.json");
  report(dir, [good()], ["--out", fresh]);
  assert.equal(report(dir, [good({ symbol: "next" })], ["--out", fresh]).status, 1);
});

test("unknown commands and options exit 2", () => {
  const dir = makeRepo();
  assert.equal(scan(dir, ["nope"]).status, 2);
  assert.equal(scan(dir, ["candidates", "--bogus"]).status, 2);
  assert.equal(scan(dir, []).status, 0);
});

// --- review-lens modes ---------------------------------------------------

function gitRun(dir, ...args) {
  const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
}

function changeSetRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "single-use-diff-")));
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  put("u.ts", [
    "export function droppedToOne() { return 1; }",
    "export function untouchedOnce() { return 2; }",
    "export function delUse() { return 3; }",
    "",
  ].join("\n"));
  put("x.ts", "function inTouched() { return 4; }\ndroppedToOne();\ninTouched();\nuntouchedOnce();\ndelUse();\n");
  put("y.ts", "droppedToOne();\n");
  put("d.ts", "delUse();\n");
  gitRun(dir, "init", "-q", "-b", "main");
  gitRun(dir, "add", "-A");
  gitRun(dir, "commit", "-q", "-m", "base");
  gitRun(dir, "checkout", "-q", "-b", "feature");
  put("y.ts", "// no use left\n");
  put("x.ts", "function inTouched() { return 4; }\n// edited\ndroppedToOne();\ninTouched();\nuntouchedOnce();\ndelUse();\n");
  put("n.ts", "function addedHelper() { return 5; }\naddedHelper();\n");
  rmSync(join(dir, "d.ts"));
  gitRun(dir, "add", "-A");
  gitRun(dir, "commit", "-q", "-m", "change");
  return { dir, put };
}

test("candidates --diff selects added, changed-file, and use-count-fell-to-one declarations", () => {
  const { dir } = changeSetRepo();
  const all = byName(scan(dir, ["candidates"]).json);
  assert.ok(all.untouchedOnce);
  const { json, status } = scan(dir, ["candidates", "--diff"]);
  assert.equal(status, 0);
  const found = byName(json);
  assert.deepEqual(Object.keys(found).sort(), ["addedHelper", "delUse", "droppedToOne", "inTouched"]);
  assert.deepEqual(found.addedHelper.diff.reasons, ["declared-in-changed-file"]);
  assert.deepEqual(found.inTouched.diff.reasons, ["declared-in-changed-file"]);
  assert.deepEqual(found.droppedToOne.diff, { reasons: ["use-count-fell-to-one"], usesAtBase: 2 });
  assert.deepEqual(found.delUse.diff, { reasons: ["use-count-fell-to-one"], usesAtBase: 2 });
  assert.equal(json.scope.mode, "diff");
  assert.equal(json.scope.base, "main");
  assert.equal(json.scope.changedFiles, 4);
});

test("--diff counts uses in the whole tree, not only in the diff", () => {
  const { dir } = changeSetRepo();
  const found = byName(scan(dir, ["candidates", "--diff"]).json);
  assert.equal(found.droppedToOne.uses.production, 1);
  assert.equal(found.droppedToOne.site.file, "x.ts");
  assert.equal(found.inTouched.uses.production, 1);
});

test("--diff takes --base and --scope, and fails without a base", () => {
  const { dir } = changeSetRepo();
  const scoped = scan(dir, ["candidates", "--diff", "--base", "main", "--scope", "n.ts"]).json;
  assert.deepEqual(scoped.candidates.map((c) => c.name), ["addedHelper"]);
  const none = scan(dir, ["candidates", "--diff", "--base", "nope"]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no base ref/);
  assert.equal(scan(makeRepo(), ["candidates", "--diff"]).status, 2);
});

test("--working-tree adds uncommitted and untracked files to the change", () => {
  const { dir, put } = changeSetRepo();
  put("w.ts", "function wipHelper() { return 6; }\nwipHelper();\n");
  assert.equal(byName(scan(dir, ["candidates", "--diff"]).json).wipHelper, undefined);
  assert.ok(byName(scan(dir, ["candidates", "--diff", "--working-tree"]).json).wipHelper);
});

test("without --working-tree the scan reads committed content", () => {
  const { dir, put } = changeSetRepo();
  put("x.ts", "function inTouched() { return 4; }\ninTouched();\nuntouchedOnce();\ndelUse();\n");
  put("z.ts", "export function extraUse() {}\n");
  put("z2.ts", "extraUse();\n");
  const committed = byName(scan(dir, ["candidates", "--diff"]).json);
  assert.equal(committed.droppedToOne.uses.production, 1);
  assert.equal(committed.extraUse, undefined);
  const live = byName(scan(dir, ["candidates", "--diff", "--working-tree"]).json);
  assert.equal(live.droppedToOne, undefined);
  assert.ok(live.extraUse);
});

test("an interface with several uses and one implementer is not a use-count drop", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "single-use-iface-")));
  writeFileSync(join(dir, "i.ts"), "export interface Port { n: number }\nclass A implements Port { n = 1 }\nlet a: Port;\nlet b: Port;\n");
  writeFileSync(join(dir, "j.ts"), "const k = 1;\n");
  gitRun(dir, "init", "-q", "-b", "main");
  gitRun(dir, "add", "-A");
  gitRun(dir, "commit", "-q", "-m", "base");
  gitRun(dir, "checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "j.ts"), "const k = 2;\n");
  gitRun(dir, "commit", "-q", "-am", "change");
  assert.ok(byName(scan(dir, ["candidates"]).json).Port.checks.includes("single-impl"));
  assert.equal(byName(scan(dir, ["candidates", "--diff"]).json).Port, undefined);
});

test("diff-scope lists the changed files and the scope paths", () => {
  const { dir } = changeSetRepo();
  const { json, status } = scan(dir, ["diff-scope"]);
  assert.equal(status, 0);
  assert.deepEqual(json.paths.sort(), ["n.ts", "x.ts", "y.ts"]);
  assert.deepEqual(json.files.map((f) => f.status).sort(), ["A", "D", "M", "M"]);
  assert.equal(json.mergeBase.length, 40);
  assert.equal(scan(makeRepo(), ["diff-scope"]).status, 2);
});

test("a renamed file counts its base version for the base use count", () => {
  const { dir } = changeSetRepo();
  gitRun(dir, "mv", "x.ts", "x2.ts");
  gitRun(dir, "commit", "-q", "-am", "rename");
  const found = byName(scan(dir, ["candidates", "--diff"]).json);
  assert.ok(found.inTouched);
  assert.equal(found.droppedToOne.diff.usesAtBase, 2);
});

const wireInput = [
  good(),
  good({ id: "r1", symbol: "seamy", refused: true, reason: "public-api", proposal: "none", consumerVerdict: "unknown", worthALook: true, confirm: "Ask whether outside packages import seamy." }),
  good({ id: "r2", symbol: "quiet", refused: true, reason: "seam", proposal: "none" }),
  good({ id: "d1", symbol: "gone", judgment: "dropped" }),
  good({ id: "l1", symbol: "viaLsp", evidenceSource: ["lsp", "read"], severity: "medium", raiseReason: "adds a layer with no seam", source: "reviewer" }),
];

test("report --wire prints the lens wire format and the headline", () => {
  const dir = makeRepo();
  const out = join(outside(), "w.json");
  const { status, json, stderr } = scan(dir, ["report", "-", "--wire", "--out", out], JSON.stringify({ findings: wireInput }));
  assert.equal(status, 1);
  assert.equal(stderr.trim(), "needs-attention");
  assert.equal(json.length, 3);
  for (const entry of json) {
    assert.deepEqual(Object.keys(entry).sort(), ["body", "evidence", "line", "path", "severity", "source", "suggested_fix", "title"]);
    assert.equal(entry.source, "useless-abstraction-scan");
  }
  const [reported, confirm, lsp] = json;
  assert.equal(reported.severity, "low");
  assert.equal(reported.suggested_fix, wireInput[0].proposal);
  assert.match(reported.evidence, /^Inferred: .*text\+read.*finding source script/);
  assert.equal(confirm.severity, "low");
  assert.match(confirm.title, /Confirm before collapsing seamy \(public-api\)/);
  assert.equal(confirm.suggested_fix, "Ask whether outside packages import seamy.");
  assert.equal(lsp.severity, "medium");
  assert.match(lsp.evidence, /^Verified: .*lsp\+read.*finding source reviewer/);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).tool, "useless-abstraction-scan");
});

test("report --wire gives an empty list and approve when nothing is reported", () => {
  const { status, json, stderr } = scan(makeRepo(), ["report", "-", "--wire"], JSON.stringify([
    good({ refused: true, reason: "seam", proposal: "none" }),
  ]));
  assert.equal(status, 0);
  assert.deepEqual(json, []);
  assert.equal(stderr.trim(), "approve");
});

test("report --wire exits 1 when only a worth-a-look refusal is returned", () => {
  const only = good({ refused: true, reason: "public-api", proposal: "none", consumerVerdict: "unknown", worthALook: true, confirm: "Ask about outside users." });
  const { status, json, stderr } = scan(makeRepo(), ["report", "-", "--wire"], JSON.stringify([only]));
  assert.equal(status, 1);
  assert.equal(json.length, 1);
  assert.equal(stderr.trim(), "needs-attention");
});

test("worthALook needs a confirm text", () => {
  const bad = good({ refused: true, reason: "seam", proposal: "none", worthALook: true });
  assert.equal(report(makeRepo(), [bad]).status, 2);
});
