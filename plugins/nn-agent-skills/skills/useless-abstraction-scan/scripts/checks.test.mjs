// Run with: node --test plugins/nn-agent-skills/skills/useless-abstraction-scan/scripts/
//
// Covers the no-reader checks: inert comments, empty types, ignored option
// names, the diff scope that limits them, and findings of those checks in
// `report`. `scan.test.mjs` covers the single-use checks and the shared
// machinery.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "useless-checks-")));
  for (const [path, text] of Object.entries({ ...files, ...extra })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function scan(dir, args, input) {
  const run = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8", input });
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
  const { status, json } = scan(makeRepo(), ["inert"]);
  assert.equal(status, 0);
  assert.equal(json.scope.mode, "repo");
  const at = (file) => json.candidates.filter((c) => c.file === file);
  assert.equal(at("web/options.ts")[0].declaration, "immediate?: boolean;");
  assert.match(at("py/cfg.py")[0].comment, /has no effect/);
  assert.equal(at("py/cfg.py")[0].declaration, "self.x = 1");
  assert.equal(at("go/types.go")[0].declaration, "type Config struct {");
});

test("inert takes custom phrases and skips test files", () => {
  const dir = makeRepo({ "web/a.test.ts": "// has no effect\nconst z = 1;\n" });
  assert.deepEqual(scan(dir, ["inert", "--phrase", "will never run"]).json.candidates, []);
  assert.ok(scan(dir, ["inert"]).json.candidates.every((c) => !c.file.endsWith(".test.ts")));
});

test("refs is repo-wide and takes no scope option", () => {
  const dir = makeRepo();
  const { json } = scan(dir, ["refs", "immediate"]);
  assert.equal(json.counts.production, 1);
  assert.equal(json.counts.productionAccess, 0);
  assert.equal(json.counts.test, 1);
  assert.equal(scan(dir, ["refs", "verbose"]).json.counts.productionAccess, 1);
  assert.equal(scan(dir, ["refs", "immediate", "--scope", "web/use.ts"]).status, 2);
});

test("empty-types finds every listed form", () => {
  const { json } = scan(makeRepo(), ["empty-types"]);
  assert.deepEqual(json.candidates.map((c) => c.name).sort(), [
    "Box", "Box", "Empty", "Marker", "Nothing1", "Nothing2", "Opts", "Settings", "Unit",
  ]);
  const empty = json.candidates.find((c) => c.name === "Empty");
  assert.equal(empty.usesInOtherProductionFiles, 0);
});

test("ignored lists option-like names under the default pattern", () => {
  const dir = makeRepo();
  const { json } = scan(dir, ["ignored"]);
  assert.deepEqual(
    json.candidates.map((c) => `${c.file}:${c.name}`).sort(),
    ["py/cfg.py:_options", "web/use.ts:_options"]
  );
  assert.deepEqual(scan(dir, ["ignored", "--pattern", "^x$"]).json.candidates.map((c) => c.name), ["x"]);
  assert.equal(scan(dir, ["ignored", "--pattern", "("]).status, 2);
});

test("--scope limits candidates and rejects a path outside the tree", () => {
  const dir = makeRepo();
  assert.deepEqual(
    scan(dir, ["empty-types", "--scope", "go"]).json.candidates.map((c) => c.name),
    ["Marker"]
  );
  assert.equal(scan(dir, ["inert", "--scope", "../elsewhere"]).status, 2);
});

const gitEnv = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(dir, ...args) {
  const run = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...gitEnv } });
  assert.equal(run.status, 0, run.stderr);
}

/** Base commit on main with `old.ts`; branch `feature` adds `new.ts`. */
function makeGitRepo() {
  const dir = makeRepo({
    "src/old.ts": "export interface Old {\n  /** has no effect */\n  legacy?: boolean;\n}\n",
  });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "src/new.ts"), 'import { Old } from "./old";\n/** does nothing */\nexport const flag = 1;\nexport const o: Old = {};\n');
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "change");
  return dir;
}

test("--diff limits inert candidates to changed files and reports the scope", () => {
  const dir = makeGitRepo();
  assert.ok(scan(dir, ["inert"]).json.candidates.some((c) => c.file === "src/old.ts"));
  const { json } = scan(dir, ["inert", "--diff", "--base", "main"]);
  assert.deepEqual(json.candidates.map((c) => c.file), ["src/new.ts"]);
  assert.equal(json.scope.mode, "diff");
  assert.equal(json.scope.base, "main");
  assert.equal(json.scope.changedFiles, 1);
});

test("--diff and --scope must both hold", () => {
  const dir = makeGitRepo();
  assert.deepEqual(scan(dir, ["inert", "--diff", "--base", "main", "--scope", "src/old.ts"]).json.candidates, []);
  assert.equal(scan(dir, ["inert", "--diff", "--base", "main", "--scope", "src"]).json.candidates.length, 1);
});

test("--diff also limits empty-types and ignored candidates", () => {
  const dir = makeGitRepo();
  writeFileSync(join(dir, "src/new.ts"), "export interface Fresh {}\nexport function f(_options?: Fresh) {}\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "more");
  assert.deepEqual(scan(dir, ["empty-types", "--diff", "--base", "main"]).json.candidates.map((c) => c.name), ["Fresh"]);
  assert.deepEqual(scan(dir, ["ignored", "--diff", "--base", "main"]).json.candidates.map((c) => c.file), ["src/new.ts"]);
});

test("--diff reads committed content unless --working-tree is given", () => {
  const dir = makeGitRepo();
  writeFileSync(join(dir, "src/new.ts"), "export const flag = 1;\n");
  assert.equal(scan(dir, ["inert", "--diff", "--base", "main"]).json.candidates.length, 1);
  assert.equal(scan(dir, ["inert", "--diff", "--base", "main", "--working-tree"]).json.candidates.length, 0);
});

test("evidence stays repo-wide when candidates come from the diff", () => {
  const dir = makeGitRepo();
  const { json } = scan(dir, ["refs", "legacy"]);
  assert.ok(json.hits.some((h) => h.file === "src/old.ts"));
  assert.equal(scan(dir, ["verdict", "Old", "src/old.ts", "--offline"]).json.verdict, "internal-only");
});

test("verdict: manifests of other languages give privacy and names", () => {
  const dir = makeRepo({
    "crate/Cargo.toml": '[package]\nname = "c"\npublish = false\n',
    "crate/src/lib.rs": "pub struct QRust {}\n",
    "pyapp/pyproject.toml": '[project]\nname = "pyapp"\nclassifiers = ["Private :: Do Not Upload"]\n',
    "pyapp/m.py": "class QPy: pass\n",
    "pub/Cargo.toml": '[package]\nname = "pubcrate"\n',
    "pub/src/lib.rs": "pub struct QPub {}\n",
    "gomod/go.mod": "module example.com/gomod\n",
    "gomod/internal/x.go": "package x\n",
    "gomod/internal/y.rs": "pub struct Y;\n",
  });
  const verdict = (symbol, file) => scan(dir, ["verdict", symbol, file, "--offline"]).json;
  assert.equal(verdict("QRust", "crate/src/lib.rs").verdict, "internal-only");
  assert.equal(verdict("QPy", "pyapp/m.py").verdict, "internal-only");
  assert.equal(verdict("QPub", "pub/src/lib.rs").verdict, "unknown");
  assert.equal(verdict("Z", "gomod/internal/x.go").verdict, "internal-only");
  assert.equal(verdict("Z", "gomod/internal/x.go").package.name, "example.com/gomod");
  assert.equal(verdict("Y", "gomod/internal/y.rs").verdict, "unknown");
});

test("refs and verdict take --head to match a committed-content review", () => {
  const dir = makeGitRepo();
  writeFileSync(join(dir, "src/new.ts"), "export const flag = 1;\n");
  assert.equal(scan(dir, ["refs", "Old"]).json.counts.production, 1);
  assert.equal(scan(dir, ["refs", "Old", "--head"]).json.counts.production, 3);
  assert.equal(scan(dir, ["verdict", "Old", "src/old.ts", "--offline", "--head"]).json.verdict, "internal-only");
});

test("a reviewer-internal verdict needs a reviewer finding with lsp or read evidence", () => {
  const dir = makeRepo();
  const ok = finding({ source: "reviewer", consumerVerdict: "reviewer-internal", evidenceSource: ["read"] });
  assert.equal(scan(dir, ["report", "-"], JSON.stringify([ok])).status, 1);
  for (const bad of [{ source: "script" }, { evidenceSource: ["text"] }]) {
    const run = scan(dir, ["report", "-"], JSON.stringify([{ ...ok, ...bad }]));
    assert.equal(run.status, 2);
    assert.match(run.stderr, /reviewer-internal needs/);
  }
});

test("the new commands do not write to the repository", () => {
  const dir = makeRepo();
  const before = tree(dir);
  const contents = readFileSync(join(dir, "web/options.ts"), "utf8");
  for (const args of [["inert"], ["empty-types"], ["ignored"]]) {
    scan(dir, args);
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
  consumerVerdict: "internal-only",
  judgment: "confirmed",
  judgmentReason: "read the callers",
  ...extra,
});

test("report accepts the no-reader checks and ranks them", () => {
  const dir = makeRepo();
  const input = JSON.stringify([
    finding(),
    finding({ id: "f2", check: "unread-param", severity: "low", symbol: "_options" }),
    finding({ id: "f3", check: "empty-options", severity: "low", symbol: "Empty" }),
    finding({ id: "f4", check: "inert-doc", symbol: "LiveOptions.fast", refused: true, reason: "read-by-code", proposal: "none", consumerVerdict: "unknown" }),
  ]);
  const { status, stdout } = scan(dir, ["report", "-"], input);
  assert.equal(status, 1);
  assert.match(stdout, /^candidates 4, reported 3, refused 1/);
  assert.match(stdout, /1\. \[medium\] \(script, text\+read\) web\/options\.ts:3/);
  assert.match(stdout, /refused \(read-by-code\)/);
});

test("report rejects a free-text reason and unknown checks", () => {
  const dir = makeRepo();
  const free = scan(dir, ["report", "-"], JSON.stringify([finding({ refused: true, reason: "code reads it", proposal: "none" })]));
  assert.equal(free.status, 2);
  assert.match(free.stderr, /reason id/);
  const bad = scan(dir, ["report", "-"], JSON.stringify([finding({ check: "unused" })]));
  assert.equal(bad.status, 2);
});

test("report refuses each new reason id as a refusal", () => {
  const dir = makeRepo();
  for (const reason of ["read-by-code", "type-in-use", "skipped-source", "test-only-readers"]) {
    const run = scan(dir, ["report", "-"], JSON.stringify([finding({ refused: true, reason, proposal: "none", consumerVerdict: "unknown" })]));
    assert.equal(run.status, 0, reason);
  }
});

test("report --wire maps the no-reader checks to lens findings", () => {
  const dir = makeRepo();
  const run = scan(
    dir,
    ["report", "-", "--wire"],
    JSON.stringify([
      finding({ evidenceSource: "lsp" }),
      finding({ id: "k1", check: "unread-param", refused: true, reason: "type-in-use", proposal: "none", consumerVerdict: "unknown", worthALook: true, confirm: "that no other function uses the type" }),
    ])
  );
  assert.equal(run.status, 1);
  assert.equal(run.stderr, "needs-attention\n");
  assert.equal(run.json.length, 2);
  for (const item of run.json) {
    assert.deepEqual(Object.keys(item), ["source", "path", "line", "severity", "title", "body", "suggested_fix", "evidence"]);
    assert.equal(item.source, "useless-abstraction-scan");
  }
  assert.equal(run.json[0].title, "Delete inert option RunOptions.immediate");
  assert.match(run.json[0].evidence, /^Verified: /);
  assert.equal(run.json[1].severity, "low");
  assert.equal(run.json[1].suggested_fix, "that no other function uses the type");
});
