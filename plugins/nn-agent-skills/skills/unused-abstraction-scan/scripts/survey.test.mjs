// Run with: node --test plugins/nn-agent-skills/skills/unused-abstraction-scan/scripts/
//
// Each test builds a small multi-language repo in a temp dir and runs the CLI
// in it. The helpers find candidates by text, so the tests check the exact
// forms they claim to handle and that nothing in the repo is written.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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

const cli = join(dirname(fileURLToPath(import.meta.url)), "survey.mjs");

const files = {
  "package.json": JSON.stringify({ name: "fx", private: true }),
  "web/options.ts": `export interface RunOptions {
  /** This is not implemented, so setting it has no effect. */
  immediate?: boolean;
  verbose?: boolean;
}
export interface Empty {}
`,
  "web/use.ts": `import { RunOptions } from "./options";
export function go(opts: RunOptions, _options?: RunOptions) {
  return opts.verbose;
}
`,
  "web/use.test.ts": "const x = { immediate: true };\n",
  "py/cfg.py": `class Settings:
    pass


class Real:
    def __init__(self, _options=None):
        # This option has no effect.
        self.x = 1
`,
  "go/types.go": `package types

type Marker struct{}

// Timeout is ignored by the runner.
type Config struct {
	Timeout int
}
`,
  "rs/lib.rs": `pub struct Unit;
pub struct Opts {}
`,
  "java/Box.java": `public class Box {}
`,
  "cpp/box.hpp": `struct Box {};
`,
  "jl/Lib.jl": `struct Nothing1 end
mutable struct Nothing2 end
`,
};

function makeRepo(extra = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unused-abstraction-")));
  for (const [path, text] of Object.entries({ ...files, ...extra })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function survey(dir, args, env = {}) {
  const run = spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  let json = null;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    // Text output or an error.
  }
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, json };
}

const tree = (dir) => readdirSync(dir, { recursive: true }).sort();

test("inert finds comments in several languages and the next declaration", () => {
  const { status, json } = survey(makeRepo(), ["inert"]);
  assert.equal(status, 0);
  const at = (file) => json.candidates.filter((c) => c.file === file);
  assert.equal(at("web/options.ts")[0].declaration, "immediate?: boolean;");
  assert.match(at("py/cfg.py")[0].comment, /has no effect/);
  assert.equal(at("py/cfg.py")[0].declaration, "self.x = 1");
  assert.equal(at("go/types.go")[0].declaration, "type Config struct {");
});

test("inert takes custom phrases and skips test files", () => {
  const dir = makeRepo({ "web/a.test.ts": "// has no effect\nconst z = 1;\n" });
  const { json } = survey(dir, ["inert", "--phrase", "will never run"]);
  assert.deepEqual(json.candidates, []);
  const all = survey(dir, ["inert"]).json;
  assert.ok(all.candidates.every((c) => !c.file.endsWith(".test.ts")));
});

test("refs separates production from test and access from other shapes", () => {
  const { json } = survey(makeRepo(), ["refs", "immediate"]);
  assert.equal(json.evidenceSource, "text");
  assert.equal(json.counts.production, 1);
  assert.equal(json.counts.productionAccess, 0);
  assert.equal(json.counts.test, 1);

  const verbose = survey(makeRepo(), ["refs", "verbose"]).json;
  assert.equal(verbose.counts.productionAccess, 1);
});

test("refs ignores comment lines and matches whole words only", () => {
  const dir = makeRepo({ "web/c.ts": "// timeout here\nconst timeouts = 1;\n" });
  assert.equal(survey(dir, ["refs", "timeout"]).json.counts.production, 0);
});

test("refs matches member access in other languages", () => {
  const dir = makeRepo({
    "rs/use.rs": "fn f(c: &Opts) -> u32 { c->level + c::level }\n",
    "py/use.py": "def f(c):\n    return c.level\n",
  });
  assert.equal(survey(dir, ["refs", "level"]).json.counts.productionAccess, 2);
});

test("empty-types finds every listed form", () => {
  const { json } = survey(makeRepo(), ["empty-types"]);
  const names = json.candidates.map((c) => c.name).sort();
  assert.deepEqual(names, [
    "Box",
    "Box",
    "Empty",
    "Marker",
    "Nothing1",
    "Nothing2",
    "Opts",
    "Settings",
    "Unit",
  ]);
  const empty = json.candidates.find((c) => c.name === "Empty");
  assert.equal(empty.usesInOtherProductionFiles, 0);
});

test("ignored lists option-like names under the default pattern", () => {
  const { json } = survey(makeRepo(), ["ignored"]);
  assert.deepEqual(
    json.candidates.map((c) => `${c.file}:${c.name}`).sort(),
    ["py/cfg.py:_options", "web/use.ts:_options"]
  );
  const custom = survey(makeRepo(), ["ignored", "--pattern", "^x$"]).json;
  assert.deepEqual(custom.candidates.map((c) => c.name), ["x"]);
});

test("--scope limits matches and rejects a path outside the tree", () => {
  const dir = makeRepo();
  const { json } = survey(dir, ["empty-types", "--scope", "go"]);
  assert.deepEqual(json.candidates.map((c) => c.name), ["Marker"]);
  assert.equal(survey(dir, ["inert", "--scope", "../elsewhere"]).status, 2);
});

test("--ext adds a source extension", () => {
  const dir = makeRepo({ "x/a.zz": "// has no effect\nfoo\n" });
  assert.ok(!survey(dir, ["inert"]).json.candidates.some((c) => c.file === "x/a.zz"));
  assert.ok(survey(dir, ["inert", "--ext", ".zz"]).json.candidates.some((c) => c.file === "x/a.zz"));
});

test("verdict: private package is internal-only", () => {
  const { json } = survey(makeRepo(), ["verdict", "RunOptions", "web/options.ts"]);
  assert.equal(json.verdict, "internal-only");
  assert.equal(json.package.manifest, "package.json");
});

test("verdict: a name in another package is exported-with-hits", () => {
  const dir = makeRepo({
    "other/Cargo.toml": '[package]\nname = "other"\npublish = false\n',
    "other/src/lib.rs": "use fx::RunOptions;\n",
  });
  const { json } = survey(dir, ["verdict", "RunOptions", "web/options.ts"]);
  assert.equal(json.verdict, "exported-with-hits");
  assert.match(json.detail, /other\/src\/lib\.rs:1/);
});

test("verdict: published package is unknown offline", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const { json } = survey(dir, ["verdict", "RunOptions", "web/options.ts", "--offline"]);
  assert.equal(json.verdict, "unknown");
});

test("verdict: --assume-unpublished clears a published package", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const { json } = survey(dir, ["verdict", "RunOptions", "web/options.ts", "--assume-unpublished"]);
  assert.equal(json.verdict, "internal-only");
});

test("verdict: manifests of other languages give privacy and names", () => {
  const dir = makeRepo({
    "crate/Cargo.toml": '[package]\nname = "c"\npublish = false\n',
    "crate/src/lib.rs": "pub struct QRust {}\n",
    "pyapp/pyproject.toml": '[project]\nname = "pyapp"\nclassifiers = ["Private :: Do Not Upload"]\n',
    "pyapp/m.py": "class QPy: pass\n",
    "gomod/go.mod": "module example.com/gomod\n",
    "gomod/internal/x.go": "package x\n",
  });
  assert.equal(survey(dir, ["verdict", "QRust", "crate/src/lib.rs"]).json.verdict, "internal-only");
  assert.equal(survey(dir, ["verdict", "QPy", "pyapp/m.py"]).json.verdict, "internal-only");
  const go = survey(dir, ["verdict", "Z", "gomod/internal/x.go"]).json;
  assert.equal(go.verdict, "internal-only");
  assert.equal(go.package.name, "example.com/gomod");
});

function fakeGh(dir, body) {
  const bin = join(dir, "fake-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, "gh"), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

test("verdict: gh hits in another repository give exported-with-hits", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const env = fakeGh(
    dir,
    `if [ "$1" = repo ]; then echo me/fx; exit 0; fi
echo '[{"repository":{"nameWithOwner":"other/app"},"path":"a.ts"}]'`
  );
  const { json } = survey(dir, ["verdict", "RunOptions", "web/options.ts"], env);
  assert.equal(json.verdict, "exported-with-hits");
  assert.match(json.detail, /other\/app:a\.ts/);
});

test("verdict: gh with no foreign hits is exported-no-hits, a failing gh is unknown", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const none = fakeGh(dir, `if [ "$1" = repo ]; then echo me/fx; exit 0; fi\necho '[]'`);
  assert.equal(survey(dir, ["verdict", "RunOptions", "web/options.ts"], none).json.verdict, "exported-no-hits");
  const dir2 = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const bad = fakeGh(dir2, "exit 1");
  assert.equal(survey(dir2, ["verdict", "RunOptions", "web/options.ts"], bad).json.verdict, "unknown");
});

test("a symlink to a file outside the tree is listed as skipped", () => {
  const outside = makeRepo();
  const dir = makeRepo();
  symlinkSync(join(outside, "web/use.ts"), join(dir, "web/leak.ts"));
  assert.deepEqual(survey(dir, ["refs", "x"]).json.skippedFiles, ["web/leak.ts"]);
});

test("a symlink to a listed file inside the tree is ignored", () => {
  const dir = makeRepo();
  symlinkSync(join(dir, "web/use.ts"), join(dir, "web/alias.ts"));
  assert.deepEqual(survey(dir, ["refs", "x"]).json.skippedFiles, []);
});

test("an oversized file is listed as skipped", () => {
  const dir = makeRepo({ "web/big.ts": `// ${"x".repeat(2 * 1024 * 1024)}\n` });
  assert.deepEqual(survey(dir, ["refs", "x"]).json.skippedFiles, ["web/big.ts"]);
});

test("an empty directory gives empty results", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unused-abstraction-")));
  assert.deepEqual(survey(dir, ["inert"]).json.candidates, []);
  assert.deepEqual(survey(dir, ["empty-types"]).json.candidates, []);
});

test("commands do not write to the repository", () => {
  const dir = makeRepo();
  const before = tree(dir);
  const contents = readFileSync(join(dir, "web/options.ts"), "utf8");
  for (const args of [["inert"], ["refs", "verbose"], ["empty-types"], ["ignored"], ["verdict", "RunOptions", "web/options.ts", "--offline"]]) {
    survey(dir, args);
  }
  assert.deepEqual(tree(dir), before);
  assert.equal(readFileSync(join(dir, "web/options.ts"), "utf8"), contents);
});

const finding = (extra = {}) => ({
  id: "f1",
  source: "script",
  check: "inert-doc",
  severity: "medium",
  file: "web/options.ts",
  line: 3,
  symbol: "RunOptions.immediate",
  evidenceSource: ["text", "read"],
  evidence: "no production access",
  proposal: "delete the field and run the type check",
  refused: false,
  judgment: "confirmed",
  judgmentReason: "read the callers",
  ...extra,
});

function writeInput(dir, findings, extra = {}) {
  const path = join(dir, "..", `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({ findings, ...extra }));
  return path;
}

test("report ranks findings, counts judgments, and writes the named file", () => {
  const dir = makeRepo();
  const input = writeInput(
    dir,
    [
      finding(),
      finding({ id: "f2", source: "reviewer", severity: "low", symbol: "wrap", evidenceSource: "lsp" }),
      finding({ id: "f3", refused: true, reason: "verdict unknown", proposal: "none" }),
      finding({ id: "f4", judgment: "dropped", judgmentReason: "read by a no-op copy only" }),
    ],
    { skippedFiles: ["a.ts"] }
  );
  const out = join(dir, "..", `out-${Math.random().toString(36).slice(2)}.json`);
  const { status, stdout } = survey(dir, ["report", input, "--out", out]);
  assert.equal(status, 1);
  assert.match(stdout, /^candidates 4, reported 2, refused 1, dropped 1, by reviewer 1\n1\. \[medium\] \(script, text\+read\) web\/options\.ts:3/);
  assert.match(stdout, /2\. \[low\] \(reviewer, lsp\)/);
  assert.match(stdout, /skipped files: 1/);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).counts.reported, 2);
});

test("report rejects findings without judgment, evidence source, or reason", () => {
  const dir = makeRepo();
  for (const bad of [
    finding({ judgment: undefined }),
    finding({ evidenceSource: "guess" }),
    finding({ refused: true, proposal: "none" }),
    finding({ source: "model" }),
  ]) {
    const { status, stderr } = survey(dir, ["report", writeInput(dir, [bad])]);
    assert.equal(status, 2);
    assert.match(stderr, /invalid findings/);
  }
});

test("report exits 0 when nothing is reported", () => {
  const dir = makeRepo();
  const input = writeInput(dir, [finding({ judgment: "dropped" })]);
  assert.equal(survey(dir, ["report", input]).status, 0);
});

test("report refuses to overwrite a file that is not a findings file", () => {
  const dir = makeRepo();
  const input = writeInput(dir, [finding()]);
  const { status, stderr } = survey(dir, ["report", input, "--out", "web/options.ts"]);
  assert.equal(status, 2);
  assert.match(stderr, /not a findings file/);
  assert.match(readFileSync(join(dir, "web/options.ts"), "utf8"), /RunOptions/);
});

test("bad arguments exit 2", () => {
  const dir = makeRepo();
  assert.equal(survey(dir, ["bogus"]).status, 2);
  assert.equal(survey(dir, ["refs"]).status, 2);
  assert.equal(survey(dir, ["inert", "--bogus"]).status, 2);
  assert.equal(survey(dir, ["ignored", "--pattern", "("]).status, 2);
  assert.equal(survey(dir, ["verdict", "OnlySymbol"]).status, 2);
  assert.equal(survey(dir, ["report", "/no/such/file.json"]).status, 2);
});

test("report reads findings from stdin", () => {
  const dir = makeRepo();
  const run = spawnSync(process.execPath, [cli, "report", "-"], {
    cwd: dir,
    encoding: "utf8",
    input: JSON.stringify([finding()]),
  });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^candidates 1, reported 1/);
});

test("excluded source trees and directory symlinks are reported", () => {
  const dir = makeRepo({ "vendor/lib/a.go": "package a\n", "node_modules/x/y.js": "1\n" });
  symlinkSync(join(dir, "go"), join(dir, "golink"));
  const { json } = survey(dir, ["refs", "x"]);
  assert.deepEqual(json.excludedDirs, ["vendor"]);
  assert.deepEqual(json.skippedFiles, ["golink"]);
});

test("verdict: an internal/ directory is private for Go files only", () => {
  const dir = makeRepo({
    "gomod/go.mod": "module example.com/gomod\n",
    "gomod/internal/x.go": "package x\n",
    "gomod/internal/y.rs": "pub struct Y;\n",
  });
  assert.equal(survey(dir, ["verdict", "Z", "gomod/internal/x.go", "--offline"]).json.verdict, "internal-only");
  assert.equal(survey(dir, ["verdict", "Y", "gomod/internal/y.rs", "--offline"]).json.verdict, "unknown");
});
