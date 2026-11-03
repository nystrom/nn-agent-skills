#!/usr/bin/env node
// Command-line front end over the path search and the ledger. Language
// independent: it reads a branch map and per-test traces in the shapes the Jest
// tracer writes, and any other tracer that writes the same shapes can use it.

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

import * as ledger from "./ledger.mjs";
import {
  commonPrefixLength,
  distinctPaths,
  frontier,
  hasPrefix,
  nearestTrace,
} from "./paths.mjs";

const usage = `usage:
  concolic.mjs frontier --source <file> --branches <json> --traces <dir>
                        [--state <dir>] [--max-depth 12] [--max-visits 2]
  concolic.mjs check    --traces <dir> --test-name <name> --prefix <json>
  concolic.mjs retire   --source <file> [--state <dir>] --key <key>
                        --status gaveup|infeasible|unreachable --reason <text>`;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

/**
 * Accept istanbul's `coverage-final.json` (keyed by absolute source path), one
 * file entry from it, or a bare branch map.
 *
 * Keys are compared by realpath: istanbul records the resolved path, so a
 * symlinked checkout or a `./` prefix would otherwise miss, and a missed lookup
 * must not fall through to an empty frontier.
 */
function loadBranchMap(file, source) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  if (json.branchMap !== undefined) return json.branchMap;
  const values = Object.values(json);
  if (values.length > 0 && values.every((v) => v.locations !== undefined)) {
    return json;
  }
  const want = realpathSync(source);
  const key = Object.keys(json).find(
    (k) => existsSync(k) && realpathSync(k) === want
  );
  if (key === undefined) {
    fail(
      `${file} has no entry for ${want}. It covers:\n  ` +
        Object.keys(json).join("\n  ")
    );
  }
  return json[key].branchMap;
}

/** Every trace line under `dir`, keeping only tests that reached the module. */
function loadTraces(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n"))
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .filter((t) => t.decisions.length > 0);
}

/** One ledger per source file, named by its path from the working directory. */
function ledgerPath(state, source) {
  const rel = relative(realpathSync(process.cwd()), realpathSync(source));
  return join(state, `${rel.replace(/[/\\]/g, "-")}.json`);
}

function cmdFrontier(v) {
  const traces = loadTraces(v.traces);
  if (traces.length === 0) {
    fail(
      "the tracer recorded no paths. Either no test reaches the module, the\n" +
        "traced source path differs from the instrumented one (CONCOLIC_TRACE_SOURCE\n" +
        "must be the absolute realpath), or the tracer no longer matches the\n" +
        "instrumentation. Stop here: every candidate would be rejected for having\n" +
        "no path.",
      2
    );
  }
  const branchMap = loadBranchMap(v.branches, v.source);
  const unknown = new Set(
    traces.flatMap((t) => t.decisions.map(([id]) => id)).filter(
      (id) => branchMap[id] === undefined
    )
  );
  if (unknown.size > 0) {
    fail(
      `traces name branch ids missing from the branch map: ${[...unknown].join(", ")}.\n` +
        "The branch map and the traces come from different source files or runs."
    );
  }
  const book = ledger.load(ledgerPath(v.state, v.source));
  const hash = ledger.sourceHash(readFileSync(v.source, "utf8"));
  const bounds = {
    maxDepth: Number(v["max-depth"]),
    maxVisits: Number(v["max-visits"]),
  };
  const targets = frontier(traces, branchMap, bounds)
    .filter((t) => !ledger.isRetired(book, t.key, hash))
    .map((t) => {
      const seed = nearestTrace(traces, t.prefix);
      return {
        ...t,
        seed: {
          testPath: seed.trace.testPath,
          testName: seed.trace.testName,
          shared: seed.shared,
        },
      };
    });
  console.log(
    JSON.stringify(
      { tests: traces.length, distinct: distinctPaths(traces), targets },
      null,
      2
    )
  );
}

function cmdCheck(v) {
  const prefix = JSON.parse(v.prefix);
  const matches = loadTraces(v.traces).filter(
    (t) => t.testName === v["test-name"]
  );
  if (matches.length !== 1) {
    fail(`expected one trace for "${v["test-name"]}", found ${matches.length}`);
  }
  const { decisions } = matches[0];
  if (hasPrefix(decisions, prefix)) {
    console.log("match");
    return;
  }
  const at = commonPrefixLength(decisions, prefix);
  fail(
    `diverged at decision ${at}: wanted ${JSON.stringify(prefix[at])}, ` +
      `got ${JSON.stringify(decisions[at] ?? null)}`
  );
}

function cmdRetire(v) {
  const path = ledgerPath(v.state, v.source);
  const book = ledger.load(path);
  ledger.record(book, v.key, {
    status: v.status,
    reason: v.reason,
    hash: ledger.sourceHash(readFileSync(v.source, "utf8")),
    attempts: 1,
  });
  ledger.save(path, book);
}

const commands = {
  frontier: [cmdFrontier, ["source", "branches", "traces"]],
  check: [cmdCheck, ["traces", "test-name", "prefix"]],
  retire: [cmdRetire, ["source", "key", "status", "reason"]],
};

const [command, ...rest] = process.argv.slice(2);
const entry = commands[command];
if (entry === undefined) fail(usage);
const { values } = parseArgs({
  args: rest,
  options: {
    source: { type: "string" },
    branches: { type: "string" },
    traces: { type: "string" },
    state: { type: "string", default: ".concolic" },
    "max-depth": { type: "string", default: "12" },
    "max-visits": { type: "string", default: "2" },
    "test-name": { type: "string" },
    prefix: { type: "string" },
    key: { type: "string" },
    status: { type: "string" },
    reason: { type: "string" },
  },
});
const [run, required] = entry;
const missing = required.filter((name) => values[name] === undefined);
if (missing.length > 0) fail(`missing --${missing.join(", --")}\n${usage}`);
if (
  command === "retire" &&
  !["gaveup", "infeasible", "unreachable"].includes(values.status)
) {
  fail(`unknown --status ${values.status}\n${usage}`);
}
run(values);
