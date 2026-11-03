// Run with: node --test plugins/nn-agent-skills/skills/concolic-test-generation/scripts/
//
// Covers the CLI's input handling. A branch map that fails to load yields an
// empty frontier, which reads as "nothing left to test", so every such failure
// must exit nonzero.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "concolic.mjs");

/** Three sequential two-way branches, as istanbul numbers them. */
const branchMap = Object.fromEntries(
  [0, 1, 2].map((id) => [
    String(id),
    {
      type: "if",
      loc: { start: { line: id + 3 } },
      locations: [{}, {}],
    },
  ])
);

/** A repo with one source file, its coverage report, and two recorded tests. */
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "concolic-cli-")));
  const source = join(dir, "target.js");
  writeFileSync(source, "module.exports = {};\n");
  writeFileSync(
    join(dir, "coverage-final.json"),
    JSON.stringify({ [source]: { path: source, branchMap } })
  );
  mkdirSync(join(dir, "traces"));
  const line = (testName, arm) =>
    JSON.stringify({
      testPath: join(dir, "target.test.js"),
      testName,
      decisions: [
        ["0", arm],
        ["1", arm],
        ["2", arm],
      ],
    });
  writeFileSync(
    join(dir, "traces", "t.jsonl"),
    `${line("all positive", 0)}\n${line("all negative", 1)}\n`
  );
  return dir;
}

function run(dir, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

function frontierArgs({ source = "./target.js", traces = "traces" } = {}) {
  return [
    "frontier",
    "--source",
    source,
    "--branches",
    "coverage-final.json",
    "--traces",
    traces,
  ];
}

test("frontier finds paths when every arm is already covered", () => {
  const res = run(fixture(), ...frontierArgs());
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.targets.map((t) => t.key).sort(), [
    "0:0,1:0,2:1",
    "0:0,1:1",
    "0:1,1:0",
    "0:1,1:1,2:0",
  ]);
});

test("frontier fails when the report has no entry for the source", () => {
  const dir = fixture();
  writeFileSync(join(dir, "other.js"), "");
  const res = run(dir, ...frontierArgs({ source: "other.js" }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /has no entry for/);
});

test("frontier fails when traces name branches the map lacks", () => {
  const dir = fixture();
  writeFileSync(
    join(dir, "traces", "u.jsonl"),
    `${JSON.stringify({ testName: "x", decisions: [["9", 0]] })}\n`
  );
  const res = run(dir, ...frontierArgs());
  assert.equal(res.status, 1);
  assert.match(res.stderr, /missing from the branch map: 9/);
});

test("frontier exits 2 when the baseline recorded no paths", () => {
  const res = run(fixture(), ...frontierArgs({ traces: "no-such-dir" }));
  assert.equal(res.status, 2);
});

test("check accepts a path that starts with the prefix", () => {
  const res = run(
    fixture(),
    "check",
    "--traces",
    "traces",
    "--test-name",
    "all negative",
    "--prefix",
    '[["0",1],["1",1]]'
  );
  assert.equal(res.status, 0, res.stderr);
});

test("check reports where a path left the prefix", () => {
  const res = run(
    fixture(),
    "check",
    "--traces",
    "traces",
    "--test-name",
    "all positive",
    "--prefix",
    '[["0",0],["1",1]]'
  );
  assert.equal(res.status, 1);
  assert.match(res.stderr, /diverged at decision 1/);
});

test("a retired target leaves the frontier under any spelling of the source", () => {
  const dir = fixture();
  const retire = run(
    dir,
    "retire",
    "--source",
    join(dir, "target.js"),
    "--key",
    "0:1,1:0",
    "--status",
    "infeasible",
    "--reason",
    "contradiction"
  );
  assert.equal(retire.status, 0, retire.stderr);
  const res = run(dir, ...frontierArgs());
  const keys = JSON.parse(res.stdout).targets.map((t) => t.key);
  assert.equal(keys.includes("0:1,1:0"), false);
  assert.equal(keys.length, 3);
});
