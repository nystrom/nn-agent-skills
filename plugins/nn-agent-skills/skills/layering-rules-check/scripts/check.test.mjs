import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "./fixture.mjs";

const CHECK = join(dirname(fileURLToPath(import.meta.url)), "check.mjs");

function run(root, rules, ...extra) {
  const rulesPath = join(makeRepo({ "rules.json": JSON.stringify(rules) }), "rules.json");
  const r = spawnSync("node", [CHECK, "--root", root, "--rules", rulesPath, ...extra], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const findings = (root, rules, ...extra) => JSON.parse(run(root, rules, ...extra).stdout).findings;

// A Python repo: layers app > lib > util.
const REPO = {
  "app/main.py": "from lib.core import f\nfrom util.u import g\n",
  "lib/core.py": "from util.u import g\nfrom app.main import m\nfrom lib.core_test import t\n",
  "lib/core_test.py": "",
  "util/u.py": "from lib.core import f\n",
  "util/tests/support.py": "from lib.core_test import t\n",
  "lib/__init__.py": "from ..util.u import g\nfrom .core import f\n",
  "legacy/old.py": "",
};

const RULES = {
  layers: [
    { name: "app", paths: ["app/**"] },
    { name: "lib", paths: ["lib/**"] },
    { name: "util", paths: ["util/**"] },
  ],
  allow: { app: ["lib", "util"], lib: ["util"], util: [] },
  packages: [
    { name: "app", root: "app", depends: ["lib"] },
    { name: "lib", root: "lib", depends: [] },
    { name: "util", root: "util", depends: [] },
  ],
  unchecked: [{ globs: ["legacy/**"], reason: "the type checker skips" }],
  refuse: [],
};

describe("check.mjs", () => {
  const root = makeRepo(REPO);
  const all = findings(root, RULES);
  const by = (check) => all.filter((f) => f.check === check);

  it("flags layer edges the rules do not allow", () => {
    const hits = by("layer-direction");
    assert.deepEqual(hits.map((f) => f.file).sort(), ["lib/core.py", "util/tests/support.py", "util/u.py"]);
    assert.ok(hits.every((f) => f.source === "script" && f.evidence_source === "text"));
    assert.ok(hits.every((f) => f.proposal && f.verify));
  });

  it("flags a production import of a test module and refuses test-support files", () => {
    const hits = by("test-import");
    assert.equal(hits.find((f) => f.file === "lib/core.py").refused, false);
    const support = hits.find((f) => f.file === "util/tests/support.py");
    assert.equal(support.refused, true);
  });

  it("flags a barrel re-export from outside its directory", () => {
    const hits = by("foreign-barrel-reexport");
    assert.deepEqual(hits.map((f) => f.file), ["lib/__init__.py"]);
  });

  it("flags an undeclared package dependency once per edge", () => {
    const hits = by("undeclared-package-dep");
    const ids = hits.map((f) => f.id).sort();
    assert.ok(ids.some((id) => id.includes("app->util")));
    assert.ok(hits.every((f) => f.sources.length >= 1));
  });

  it("flags files that the rules mark as unchecked", () => {
    assert.deepEqual(by("unchecked-source").map((f) => f.file), ["legacy/old.py"]);
  });

  it("applies refuse entries from the rules file", () => {
    const refused = findings(root, { ...RULES, refuse: [{ check: "unchecked-source", glob: "legacy/**", reason: "kept on purpose" }] });
    const hit = refused.find((f) => f.check === "unchecked-source");
    assert.equal(hit.refused, true);
    assert.equal(hit.reason, "kept on purpose");
  });

  it("uses an edge list from a language server and keeps its evidence source", () => {
    const edgesPath = join(makeRepo({ "e.json": "[]" }), "e.json");
    writeFileSync(
      edgesPath,
      JSON.stringify([{ from: "util/u.py", to: "lib/core.py", line: 3, kind: "import", evidence_source: "lsp" }])
    );
    const hits = findings(root, RULES, "--edges", edgesPath).filter((f) => f.check === "layer-direction");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].evidence_source, "lsp");
    assert.equal(hits[0].line, 3);
  });

  it("detects a foreign barrel with default barrel globs", () => {
    const edgesPath = join(makeRepo({ "e.json": "[]" }), "e.json");
    writeFileSync(
      edgesPath,
      JSON.stringify([{ from: "lib/__init__.py", to: "util/u.py", line: 1, kind: "reexport" }])
    );
    const hits = findings(root, {}, "--edges", edgesPath);
    assert.deepEqual(hits.map((f) => f.check), ["foreign-barrel-reexport"]);
  });

  it("matches packages by import name when an edge has no target file", () => {
    const edgesPath = join(makeRepo({ "e.json": "[]" }), "e.json");
    writeFileSync(
      edgesPath,
      JSON.stringify([{ from: "app/main.py", to: null, specifier: "@x/util/deep", line: 2, kind: "import" }])
    );
    const rules = { packages: RULES.packages.map((p) => (p.name === "util" ? { ...p, import_names: ["@x/util"] } : p)) };
    const hits = findings(root, rules, "--edges", edgesPath);
    assert.equal(hits.length, 1);
    assert.match(hits[0].signal, /app imports package util/);
  });

  it("reports skipped checks when the rules lack data", () => {
    const report = JSON.parse(run(root, {}).stdout);
    assert.deepEqual(
      report.skipped_checks.map((s) => s.check).sort(),
      ["layerDirection", "uncheckedSources", "undeclaredPackageDeps"]
    );
  });

  it("limits findings with a root-relative scope and keeps aggregates by source", () => {
    const scoped = findings(root, RULES, "--scope", "util");
    assert.ok(scoped.every((f) => f.file.startsWith("util") || (f.sources ?? []).some((s) => s.startsWith("util"))));
    assert.equal(run(root, RULES, "--scope", "../elsewhere").status, 2);
  });

  it("decides a scoped package finding from repo-wide edges", () => {
    const edgesPath = join(makeRepo({ "e.json": "[]" }), "e.json");
    writeFileSync(
      edgesPath,
      JSON.stringify([
        { from: "app/prod.py", to: "util/u.py", line: 1, kind: "import" },
        { from: "app/prod_test.py", to: "util/u.py", line: 2, kind: "import" },
      ])
    );
    const hits = findings(root, RULES, "--edges", edgesPath, "--scope", "app/prod_test.py").filter(
      (f) => f.check === "undeclared-package-dep"
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "high");
    assert.deepEqual(hits[0].sources, ["app/prod.py:1", "app/prod_test.py:2"]);
  });

  it("limits candidates to the change but keeps repo-wide evidence", () => {
    const changedFile = join(makeRepo({ "c.txt": "lib/core_test.py\n" }), "c.txt");
    const report = JSON.parse(run(root, RULES, "--changed-file", changedFile).stdout);
    assert.deepEqual(report.candidate_scope, { mode: "diff", changed_files: 1 });
    // lib/core.py is unchanged but imports the changed test file: a neighbor.
    assert.ok(report.findings.length > 0);
    assert.ok(report.findings.every((f) => f.target === "lib/core_test.py"));
    assert.ok(report.findings.some((f) => f.check === "test-import" && f.file === "lib/core.py"));
    const none = JSON.parse(
      run(root, RULES, "--changed-file", join(makeRepo({ "c.txt": "README.md\n" }), "c.txt")).stdout
    );
    assert.equal(none.counts.reported, 0);
    const all = JSON.parse(run(root, RULES).stdout);
    assert.equal(all.candidate_scope.mode, "repo");
  });

  it("reads changed files from git for --diff and --working-tree", () => {
    const repo = makeRepo({ "lib/core.py": "", "util/u.py": "from lib.core import f\n", "app/x.py": "" });
    const git = (...args) =>
      spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "topic");
    writeFileSync(join(repo, "app/x.py"), "# touched\n");
    git("commit", "-q", "-am", "change");
    const committed = JSON.parse(run(repo, RULES, "--diff", "main").stdout);
    assert.deepEqual(committed.candidate_scope, { mode: "diff", changed_files: 1 });
    assert.equal(committed.counts.reported, 0);
    writeFileSync(join(repo, "util/u.py"), "from lib.core import f\n# dirty\n");
    const dirty = JSON.parse(run(repo, RULES, "--diff", "main", "--working-tree").stdout);
    assert.equal(dirty.candidate_scope.changed_files, 2);
    assert.deepEqual(dirty.findings.map((f) => f.check).sort(), [
      "layer-direction",
      "undeclared-package-dep",
    ]);
    git("checkout", "-q", "--", "util/u.py");
    writeFileSync(join(repo, "app/x.py"), "");
    const reverted = JSON.parse(run(repo, RULES, "--diff", "main", "--working-tree").stdout);
    assert.equal(reverted.candidate_scope.changed_files, 0);
    const range = JSON.parse(run(repo, RULES, "--diff", "main..topic").stdout);
    assert.equal(range.candidate_scope.changed_files, 1);
    writeFileSync(join(repo, "ünï \"q\".py"), "");
    const odd = JSON.parse(run(repo, RULES, "--diff", "main", "--working-tree").stdout);
    assert.equal(odd.candidate_scope.changed_files, 1);
    assert.equal(run(repo, RULES, "--diff", "no-such-ref").status, 2);
    assert.equal(run(repo, RULES, "--working-tree").status, 2);
  });

  it("prints the review-lens wire format and a headline", () => {
    const r = run(root, RULES, "--format", "wire");
    const wire = JSON.parse(r.stdout);
    assert.match(r.stderr, /needs-attention/);
    const keys = ["body", "evidence", "line", "path", "severity", "source", "suggested_fix", "title"];
    for (const item of wire) {
      assert.deepEqual(Object.keys(item).sort(), keys);
      assert.equal(item.source, "layering-rules-check");
      assert.ok(["blocker", "high", "medium", "low"].includes(item.severity));
      assert.match(item.evidence, /^(Verified|Inferred): /);
      assert.match(item.body, /source: script/);
    }
    assert.ok(wire.every((w) => !w.title.startsWith("test-import") || w.path !== "util/tests/support.py"));
    const unchecked = wire.find((w) => w.path === "legacy/old.py");
    assert.equal(unchecked.line, null);
    assert.match(unchecked.evidence, /^Verified: /);
    const clean = run(makeRepo({ "a.py": "" }), RULES, "--format", "wire");
    assert.deepEqual(JSON.parse(clean.stdout).filter((w) => w.path !== "legacy/old.py"), []);
    const out = join(makeRepo({}), "wire.json");
    const withOut = run(root, RULES, "--format", "wire", "--out", out);
    assert.ok(Array.isArray(JSON.parse(readFileSync(out, "utf8"))));
    assert.match(withOut.stderr, /^needs-attention$/m);
  });

  it("rejects malformed rules and edges with exit 2", () => {
    const edgesPath = join(makeRepo({ "e.json": "[]" }), "e.json");
    const bad = { packages: [{ name: "a", root: "", depends: "b" }] };
    assert.equal(run(root, bad).status, 2);
    assert.equal(run(root, { test_globs: "x" }).status, 2);
    writeFileSync(edgesPath, JSON.stringify([{ from: 1 }]));
    assert.equal(run(root, RULES, "--edges", edgesPath).status, 2);
    writeFileSync(edgesPath, "{}");
    assert.equal(run(root, RULES, "--edges", edgesPath).status, 2);
    assert.equal(run(join(root, "missing"), RULES).status, 2);
  });

  it("refuses an output path inside the repo and leaves the repo unchanged", () => {
    const repo = makeRepo(REPO);
    const out = join(repo, "findings.json");
    assert.equal(run(repo, RULES, "--out", out).status, 2);
    assert.throws(() => readFileSync(out));
  });

  it("exits 1 with findings, 0 without, 2 on bad input, and writes only --out", () => {
    assert.equal(run(root, RULES).status, 1);
    assert.equal(run(makeRepo({ "a.py": "" }), RULES).status, 0);
    assert.equal(run(root, { bogus: 1 }).status, 2);
    assert.equal(run(root, { layers: [{ name: "a", paths: [] }], allow: { a: ["zzz"] } }).status, 2);
    assert.equal(spawnSync("node", [CHECK], { encoding: "utf8" }).status, 2);
    const repo = makeRepo(REPO);
    const out = join(makeRepo({}), "findings.json");
    const result = run(repo, RULES, "--out", out);
    assert.match(result.stdout, /\[high\]/);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).tool, "layering-rules-check");
    assert.equal(run(root, RULES, "--out", join(root, "no/such/dir/out.json")).status, 2);
  });
});
