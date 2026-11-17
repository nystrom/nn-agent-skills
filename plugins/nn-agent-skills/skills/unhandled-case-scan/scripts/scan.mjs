#!/usr/bin/env node
//
// Unhandled-case scan for TypeScript: finds a `switch` over a finite union that
// can silently miss a case, and an empty `catch`.
//
// This reads types. It builds one `ts.Program` per tsconfig.json and asks the
// checker what no text search answers: whether the switched-on type is a finite
// union of literals, and whether TypeScript already reports a new case of it.
// references/checks.md states each bound.
//
// usage: scan.mjs [--scope <path>]... [--project <tsconfig>]... [--out <file>]
//
// Exit codes: 0 nothing reported, 1 findings reported, 2 could not run.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const usage = `usage: scan.mjs [--scope <path>]... [--project <tsconfig>]... [--out <file>]

Options:
  --scope <path>      Restrict to this subtree. Resolved against the working
                      directory. Repeatable. A scope outside the repository, or
                      one that matches no scanned file, exits 2.
  --project <path>    Scan this tsconfig.json instead of discovering them.
                      Repeatable.
  --out <file>        Write the findings document here. Without it the document
                      goes to stdout. A ranked summary always goes to stderr.
  -h, --help          This text.

Exit codes: 0 nothing reported, 1 findings reported, 2 could not run.
`;

const fail = (message) => {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
};

// Resolved from the target repository, so the scan checks with the compiler
// version the repository builds with.
let ts;
try {
  const require = createRequire(join(process.cwd(), "noop.js"));
  ts = require("typescript");
} catch {
  fail(
    `cannot resolve the "typescript" package from ${process.cwd()}; install it in the target repository and rerun`
  );
}

const MAX_FILE_BYTES = 1024 * 1024;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage"]);
const TEST_SEGMENTS = new Set(["test", "tests", "__tests__", "__mocks__"]);

// ---------------------------------------------------------------- type queries

/** The constituents of `type`, or `[type]` when it is not a union. */
const constituents = (type) => (type.isUnion() ? type.types : [type]);

// A finite set of tags. `Kind["tag"]` is `"a" | "b"`; a name read from source
// is `string`. Only the first is a domain where a missing case is a gap.
const FINITE =
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.NumberLiteral |
  ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null |
  ts.TypeFlags.UniqueESSymbol |
  ts.TypeFlags.EnumLiteral;

const isFiniteUnion = (type) =>
  type.isUnion() && type.types.every((part) => (part.flags & FINITE) !== 0);

// TS2366 fires when the end of a function body is reachable and the declared
// return type admits no absent value. `undefined`, `void`, `any` and `unknown`
// admit one.
const ADMITS_ABSENCE =
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void |
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown;

const excludesAbsence = (type) =>
  constituents(type).every((part) => (part.flags & ADMITS_ABSENCE) === 0);

function annotationExcludesAbsence(checker, annotation, isAsync) {
  // `x is T` is `boolean`, which admits no absent value.
  if (ts.isTypePredicateNode(annotation)) {
    return true;
  }
  let type = checker.getTypeFromTypeNode(annotation);
  if (isAsync) {
    // `Promise<void>` admits an absent value once awaited.
    type = checker.getAwaitedType(type) ?? type;
  }
  return excludesAbsence(type);
}

// ------------------------------------------------------------ statement shapes

/** The function-like node whose body directly holds `node`. */
function enclosingFunction(node) {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at)) {
      return at;
    }
  }
  return undefined;
}

/** A clause's statements with nested blocks flattened (`case "x": { ... }`). */
const clauseStatements = (clause) =>
  clause.statements.flatMap((statement) =>
    ts.isBlock(statement) ? clauseStatements(statement) : [statement]
  );

// Control cannot leave the bottom of the clause into the statement after the
// switch. An empty clause falls into the next clause and leaks nothing, unless
// it is the last clause: then control leaves the switch. A `return` inside an
// earlier `if` does not count: control can still reach the end of the clause.
function exits(clause, index, clauses) {
  const last = clauseStatements(clause).at(-1);
  return last === undefined
    ? index < clauses.length - 1
    : ts.isReturnStatement(last) || ts.isThrowStatement(last);
}

/**
 * The callee text when `call` passes its argument to a parameter of type
 * `never`: the repository's exhaustiveness helper, found by signature rather
 * than by name.
 */
function neverHelper(checker, call) {
  const signature = checker.getResolvedSignature(call);
  const first = signature?.parameters[0];
  if (first === undefined) {
    return undefined;
  }
  const type = checker.getTypeOfSymbolAtLocation(first, call);
  return (type.flags & ts.TypeFlags.Never) === 0
    ? undefined
    : call.expression.getText();
}

/** Helper calls and `const x: never = v` declarations inside `nodes`. */
function closers(checker, nodes) {
  const found = { helpers: [], neverDecl: false };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const helper = neverHelper(checker, node);
      helper !== undefined && found.helpers.push(helper);
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.type?.kind === ts.SyntaxKind.NeverKeyword
    ) {
      found.neverDecl = true;
    }
    ts.forEachChild(node, visit);
  };
  nodes.forEach(visit);
  return found;
}

const isClosed = (found) => found.helpers.length > 0 || found.neverDecl;

/** The statements after `node` in its block, where a closer may follow a switch. */
function statementsAfter(node) {
  const block = node.parent;
  return ts.isBlock(block)
    ? block.statements.slice(block.statements.indexOf(node) + 1)
    : [];
}

const oneLine = (text) => text.replace(/\s+/g, " ").trim();

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `{symbol}` for a function with a plain name, `{}` for anything else. */
function namedBy(fn) {
  const name = fn?.name?.getText();
  return name !== undefined && IDENTIFIER.test(name) ? { symbol: name } : {};
}

const idFor = (prefix, file, line) =>
  `${prefix}-${file.replace(/[^A-Za-z0-9]/g, "-")}-${line}`;

const refuse = (reason) => ({ severity: "low", refused: true, reason });

// -------------------------------------------------------------------- checks

const RULE_NO_DEFAULT =
  "a switch over a finite union handles every case or fails the build";
const RULE_EMPTY_CATCH = "an empty catch states why the failure is ignored";

/**
 * Whether the type a callback is passed to constrains its return value. A
 * contextual return type of `void`, `unknown`, or `any` accepts the widened
 * result, so it does not guard.
 */
function contextGuardsResult(checker, fn) {
  const context = checker.getContextualType(fn);
  if (context === undefined) {
    return false;
  }
  const signatures = constituents(context).flatMap((part) =>
    part.getCallSignatures()
  );
  return (
    signatures.length === 0 ||
    signatures.some((signature) =>
      excludesAbsence(checker.getReturnTypeOfSignature(signature))
    )
  );
}

/**
 * A `switch` with no `default` clause. Reported only when the switched-on type
 * is a finite union and nothing already turns a new case into a compile error.
 * Without the second condition the check reports code whose contract the type
 * system already holds.
 */
function switchWithoutDefault(checker, options, node, fn) {
  const discriminant = oneLine(node.expression.getText());
  const type = checker.getTypeAtLocation(node.expression);
  if (!isFiniteUnion(type)) {
    return refuse(
      `${discriminant} has type ${oneLine(checker.typeToString(type))}, an open domain where falling through is the design rather than a gap`
    );
  }
  if (isClosed(closers(checker, statementsAfter(node)))) {
    return refuse(
      "an exhaustiveness check follows the switch, which closes the union the same way a default clause would"
    );
  }
  if (fn?.body === undefined || !ts.isBlock(fn.body)) {
    return refuse(
      "the switch is not in a function body, so it has no return type to widen"
    );
  }
  if (
    fn.body.statements.at(-1) !== node ||
    !node.caseBlock.clauses.every(exits)
  ) {
    return refuse(
      "control continues past the switch, so the clauses are a partial dispatch with a fallback after them rather than an attempt to cover the union"
    );
  }
  if (!ts.getStrictOptionValue(options, "strictNullChecks")) {
    return refuse(
      "strictNullChecks is off for this project, so an unhandled case does not widen the inferred return type"
    );
  }
  if (fn.type !== undefined) {
    const isAsync =
      fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true;
    return refuse(
      annotationExcludesAbsence(checker, fn.type, isAsync)
        ? "the enclosing function declares a return type that admits no absent value, so adding a case to the union is already TS2366"
        : "the enclosing function declares a return type that admits an absent value, so the unhandled case is part of its contract rather than an oversight"
    );
  }
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    contextGuardsResult(checker, fn)
  ) {
    return refuse(
      "the function is a callback with a contextual return type, so adding a case to the union is a type error at the call that passes it"
    );
  }
  const signature = checker.getSignatureFromDeclaration(fn);
  if (
    signature === undefined ||
    !excludesAbsence(checker.getReturnTypeOfSignature(signature))
  ) {
    return refuse(
      "the function's inferred return type already admits an absent value, so an unhandled case widens nothing"
    );
  }
  return {
    severity: "medium",
    refused: false,
    evidence:
      "nothing constrains this function's return type: no annotation, and it is not a callback with a contextual one. Adding a case to the union widens the inferred return type with undefined, and the compiler reports it at each caller that uses the result instead of here. The diagnostic is misplaced rather than absent, so the severity is medium",
  };
}

/** A `catch` block or `.catch(() => {})` handler with no statements. */
function emptyHandlerFinding(source, file, block, node) {
  const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  // No statements, so anything between the braces is a comment, which states
  // the intent the rule asks for.
  const commented = /\/\/|\/\*/.test(
    source.text.slice(block.getStart() + 1, block.getEnd() - 1)
  );
  return {
    id: idFor("empty-catch", file, line),
    check: "empty-catch",
    file,
    line,
    severity: commented ? "low" : "high",
    signal: commented
      ? "catch block holds only a comment"
      : "catch block is empty",
    evidence: RULE_EMPTY_CATCH,
    refused: commented,
    ...(commented
      ? { reason: "the comment states why the failure is ignored" }
      : {
          proposal:
            "handle or report the error, or say in a comment why this failure is not worth reporting",
        }),
  };
}

// A receiver with a `then` member is promise-shaped; other APIs name a method
// `catch` for unrelated reasons.
const isPromiseCatchHandler = (checker, node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "catch" &&
  node.arguments.length === 1 &&
  checker.getTypeAtLocation(node.expression.expression).getProperty("then") !==
    undefined;

// -------------------------------------------------------------------- driver

const scopeArgs = [];
const projectArgs = [];
let outFile;
const args = process.argv.slice(2);
const valueOf = (i, flag) =>
  args[i + 1] === undefined
    ? fail(`${flag} needs a value\n${usage}`)
    : args[i + 1];
for (let i = 0; i < args.length; i += 1) {
  switch (args[i]) {
    case "--scope":
      scopeArgs.push(valueOf(i, "--scope"));
      i += 1;
      break;
    case "--project":
      projectArgs.push(valueOf(i, "--project"));
      i += 1;
      break;
    case "--out":
      outFile = valueOf(i, "--out");
      i += 1;
      break;
    case "-h":
    case "--help":
      process.stdout.write(usage);
      process.exit(0);
    default:
      fail(`unexpected argument ${args[i]}\n${usage}`);
  }
}

let root;
try {
  root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  root = process.cwd();
}

const posix = (path) => path.split(sep).join("/");
const relRoot = (path) => posix(relative(root, path));
const insideRoot = (rel) =>
  rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);

// Resolved against the working directory, so `--scope src/lib` from inside a
// package means that directory.
const scopes = scopeArgs.map((given) => {
  const absolute = resolve(process.cwd(), given);
  const rel = relRoot(absolute).replace(/\/$/, "");
  if (!insideRoot(rel)) {
    fail(
      `--scope ${given} resolves to ${absolute}, outside the repository ${root}`
    );
  }
  return { given, rel, matched: 0 };
});

// Counted over scanned files, so a scope naming a real directory with no gap in
// it reports a clean subtree instead of exiting 2 as unmatched.
const inScope = (rel) => {
  if (scopes.length === 0) {
    return true;
  }
  const hit = scopes.filter(
    (scope) =>
      scope.rel === "" || rel === scope.rel || rel.startsWith(`${scope.rel}/`)
  );
  hit.forEach((scope) => (scope.matched += 1));
  return hit.length > 0;
};

const isProduction = (rel) =>
  /\.[cm]?tsx?$/.test(rel) &&
  !/\.d\.[cm]?ts$/.test(rel) &&
  !/\.(test|spec)\.[cm]?tsx?$/.test(rel) &&
  !rel.split("/").some((segment) => TEST_SEGMENTS.has(segment));

/** Every tsconfig.json under `dir`, without following symlinks. */
function discoverProjects(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === "tsconfig.json") {
      found.push(join(dir, entry.name));
    } else if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !SKIPPED_DIRS.has(entry.name)
    ) {
      discoverProjects(join(dir, entry.name), found);
    }
  }
  return found;
}

const projects =
  projectArgs.length > 0
    ? projectArgs.map((given) => resolve(process.cwd(), given))
    : discoverProjects(root);

if (projects.length === 0) {
  fail(`no tsconfig.json found under ${root}`);
}

// Deepest config first: a file listed by several configs is analyzed under the
// one nearest to it.
projects.sort(
  (a, b) => b.split(sep).length - a.split(sep).length || a.localeCompare(b)
);

const raw = [];
const skipped = [];
const scanned = new Set();
const helperCounts = new Map();
let projectsScanned = 0;

for (const project of projects) {
  const config = ts.readConfigFile(project, ts.sys.readFile);
  if (config.error !== undefined) {
    skipped.push({
      path: relRoot(project),
      reason: `unreadable: ${ts.flattenDiagnosticMessageText(config.error.messageText, " ")}`,
    });
    continue;
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(project)
  );
  // 18003 is "no inputs found", which the empty-project check below handles.
  const configErrors = parsed.errors.filter((error) => error.code !== 18003);
  if (configErrors.length > 0) {
    skipped.push({
      path: relRoot(project),
      reason: `config errors: ${ts.flattenDiagnosticMessageText(configErrors[0].messageText, " ")}`,
    });
    continue;
  }
  // The size limit applies before the program reads the file.
  const rootNames = parsed.fileNames.filter((name) => {
    try {
      if (statSync(name).size > MAX_FILE_BYTES) {
        skipped.push({ path: relRoot(name), reason: "larger than 1 MiB" });
        return false;
      }
    } catch {
      // The program reports a file it cannot read.
    }
    return true;
  });
  const ownFiles = new Set(
    rootNames
      .map(relRoot)
      .filter((rel) => insideRoot(rel) && isProduction(rel) && !scanned.has(rel))
  );
  if (ownFiles.size === 0) {
    continue;
  }
  if (scopes.length > 0 && ![...ownFiles].some(inScope)) {
    continue;
  }
  const program = ts.createProgram({
    rootNames,
    // A composite project would demand the build output of the projects it
    // references, which this scan does not produce.
    options: {
      ...parsed.options,
      composite: false,
      declaration: false,
      noEmit: true,
    },
  });
  const checker = program.getTypeChecker();
  projectsScanned += 1;

  for (const source of program.getSourceFiles()) {
    const file = relRoot(source.fileName);
    // A program also holds what its files import; those belong to the config
    // that lists them.
    if (!ownFiles.has(file) || scanned.has(file)) {
      continue;
    }
    scanned.add(file);
    if (!inScope(file)) {
      continue;
    }

    const walk = (node) => {
      if (ts.isSwitchStatement(node)) {
        const line =
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const clause = node.caseBlock.clauses.find(ts.isDefaultClause);
        if (clause === undefined) {
          const fn = enclosingFunction(node);
          raw.push({
            id: idFor("no-default", file, line),
            check: "no-default",
            file,
            line,
            ...namedBy(fn),
            signal: `switch (${oneLine(node.expression.getText())}) has no default clause`,
            evidence: RULE_NO_DEFAULT,
            ...switchWithoutDefault(checker, parsed.options, node, fn),
          });
        } else {
          closers(checker, [clause]).helpers.forEach((name) =>
            helperCounts.set(name, (helperCounts.get(name) ?? 0) + 1)
          );
        }
      }
      if (ts.isCatchClause(node) && node.block.statements.length === 0) {
        raw.push(emptyHandlerFinding(source, file, node.block, node));
      }
      if (isPromiseCatchHandler(checker, node)) {
        const [handler] = node.arguments;
        if (
          (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
          ts.isBlock(handler.body) &&
          handler.body.statements.length === 0
        ) {
          raw.push(emptyHandlerFinding(source, file, handler.body, node));
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
}

if (projectsScanned === 0) {
  fail(
    `no production TypeScript file found in ${projects.map(relRoot).join(", ")}${skipped.map((s) => `; skipped ${s.path} (${s.reason})`).join("")}`
  );
}

const unmatched = scopes.filter((scope) => scope.matched === 0);
if (unmatched.length > 0) {
  fail(
    `--scope ${unmatched.map((scope) => scope.given).join(", ")} matched none of the ${scanned.size} scanned files; scopes are ${scopes.map((scope) => scope.rel).join(", ")} relative to ${root}`
  );
}

// The most-used helper is the one the repository already follows.
const helpers = [...helperCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([name, uses]) => ({ name, uses }));

const noDefaultProposal =
  helpers.length > 0
    ? `add a default clause calling ${helpers[0].name}(<narrowed value>), so the compiler names this switch when the union grows instead of naming its callers`
    : "add a default clause with `const _exhaustive: never = <narrowed value>`, so the compiler names this switch when the union grows instead of naming its callers";

for (const finding of raw) {
  if (finding.refused) {
    finding.proposal = "none, because this finding is refused";
  } else if (finding.check === "no-default") {
    finding.proposal = noDefaultProposal;
  }
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const byRank = (a, b) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  a.file.localeCompare(b.file) ||
  a.line - b.line;
const reported = raw.filter((finding) => !finding.refused).sort(byRank);
const refused = raw.filter((finding) => finding.refused).sort(byRank);

const document = {
  tool: "unhandled-case-scan",
  root,
  scope:
    scopes.length === 0
      ? "every production TypeScript file in the scanned projects"
      : scopes.map((scope) => scope.rel).join(", "),
  generated_at: new Date().toISOString(),
  projects: projects.map(relRoot),
  exhaustiveness_helpers: helpers,
  skipped,
  counts: {
    files: scanned.size,
    candidates: raw.length,
    refused: refused.length,
    reported: reported.length,
  },
  findings: [...reported, ...refused],
};

const json = JSON.stringify(document, null, 2) + "\n";
if (outFile === undefined) {
  process.stdout.write(json);
} else {
  writeFileSync(resolve(process.cwd(), outFile), json);
}

const summary = [
  `scan.mjs: ${scanned.size} files in ${projectsScanned} projects, ${raw.length} candidates, ${refused.length} refused, ${reported.length} reported`,
  helpers.length > 0
    ? `exhaustiveness helper: ${helpers.map((h) => `${h.name} (${h.uses})`).join(", ")}`
    : "exhaustiveness helper: none found in a default clause",
  ...skipped.map((entry) => `skipped ${entry.path}: ${entry.reason}`),
  ...reported.map(
    (finding) =>
      `${finding.severity} ${finding.file}:${finding.line} ${finding.signal}`
  ),
];
process.stderr.write(summary.join("\n") + "\n");

process.exitCode = reported.length > 0 ? 1 : 0;
