#!/usr/bin/env node
// Evaluates a layering rules file against an import edge list and reports
// findings. Language-neutral: the rules are data, and the edges come from a
// language server or from edges.mjs. The script never changes the repo under
// review. The only file it writes is the one named by --out.
//
// Exit codes: 0 no reported findings, 1 findings reported, 2 could not run.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractEdges } from "./edges.mjs";
import { assertOutsideRepo, assertScannable, die, findRoot, matcher, toPosix, walk } from "./lib.mjs";

const USAGE = `usage: check.mjs --rules <file> [--edges <file>] [--root <dir>] [--scope <path>]...
                [--diff <base> [--working-tree] | --changed-file <file>]
                [--format findings|wire] [--out <file>]

  --rules <file>  Layering rules file (JSON). See references/rules.md.
  --edges <file>  Import edge list (JSON), for example from a language server.
                  Default: extract with edges.mjs (evidence_source "text").
  --root <dir>    Repository root. Default: git top level, else working directory.
  --scope <path>  Keep findings under this path (relative to the root). Repeatable.
                  Edges are still read repo-wide; only the findings narrow.
  --diff <base>   Keep candidates the change touches: findings in a changed file,
                  or whose target or summarized imports are in a changed file.
                  Changed files come from \`git diff --name-only <base>...HEAD\`.
                  Evidence (edges, packages) stays repo-wide.
  --working-tree  With --diff, also include uncommitted and untracked files.
  --changed-file <file>
                  Read the changed paths from a file (one per line) instead of git.
  --format <f>    findings (default) or wire: a JSON array of review-lens
                  findings { source, path, line, severity, title, body,
                  suggested_fix, evidence }.
  --out <file>    Write the JSON findings here and print a ranked summary.
                  Without it, the JSON goes to standard output.
  -h, --help      This text.
`;

const SEVERITY_ORDER = ["high", "medium", "low", "nit"];
const RULE_KEYS = new Set([
  "source_docs",
  "test_globs",
  "barrel_globs",
  "layers",
  "allow",
  "packages",
  "unchecked",
  "refuse",
]);

// Naming conventions only. A directory convention (`tests/`, `test/`) belongs
// in the rules file because it is not safe as a default.
const DEFAULT_TEST_GLOBS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/test_*.py",
  "**/*_test.py",
  "**/*_test.go",
  "**/*_test.rs",
  "**/*Test.java",
  "**/*Tests.java",
  "**/*Test.kt",
  "**/*Tests.kt",
  "**/*_test.{c,cc,cpp}",
  "**/runtests.jl",
];
const DEFAULT_BARREL_GLOBS = ["**/index.{ts,tsx,js,jsx,mjs,cjs}", "**/__init__.py", "**/mod.rs"];
const TEST_SUPPORT_DIRS = new Set(["test", "tests", "testing"]);

function parseArgs(argv) {
  const options = { scopes: [] };
  const value = (i, flag) => {
    argv[i + 1] === undefined && die(`check.mjs: ${flag} needs a value\n${USAGE}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--rules":
        options.rules = resolve(value(i, "--rules"));
        i += 1;
        break;
      case "--edges":
        options.edges = resolve(value(i, "--edges"));
        i += 1;
        break;
      case "--root":
        options.root = resolve(value(i, "--root"));
        i += 1;
        break;
      case "--scope":
        options.scopes.push(value(i, "--scope"));
        i += 1;
        break;
      case "--diff":
        options.diff = value(i, "--diff");
        i += 1;
        break;
      case "--working-tree":
        options.workingTree = true;
        break;
      case "--changed-file":
        options.changedFile = resolve(value(i, "--changed-file"));
        i += 1;
        break;
      case "--format":
        options.format = value(i, "--format");
        ["findings", "wire"].includes(options.format) ||
          die(`check.mjs: --format must be findings or wire\n${USAGE}`);
        i += 1;
        break;
      case "--out":
        options.out = resolve(value(i, "--out"));
        i += 1;
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        die(`check.mjs: unexpected argument ${argv[i]}\n${USAGE}`);
    }
  }
  options.rules === undefined && die(`check.mjs: --rules is required\n${USAGE}`);
  return options;
}

function readJsonFile(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`check.mjs: cannot read ${what} ${path}: ${error.message}`);
  }
  return undefined;
}

function validateRules(rules) {
  const bad = (message) => die(`check.mjs: rules file: ${message}`);
  (typeof rules !== "object" || rules === null || Array.isArray(rules)) && bad("not an object");
  for (const key of Object.keys(rules)) {
    RULE_KEYS.has(key) || bad(`unknown key "${key}"`);
  }
  const lists = ["source_docs", "test_globs", "barrel_globs", "layers", "packages", "unchecked", "refuse"];
  for (const key of lists) {
    (rules[key] === undefined || Array.isArray(rules[key])) || bad(`"${key}" must be an array`);
  }
  const strings = (value) => Array.isArray(value) && value.every((v) => typeof v === "string");
  for (const key of ["source_docs", "test_globs", "barrel_globs"]) {
    (rules[key] === undefined || strings(rules[key])) || bad(`"${key}" must hold strings`);
  }
  for (const entry of rules.unchecked ?? []) {
    strings(entry?.globs) || bad("each unchecked entry needs a globs array of strings");
  }
  for (const entry of rules.refuse ?? []) {
    (typeof entry?.check === "string" && typeof entry.glob === "string") ||
      bad("each refuse entry needs string check and glob");
  }
  const layerNames = new Set((rules.layers ?? []).map((l) => l?.name));
  for (const layer of rules.layers ?? []) {
    (typeof layer?.name === "string" && strings(layer.paths)) ||
      bad("each layer needs a string name and a paths array of strings");
  }
  for (const [layer, targets] of Object.entries(rules.allow ?? {})) {
    layerNames.has(layer) || bad(`allow names unknown layer "${layer}"`);
    Array.isArray(targets) || bad(`allow["${layer}"] must be an array`);
    for (const target of targets) {
      layerNames.has(target) || bad(`allow["${layer}"] names unknown layer "${target}"`);
    }
  }
  for (const pkg of rules.packages ?? []) {
    (typeof pkg?.name === "string" && typeof pkg.root === "string") ||
      bad("each package needs a string name and root");
    for (const key of ["depends", "import_names"]) {
      (pkg[key] === undefined || strings(pkg[key])) || bad(`package "${pkg.name}" ${key} must hold strings`);
    }
  }
  return rules;
}

export function validateEdges(edges) {
  const bad = (i, message) => die(`check.mjs: edge ${i}: ${message}`);
  edges.forEach((e, i) => {
    typeof e?.from === "string" || bad(i, "from must be a string");
    (e.to === null || e.to === undefined || typeof e.to === "string") || bad(i, "to must be a string or null");
    (e.specifier === undefined || typeof e.specifier === "string") || bad(i, "specifier must be a string");
    (e.line === undefined || Number.isInteger(e.line)) || bad(i, "line must be an integer");
    (e.kind === undefined || e.kind === "import" || e.kind === "reexport") || bad(i, "kind must be import or reexport");
  });
  return edges;
}

function finding(check, fields) {
  const where = fields.line === undefined ? fields.file : `${fields.file}:${fields.line}`;
  return {
    id: `${check}:${where}${fields.idSuffix ?? ""}`,
    check,
    source: "script",
    evidence_source: "text",
    refused: false,
    ...fields,
  };
}

function makeContext(rules, edges, files) {
  const isTest = matcher(rules.test_globs ?? DEFAULT_TEST_GLOBS);
  const layerOf = (() => {
    const layers = (rules.layers ?? []).map((l) => ({ name: l.name, match: matcher(l.paths) }));
    return (path) => layers.find((l) => l.match(path))?.name;
  })();
  const packages = [...(rules.packages ?? [])].sort((a, b) => b.root.length - a.root.length);
  const inside = (root, path) => root === "" || root === "." || path === root || path.startsWith(`${root}/`);
  const packageOf = (path) => packages.find((p) => inside(p.root, path));
  const packageByName = (specifier) =>
    packages.find((p) =>
      (p.import_names ?? [p.name]).some(
        (n) => specifier === n || [`${n}/`, `${n}.`, `${n}::`].some((sep) => specifier.startsWith(sep))
      )
    );
  const refusals = (rules.refuse ?? []).map((r) => ({ check: r.check, match: matcher([r.glob]), reason: r.reason }));
  return { rules, edges, files, isTest, layerOf, packages, packageOf, packageByName, inside, refusals };
}

function testImports(ctx) {
  return ctx.edges
    .filter((e) => e.to !== null && e.to !== undefined && !ctx.isTest(e.from) && ctx.isTest(e.to))
    .map((e) => {
      const support = e.from.split("/").some((segment) => TEST_SUPPORT_DIRS.has(segment));
      return finding("test-import", {
        severity: support ? "low" : "high",
        file: e.from,
        line: e.line,
        target: e.to,
        evidence_source: e.evidence_source,
        idSuffix: ` ${e.to}`,
        signal: `production module imports test module ${e.to}`,
        evidence:
          "test files are usually outside layering rules, so this import reaches whatever the test reaches with no rule in the way",
        proposal: support
          ? "none"
          : "move the shared helper from the test file into a non-test module and import it from there",
        verify: "re-run the edge extraction; the edge must be gone, and the tests must pass",
        refused: support,
        ...(support && { reason: "the file is under a test-support directory" }),
      });
    });
}

function layerDirection(ctx) {
  if ((ctx.rules.layers ?? []).length === 0) {
    return { skipped: "no layers in the rules file" };
  }
  const allow = ctx.rules.allow ?? {};
  const findings = ctx.edges
    .filter((e) => e.to !== null && e.to !== undefined && !ctx.isTest(e.from))
    .flatMap((e) => {
      const from = ctx.layerOf(e.from);
      const to = ctx.layerOf(e.to);
      if (from === undefined || to === undefined || from === to || (allow[from] ?? []).includes(to)) {
        return [];
      }
      return [
        finding("layer-direction", {
          severity: "high",
          file: e.from,
          line: e.line,
          target: e.to,
          evidence_source: e.evidence_source,
          idSuffix: ` ${from}->${to}`,
          signal: `layer "${from}" imports layer "${to}" (${e.to}), which the rules do not allow`,
          evidence: `the rules file allows "${from}" to import: ${(allow[from] ?? []).join(", ") || "nothing outside itself"}`,
          proposal: `move the shared code into a layer "${from}" may import, invert the dependency, or update the rules and the source document if the edge is intended`,
          verify: "re-run the check; the edge must be gone",
        }),
      ];
    });
  return { findings };
}

function foreignBarrelReexports(ctx) {
  const isBarrel = matcher(ctx.rules.barrel_globs ?? DEFAULT_BARREL_GLOBS);
  return ctx.edges
    .filter((e) => e.kind === "reexport" && e.to !== null && e.to !== undefined && isBarrel(e.from))
    .filter((e) => !ctx.inside(dirname(e.from) === "." ? "" : dirname(e.from), e.to))
    .map((e) =>
      finding("foreign-barrel-reexport", {
        severity: "medium",
        file: e.from,
        line: e.line,
        target: e.to,
        evidence_source: e.evidence_source,
        idSuffix: ` ${e.to}`,
        signal: `barrel re-exports a module from another directory (${e.to})`,
        evidence:
          "every consumer of the barrel depends on the other directory, and the barrel misstates which directory owns the symbol",
        proposal: "export the symbol from the barrel of the directory that defines it, and import it from there",
        verify: "re-run the check; the re-export edge must be gone, and every importer must still build",
      })
    );
}

function undeclaredPackageDeps(ctx) {
  if (ctx.packages.length === 0) {
    return { skipped: "no packages in the rules file" };
  }
  const usage = new Map();
  for (const e of ctx.edges) {
    const source = ctx.packageOf(e.from);
    const target =
      e.to !== null && e.to !== undefined ? ctx.packageOf(e.to) : ctx.packageByName(e.specifier);
    if (source === undefined || target === undefined || source === target) {
      continue;
    }
    if ((source.depends ?? []).includes(target.name)) {
      continue;
    }
    const test = ctx.isTest(e.from);
    const key = `${source.name}\u0000${target.name}\u0000${test}`;
    const entry = usage.get(key) ?? { source, target, test, sources: [], evidence: e.evidence_source };
    entry.sources.push(`${e.from}:${e.line}`);
    usage.set(key, entry);
  }
  const findings = [];
  for (const { source, target, test, sources, evidence } of usage.values()) {
    // A production import needs a runtime dependency, which covers the test use.
    if (test && usage.has(`${source.name}\u0000${target.name}\u0000false`)) {
      continue;
    }
    findings.push(
      finding("undeclared-package-dep", {
        severity: test ? "medium" : "high",
        file: sources[0].replace(/:\d+$/, ""),
        line: Number(sources[0].replace(/^.*:/, "")),
        evidence_source: evidence,
        idSuffix: ` ${source.name}->${target.name} ${test ? "test" : "production"}`,
        signal: `package ${source.name} imports package ${target.name} from ${test ? "test" : "production"} code, and the rules list no such dependency`,
        evidence:
          "an undeclared edge can resolve inside the repo through workspace or path setup and fail when the package is built or installed on its own",
        proposal: `declare ${target.name} as a ${test ? "test or development" : "runtime"} dependency of ${source.name} in its manifest, or stop importing it`,
        verify: "build the package on its own, and re-run the check",
        sources: [...new Set(
          [...usage.values()]
            .filter((u) => u.source === source && u.target === target)
            .flatMap((u) => u.sources)
        )],
      })
    );
  }
  return { findings };
}

function uncheckedSources(ctx) {
  if ((ctx.rules.unchecked ?? []).length === 0) {
    return { skipped: "no unchecked entries in the rules file" };
  }
  const findings = [];
  for (const entry of ctx.rules.unchecked) {
    const match = matcher(entry.globs ?? []);
    for (const file of ctx.files.filter((f) => match(f) && !ctx.isTest(f))) {
      findings.push(
        finding("unchecked-source", {
          severity: "medium",
          file,
          evidence_source: "read",
          idSuffix: "",
          signal: `source file that ${entry.reason ?? "the repo's checkers skip"}`,
          evidence:
            "an import inside a file that the type checker or linter skips is checked by neither tool",
          proposal: "bring the file under the checker, or move it out of the source tree",
          verify: "run the repo's checker and confirm it reads the file",
        })
      );
    }
  }
  return { findings };
}

const CHECKS = [testImports, layerDirection, foreignBarrelReexports, undeclaredPackageDeps, uncheckedSources];

function applyRefusals(findings, ctx) {
  return findings.map((f) => {
    const rule = ctx.refusals.find((r) => r.check === f.check && r.match(f.file));
    return rule === undefined ? f : { ...f, refused: true, reason: rule.reason, proposal: "none" };
  });
}

function rank(a, b) {
  return (
    Number(a.refused) - Number(b.refused) ||
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    a.id.localeCompare(b.id)
  );
}

/** A candidate is touched by the change: its file, target, or summarized imports changed. */
function touched(f, changed) {
  return (
    changed.has(f.file) ||
    (f.target !== undefined && changed.has(f.target)) ||
    (f.sources ?? []).some((x) => changed.has(x.replace(/:\d+$/, "")))
  );
}

export function check({ rules, edges, files, scopes = [], changed }) {
  const ctx = makeContext(validateRules(rules), validateEdges(edges), files);
  const skippedChecks = [];
  const raw = [];
  for (const run of CHECKS) {
    const result = run(ctx);
    if (Array.isArray(result)) {
      raw.push(...result);
    } else if (result.skipped !== undefined) {
      skippedChecks.push({ check: run.name, reason: result.skipped });
    } else {
      raw.push(...result.findings);
    }
  }
  const within = (scope, path) => scope === "" || path === scope || path.startsWith(`${scope}/`);
  const all = applyRefusals(raw, ctx)
    .filter(
      (f) =>
        scopes.length === 0 ||
        scopes.some(
          (s) => within(s, f.file) || (f.sources ?? []).some((x) => within(s, x.replace(/:\d+$/, "")))
        )
    )
    .filter((f) => changed === undefined || touched(f, changed))
    .sort(rank);
  return {
    tool: "layering-rules-check",
    scope: scopes.length === 0 ? "." : scopes.join(", "),
    candidate_scope:
      changed === undefined
        ? { mode: scopes.length === 0 ? "repo" : "paths" }
        : { mode: "diff", changed_files: changed.size },
    generated_at: new Date().toISOString(),
    counts: {
      candidates: all.length,
      refused: all.filter((f) => f.refused).length,
      reported: all.filter((f) => !f.refused).length,
    },
    skipped_checks: skippedChecks,
    findings: all,
  };
}

const WIRE_SEVERITY = { high: "high", medium: "medium", low: "low", nit: "low" };

/** Maps script findings to the review-lens wire format. Refusals are omitted. */
export function toWire(report) {
  return report.findings
    .filter((f) => !f.refused)
    .map((f) => {
      const verified = f.evidence_source === "lsp" || f.evidence_source === "read";
      const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
      return {
        source: "layering-rules-check",
        path: f.file,
        line: f.line ?? null,
        severity: WIRE_SEVERITY[f.severity] ?? "low",
        title: `${f.check}: ${f.signal}`,
        body: `${f.signal}. Why it matters: ${f.evidence}. (source: script)`,
        suggested_fix: `${f.proposal}. Verify: ${f.verify}.`,
        evidence: verified
          ? `Verified: ${f.check} fired at ${where} on ${f.evidence_source} evidence (source: script).`
          : `Inferred: ${f.check} fired at ${where} on text evidence, which approximates import resolution; read the code to confirm (source: script).`,
      };
    });
}

function headline(report) {
  return report.counts.reported > 0 ? "needs-attention" : "approve";
}

/** Changed paths for diff mode. Read-only git commands. */
function changedPaths(root, options) {
  if (options.changedFile !== undefined) {
    return new Set(
      readFileSync(options.changedFile, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "")
    );
  }
  // NUL-separated output keeps unusual file names intact.
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split("\0")
      .filter((l) => l !== "");
  try {
    // A base ref means merge-base...HEAD; a range (a..b, a...b) is used as given.
    const range = options.diff.includes("..") ? options.diff : `${options.diff}...HEAD`;
    if (!options.workingTree) {
      return new Set(git("diff", "-z", "--name-only", "--relative", range));
    }
    // The net change through the working tree, so a reverted change drops out.
    const left = options.diff.split(/\.{2,3}/)[0] || "HEAD";
    const mergeBase = git("merge-base", left, "HEAD")[0].trim();
    return new Set([
      ...git("diff", "-z", "--name-only", "--relative", mergeBase),
      ...git("ls-files", "-z", "--others", "--exclude-standard"),
    ]);
  } catch (error) {
    die(`check.mjs: git failed for base ${options.diff}: ${(error.stderr ?? error.message).toString().trim()}`);
  }
  return new Set();
}

function summary(report, limit = 20) {
  const lines = [
    `layering-rules-check: ${headline(report)}; ${report.counts.reported} reported, ${report.counts.refused} refused`,
  ];
  for (const f of report.findings.filter((x) => !x.refused).slice(0, limit)) {
    lines.push(`  [${f.severity}] ${f.check} ${f.file}${f.line ? `:${f.line}` : ""} (${f.evidence_source}): ${f.signal}`);
  }
  report.counts.reported > limit && lines.push(`  ... ${report.counts.reported - limit} more in the JSON`);
  for (const s of report.skipped_checks) {
    lines.push(`  skipped ${s.check}: ${s.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const root = findRoot(options.root);
    assertScannable(root);
    options.out !== undefined && assertOutsideRepo(options.out, root);
    const rules = readJsonFile(options.rules, "rules file");
    const skipped = [];
    let edges;
    let files;
    if (options.edges === undefined) {
      ({ edges, files } = extractEdges(root, skipped));
    } else {
      edges = readJsonFile(options.edges, "edge list");
      Array.isArray(edges) || die("check.mjs: edge list must be a JSON array");
      files = walk(root, skipped);
    }
    const scopes = options.scopes.map((scope) => {
      const rel = toPosix(relative(root, resolve(root, scope))).replace(/\/$/, "");
      (rel === ".." || rel.startsWith("../")) && die(`check.mjs: scope is outside the root: ${scope}`);
      return rel;
    });
    (options.diff !== undefined || options.changedFile !== undefined || options.workingTree === undefined) ||
      die("check.mjs: --working-tree needs --diff");
    const changed =
      options.diff === undefined && options.changedFile === undefined
        ? undefined
        : changedPaths(root, options);
    const report = { ...check({ rules, edges, files, scopes, changed }), root, skipped_files: skipped };
    const payload = options.format === "wire" ? toWire(report) : report;
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    if (options.out === undefined) {
      process.stdout.write(json);
    } else {
      writeFileSync(options.out, json);
      process.stdout.write(summary(report));
    }
    options.format === "wire" && process.stderr.write(`${headline(report)}\n`);
    process.exitCode = report.counts.reported > 0 ? 1 : 0;
  } catch (error) {
    die(`check.mjs: ${error.message}`);
  }
}

process.argv[1] === fileURLToPath(import.meta.url) && main();
