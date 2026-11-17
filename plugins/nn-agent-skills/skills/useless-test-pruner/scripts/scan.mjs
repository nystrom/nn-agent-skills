#!/usr/bin/env node
//
// Finds test cases that run and cannot fail, in three static stages:
//   A  a case with no assertion at all
//   B  an assertion that holds for every input
//   C  a case whose assertions never reach code this repo owns
//
// The stages fail in opposite directions. A missed helper in stage A adds a
// refusal. A missed import in stage C turns a working test into a deletion
// proposal, so stage C only asks for confirmation. See ../references/checks.md.
//
// Exit codes: 0 no findings reported, 1 findings reported, 2 could not run.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

const USAGE = `usage: scan.mjs [--root <dir>] [--scope <path>]... [--exempt <path>]... [--out <file>]

  --root <dir>     Repository root. Default: git top level, else the cwd.
  --scope <path>   Scan only this file or directory. Repeatable.
  --exempt <path>  Report cases in this file as refused. Repeatable.
  --out <file>     Write the findings JSON here and print a ranked summary.
                   Without it, the JSON goes to stdout.
  -h, --help       This text.
`;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
]);
const CODE_EXT = "(ts|tsx|mts|cts|js|jsx|mjs|cjs)";
const TEST_FILE = new RegExp(`\\.(test|spec)\\.${CODE_EXT}$`);
const TEST_DIR_FILE = new RegExp(`(^|/)__tests__/.*\\.${CODE_EXT}$`);
const EXT = /\.(m|c)?[jt]sx?$/;

const RUNNERS = new Set(["it", "test", "specify", "fit", "xit", "xtest"]);
const SKIPPED_RUNNERS = new Set(["xit", "xtest"]);
const SUITES = new Set(["describe", "suite", "context", "xdescribe"]);

/** Calls that are assertions themselves: assertEqual, expectShortCircuit, fail. */
const ASSERTION_HELPER = /^(assert|expect)[A-Z_]|^(assert|invariant|fail)$/;
const SNAPSHOT_MATCHER = /^to(Match|ThrowErrorMatching)(Inline|File)?Snapshot$/;
const EXISTENCE_MATCHER =
  /^(toBeDefined|toBeTruthy|toBeFalsy|toBeNull|toBeUndefined)$/;
const EQUALITY_MATCHER = /^(toBe|toEqual|toStrictEqual)$/;

/** The runner or assertion library, not a dependency under test. */
const RUNNER_MODULE =
  /^(@jest\/|jest-|vitest|@vitest\/|mocha|chai|node:|assert(\/|$)|test$)/;
/** What a whole-tree check reads the source with. */
const IO_MODULE = /^(node:)?(fs|child_process)(\/|$)/;

const SEVERITY_ORDER = ["high", "medium", "question", "low"];

function fail(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { root: null, scopes: [], exempt: [], out: null };
  const value = (i, flag) => argv[i] ?? fail(`${flag} needs a value\n${USAGE}`);
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--root":
        opts.root = resolve(value(++i, "--root"));
        break;
      case "--scope":
        opts.scopes.push(resolve(value(++i, "--scope")));
        break;
      case "--exempt":
        opts.exempt.push(resolve(value(++i, "--exempt")));
        break;
      case "--out":
        opts.out = resolve(value(++i, "--out"));
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        fail(`unexpected argument ${argv[i]}\n${USAGE}`);
    }
  }
  return opts;
}

function findRoot(explicit) {
  if (explicit !== null) {
    return existsSync(explicit) ? explicit : fail(`no such root ${explicit}`);
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Cases are attributed to their enclosing `it`, which no line search can do,
 * so the parser is required. A missing one exits 2: a zero here would read the
 * same as a clean tree.
 */
function loadTypeScript(root) {
  for (const dir of [root, process.cwd()]) {
    try {
      return createRequire(join(dir, "package.json"))("typescript");
    } catch {
      /* try the next directory */
    }
  }
  return fail(
    "cannot resolve the typescript package from the repo; run `npm i -D typescript` and rerun"
  );
}

const toRel = (root, path) => relative(root, path).split(sep).join("/");

function walk(root, start, out, skipped) {
  let entries;
  try {
    entries = readdirSync(start, { withFileTypes: true });
  } catch (error) {
    skipped.push({ file: toRel(root, start), reason: `unreadable: ${error.code}` });
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    // Symlinks are skipped so a link cycle or a link out of the repo is not read.
    if (entry.isSymbolicLink()) {
      continue;
    }
    const full = join(start, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
        walk(root, full, out, skipped);
      }
    } else if (entry.isFile() && !entry.name.endsWith(".d.ts")) {
      const rel = toRel(root, full);
      if (TEST_FILE.test(entry.name) || TEST_DIR_FILE.test(rel)) {
        out.push(rel);
      }
    }
  }
}

function discoverTests(root, scopes, skipped) {
  const out = [];
  for (const start of scopes.length === 0 ? [root] : scopes) {
    if (!existsSync(start)) {
      fail(`no such scope ${start}`);
    }
    // The real path is checked so a link inside the scope cannot lead out of the repo.
    const rel = toRel(realpathSync(root), realpathSync(start));
    if (rel.startsWith("..") || isAbsolute(rel)) {
      fail(`scope ${start} is outside ${root}`);
    }
    if (statSync(start).isFile()) {
      out.push(toRel(root, start));
    } else {
      walk(root, start, out, skipped);
    }
  }
  return [...new Set(out)].sort();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Directories named by one workspace pattern: `dir`, `dir/*`, or `dir/**`. */
function expandPattern(root, pattern) {
  if (pattern.startsWith("!")) {
    return [];
  }
  const base = pattern.replace(/\/\*\*?$/, "");
  if (base.includes("*")) {
    return [];
  }
  const dir = join(root, base);
  if (base === pattern) {
    return existsSync(dir) ? [dir] : [];
  }
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

function workspacePatterns(root, pkg) {
  const ws = pkg?.workspaces;
  const patterns = Array.isArray(ws) ? [...ws] : [...(ws?.packages ?? [])];
  const pnpm = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) {
    const item = /^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*$/gm;
    for (const m of readFileSync(pnpm, "utf8").matchAll(item)) {
      patterns.push(m[1]);
    }
  }
  return patterns;
}

/**
 * How this repo names its own code in a bare import: workspace package names
 * and tsconfig path aliases. A relative path and a `#` subpath import are
 * always own. Only the root tsconfig is read.
 */
function ownSpecifiers(ts, root) {
  const names = new Set();
  const prefixes = new Set();
  const pkg = readJson(join(root, "package.json"));
  if (typeof pkg?.name === "string") {
    names.add(pkg.name);
  }
  for (const pattern of workspacePatterns(root, pkg)) {
    for (const dir of expandPattern(root, pattern)) {
      const name = readJson(join(dir, "package.json"))?.name;
      if (typeof name === "string") {
        names.add(name);
      }
    }
  }
  const tsconfig = join(root, "tsconfig.json");
  if (existsSync(tsconfig)) {
    const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
    if (read.config !== undefined) {
      // Empty include and files keep the parse from walking the whole tree.
      const parsed = ts.parseJsonConfigFileContent(
        { ...read.config, include: [], files: [] },
        ts.sys,
        root
      );
      for (const key of Object.keys(parsed.options.paths ?? {})) {
        const prefix = key.replace(/\*.*$/, "");
        if (prefix !== "") {
          prefixes.add(prefix);
        }
      }
    }
  }
  const isOwn = (spec) =>
    /^[./#]/.test(spec) ||
    [...names].some((n) => spec === n || spec.startsWith(`${n}/`)) ||
    [...prefixes].some((p) => spec.startsWith(p));
  return { isOwn, names: [...names].sort(), aliases: [...prefixes].sort() };
}

const normalize = (text) => text.replace(/\s+/g, " ").trim();
const idFor = (file, line, suffix) =>
  `utp-${suffix}-${file.replace(/[^A-Za-z0-9]/g, "-")}-${line}`;

/**
 * Test files that another test file imports. A runner that fails a file with
 * no case makes the placeholder case in such a helper module structural.
 */
function helperModules(files, texts) {
  const byStem = new Map(files.map((f) => [f.replace(EXT, ""), f]));
  const imported = new Set();
  const spec = /(?:from|import\(|require\()\s*["'](\.[^"']*)["']/g;
  for (const file of files) {
    for (const m of texts.get(file).matchAll(spec)) {
      const stem = posix
        .normalize(posix.join(posix.dirname(file), m[1]))
        .replace(EXT, "");
      const hit = byStem.get(stem);
      if (hit !== undefined && hit !== file) {
        imported.add(hit);
      }
    }
  }
  return imported;
}

/** `it`, `it.each`, `it.skip`, `describe.each(...)(...)`: the name and the tail. */
function calleeInfo(ts, expr) {
  const tail = [];
  let node = expr;
  for (;;) {
    if (ts.isCallExpression(node)) {
      node = node.expression;
    } else if (ts.isPropertyAccessExpression(node)) {
      tail.unshift(node.name.text);
      node = node.expression;
    } else if (ts.isTaggedTemplateExpression(node)) {
      node = node.tag;
    } else if (
      ts.isNonNullExpression(node) ||
      ts.isParenthesizedExpression(node)
    ) {
      node = node.expression;
    } else {
      break;
    }
  }
  return ts.isIdentifier(node) ? { name: node.text, tail } : null;
}

/**
 * Everything a file declares at any scope, and where each imported name came
 * from. Top-level declarations alone miss helpers declared inside a `describe`
 * and names bound by `await import()`, and both make a working test look
 * untethered.
 */
function fileFacts(ts, sf, isOwn) {
  const decls = new Map();
  const product = new Set();
  const vendor = new Set();
  const io = new Set();
  const imported = new Map();
  const topLevelLets = new Set();
  const assigned = new Set();

  const bound = (name, sink) => {
    if (ts.isIdentifier(name)) {
      sink.push(name.text);
    } else if (
      ts.isObjectBindingPattern(name) ||
      ts.isArrayBindingPattern(name)
    ) {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) {
          bound(el.name, sink);
        }
      }
    }
  };
  const classify = (specifier, names) => {
    let sink = vendor;
    if (isOwn(specifier)) {
      sink = product;
    } else if (IO_MODULE.test(specifier)) {
      sink = io;
    } else if (RUNNER_MODULE.test(specifier)) {
      return;
    }
    for (const name of names) {
      sink.add(name);
      // Vendor calls count too: a dependency's `findBy*` throws and so asserts.
      if (sink !== io) {
        imported.set(name, specifier);
      }
    }
  };
  /** Specifiers of `import("x")` and `require("x")` inside an initializer. */
  const dynamicSpecifiers = (node) => {
    const found = [];
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        n.arguments.length > 0 &&
        ts.isStringLiteralLike(n.arguments[0]) &&
        (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(n.expression) && n.expression.text === "require"))
      ) {
        found.push(n.arguments[0].text);
      }
      n.forEachChild(visit);
    };
    visit(node);
    return found;
  };

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const names = [];
      if (clause?.name !== undefined) {
        names.push(clause.name.text);
      }
      const b = clause?.namedBindings;
      if (b !== undefined && ts.isNamedImports(b)) {
        b.elements.forEach((e) => names.push(e.name.text));
      }
      if (b !== undefined && ts.isNamespaceImport(b)) {
        names.push(b.name.text);
      }
      if (clause?.isTypeOnly !== true) {
        classify(node.moduleSpecifier.text, names);
      }
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      decls.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node)) {
      const names = [];
      bound(node.name, names);
      const specs =
        node.initializer === undefined ? [] : dynamicSpecifiers(node.initializer);
      if (specs.length > 0) {
        specs.forEach((s) => classify(s, names));
      } else {
        names.forEach((n) => decls.set(n, node));
      }
      // A file-scope `let`: declaration, list, statement, source file.
      const isFileScopeLet =
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) === 0 &&
        node.parent.parent?.parent === sf;
      if (isFileScopeLet) {
        names.forEach((n) => topLevelLets.add(n));
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      ts.isIdentifier(node.left) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      assigned.add(node.left.text);
    }
    if (
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
      ts.isIdentifier(node.operand)
    ) {
      assigned.add(node.operand.text);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);

  const accumulators = new Set(
    [...topLevelLets].filter((n) => assigned.has(n))
  );
  return { decls, product, vendor, io, imported, accumulators };
}

function identifiers(ts, node) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      names.add(n.text);
    }
    n.forEachChild(visit);
  };
  visit(node);
  return names;
}

/** Whether a subtree asserts, directly or through a helper this file declares. */
function assertsIn(ts, node, decls, seen) {
  let found = false;
  const visit = (n) => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(n)) {
      const info = calleeInfo(ts, n.expression);
      if (info !== null) {
        if (
          info.name === "expect" ||
          info.tail.includes("expect") ||
          ASSERTION_HELPER.test(info.name)
        ) {
          found = true;
          return;
        }
        const decl = decls.get(info.name);
        if (decl !== undefined && !seen.has(info.name)) {
          seen.add(info.name);
          if (assertsIn(ts, decl, decls, seen)) {
            found = true;
            return;
          }
        }
      }
    }
    // chai should style: `x.should.equal(y)`.
    if (ts.isPropertyAccessExpression(n) && n.name.text === "should") {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

/** Names reached from a case, following calls into helpers this file declares. */
function reachedNames(ts, node, decls) {
  const seen = new Set();
  const all = new Set();
  const visit = (subtree) => {
    for (const name of identifiers(ts, subtree)) {
      all.add(name);
      const decl = decls.get(name);
      if (decl !== undefined && !seen.has(name)) {
        seen.add(name);
        visit(decl);
      }
    }
  };
  visit(node);
  return all;
}

function assertionParts(ts, call) {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }
  const modifiers = [];
  let inner = call.expression.expression;
  while (ts.isPropertyAccessExpression(inner)) {
    modifiers.push(inner.name.text);
    inner = inner.expression;
  }
  if (
    !ts.isCallExpression(inner) ||
    !ts.isIdentifier(inner.expression) ||
    inner.expression.text !== "expect"
  ) {
    return null;
  }
  return {
    matcher: call.expression.name.text,
    modifiers,
    subject: inner.arguments[0],
  };
}

/** Whether evaluating the node twice can give different values. */
function mayVary(ts, node) {
  let found = false;
  const visit = (n) => {
    const assigns =
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    if (
      ts.isCallExpression(n) ||
      ts.isNewExpression(n) ||
      ts.isAwaitExpression(n) ||
      ts.isPostfixUnaryExpression(n) ||
      ts.isPrefixUnaryExpression(n) ||
      assigns
    ) {
      found = true;
    }
    if (!found) {
      n.forEachChild(visit);
    }
  };
  if (node !== undefined) {
    visit(node);
  }
  return found;
}

/** The value of a primitive literal node, or `{ ok: false }`. */
function literalValue(ts, node) {
  if (node === undefined) {
    return { ok: false };
  }
  if (ts.isStringLiteralLike(node)) {
    return { ok: true, value: node.text };
  }
  if (ts.isNumericLiteral(node)) {
    return { ok: true, value: Number(node.text.replace(/_/g, "")) };
  }
  if (ts.isBigIntLiteral(node)) {
    return { ok: true, value: BigInt(node.text.slice(0, -1).replace(/_/g, "")) };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return { ok: true, value: true };
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return { ok: true, value: false };
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return { ok: true, value: null };
  }
  return { ok: false };
}

/** Whether an existence matcher passes for a literal value. */
function existencePasses(matcher, value) {
  switch (matcher) {
    case "toBeDefined":
      return true;
    case "toBeUndefined":
      return false;
    case "toBeNull":
      return value === null;
    case "toBeTruthy":
      return Boolean(value);
    default:
      return !value;
  }
}

/**
 * Why an assertion holds for every input, or null. `.not` is skipped, and so
 * is a literal assertion that always fails: that is a different bug with a
 * different fix.
 */
function tautologyReason(ts, sf, call) {
  const parts = assertionParts(ts, call);
  if (parts === null || parts.modifiers.includes("not")) {
    return null;
  }
  const { matcher, subject } = parts;
  const expected = call.arguments[0];
  const subjectText =
    subject === undefined ? null : normalize(subject.getText(sf));
  const expectedText =
    expected === undefined ? null : normalize(expected.getText(sf));
  const equality = EQUALITY_MATCHER.test(matcher);
  if (equality && subjectText !== null && subjectText === expectedText) {
    return mayVary(ts, subject)
      ? {
          severity: "medium",
          reason:
            "subject and expected value are the same expression, and evaluating it can differ between runs, so the assertion checks that it is stable",
          proposal:
            "compare two independently constructed values, or assert the form the case title claims",
        }
      : {
          severity: "high",
          reason: "subject and expected value are the same expression",
          proposal:
            "assert the subject against the value the case is about, which is a different expression than the one on the left; a getter is the one case where the two sides can differ",
        };
  }
  const a = literalValue(ts, subject);
  const b = literalValue(ts, expected);
  if (equality && a.ok && b.ok && Object.is(a.value, b.value)) {
    return {
      severity: "high",
      reason: "both sides of the comparison are equal literals",
      proposal: "assert the value the code under test produces",
    };
  }
  if (
    EXISTENCE_MATCHER.test(matcher) &&
    a.ok &&
    existencePasses(matcher, a.value)
  ) {
    return {
      severity: "high",
      reason: "an existence matcher that passes for the literal it is applied to",
      proposal: "assert the value the code under test produces",
    };
  }
  if (
    equality &&
    expectedText !== null &&
    /^expect\.(anything|any)\b/.test(expectedText)
  ) {
    return {
      severity: "medium",
      reason:
        "the expected value is expect.anything() or expect.any(), which checks only that a value of that kind exists",
      proposal:
        "assert the value, or confirm the kind check is the point of the case",
    };
  }
  return null;
}

/** Every runnable case in a file, with what its body reaches. */
function casesIn(ts, sf, facts) {
  const cases = [];
  const visit = (node, skipped) => {
    let inherited = skipped;
    if (ts.isCallExpression(node)) {
      const info = calleeInfo(ts, node.expression);
      const marked =
        info !== null &&
        (info.tail.includes("skip") ||
          info.tail.includes("todo") ||
          SKIPPED_RUNNERS.has(info.name) ||
          info.name === "xdescribe");
      if (info !== null && SUITES.has(info.name)) {
        inherited = skipped || marked;
      }
      if (info !== null && RUNNERS.has(info.name)) {
        const fn = node.arguments.find(
          (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)
        );
        const first = node.arguments[0];
        if (!skipped && !marked && fn?.body !== undefined) {
          cases.push({
            title:
              first !== undefined && ts.isStringLiteralLike(first)
                ? first.text
                : "<computed name>",
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            ...classifyBody(ts, sf, fn, facts),
          });
        }
      }
    }
    node.forEachChild((child) => visit(child, inherited));
  };
  sf.forEachChild((child) => visit(child, false));
  return cases;
}

function classifyBody(ts, sf, fn, facts) {
  const body = fn.body;
  // A call on a parameter of the case (`t.ok(...)`, `done()`) is the runner's
  // own assertion API.
  const params = new Set(
    fn.parameters.filter((p) => ts.isIdentifier(p.name)).map((p) => p.name.text)
  );
  let expects = 0;
  let snapshot = false;
  const ownAssertions = new Set();
  const assertingHelpers = new Set();
  const opaqueHelpers = new Set();
  const tautologies = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const info = calleeInfo(ts, node.expression);
      if (info !== null) {
        if (info.name === "expect") {
          expects += 1;
          if (info.tail.some((n) => SNAPSHOT_MATCHER.test(n))) {
            snapshot = true;
          }
        } else if (info.tail.includes("expect")) {
          ownAssertions.add(`${info.name}...expect`);
        } else if (ASSERTION_HELPER.test(info.name)) {
          ownAssertions.add(info.name);
        } else if (params.has(info.name)) {
          ownAssertions.add(`${info.name} (case parameter)`);
        } else {
          const decl = facts.decls.get(info.name);
          if (decl !== undefined) {
            if (assertsIn(ts, decl, facts.decls, new Set([info.name]))) {
              assertingHelpers.add(info.name);
            }
          } else if (facts.imported.has(info.name)) {
            opaqueHelpers.add(info.name);
          }
        }
      }
      const found = tautologyReason(ts, sf, node);
      if (found !== null) {
        tautologies.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: normalize(node.getText(sf)).slice(0, 160),
          ...found,
        });
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "should") {
      ownAssertions.add("should");
    }
    node.forEachChild(visit);
  };
  visit(body);

  const reached = [...reachedNames(ts, body, facts.decls)];
  const reachedIn = (set) => reached.filter((n) => set.has(n));
  return {
    expects,
    snapshot,
    tautologies,
    ownAssertions: [...ownAssertions],
    assertingHelpers: [...assertingHelpers],
    opaqueHelpers: [...opaqueHelpers],
    product: reachedIn(facts.product),
    vendor: reachedIn(facts.vendor),
    io: reachedIn(facts.io),
    accumulator: reachedIn(facts.accumulators),
  };
}

const refuse = (base, reason, evidence) => ({
  ...base,
  severity: "low",
  evidence,
  proposal: "none",
  refused: true,
  reason,
});

const EXEMPT_REASON = "exempt: the caller passed this file with --exempt";

/** Stage A: a case that runs and asserts nothing. */
function stageA(rel, c, exempt) {
  if (c.expects > 0 || c.snapshot) {
    return null;
  }
  const base = {
    id: idFor(rel, c.line, "noassert"),
    stage: "A",
    file: rel,
    line: c.line,
    signal: `the case "${c.title}" runs and contains no expect()`,
  };
  if (exempt.has(rel)) {
    return refuse(base, EXEMPT_REASON, "no per-case assertion to find");
  }
  if (c.ownAssertions.length > 0) {
    return refuse(
      base,
      "the case asserts through an assertion helper, a runner API, or an assert library, which throw instead of calling expect()",
      `the body uses ${c.ownAssertions.join(", ")}`
    );
  }
  if (c.assertingHelpers.length > 0) {
    return refuse(
      base,
      "the assertion is inside a helper this file declares",
      `${c.assertingHelpers.join(", ")} is declared in this file and asserts`
    );
  }
  if (c.opaqueHelpers.length > 0) {
    return refuse(
      base,
      "the case calls an imported symbol this scan does not follow, and an imported helper may assert",
      `the body calls the imported ${c.opaqueHelpers.join(", ")}`
    );
  }
  return {
    ...base,
    severity: "medium",
    evidence:
      "no expect(), no assertion helper, and no helper in this file that asserts; the case can only fail by throwing",
    proposal:
      "confirm the case is not a deliberate does-not-throw check, then restore the assertion the title implies or delete the case",
    refused: false,
  };
}

/** Stage B: an assertion that holds for every input. */
function stageB(rel, c, exempt) {
  if (c.snapshot) {
    return [];
  }
  return c.tautologies.map((t) => {
    const base = {
      id: idFor(rel, t.line, "tautology"),
      stage: "B",
      file: rel,
      line: t.line,
      signal: t.reason,
      evidence: `\`${t.text}\` in "${c.title}"`,
    };
    if (exempt.has(rel)) {
      return refuse(base, EXEMPT_REASON, base.evidence);
    }
    return {
      ...base,
      severity: t.severity,
      proposal: t.proposal,
      refused: false,
    };
  });
}

/** Stage C: a case that asserts without reaching this repo's own code. */
function stageC(rel, c, helpers, exempt) {
  const asserts =
    c.expects > 0 || c.ownAssertions.length > 0 || c.assertingHelpers.length > 0;
  if (!asserts || c.snapshot || c.product.length > 0) {
    return null;
  }
  const base = {
    id: idFor(rel, c.line, "noproduct"),
    stage: "C",
    file: rel,
    line: c.line,
    signal: `the case "${c.title}" asserts without reaching any symbol imported from this repo`,
  };
  if (exempt.has(rel)) {
    return refuse(base, EXEMPT_REASON, "no product symbol by design");
  }
  if (c.tautologies.length > 0) {
    return refuse(
      base,
      "folded into the stage B finding on the same case, which names the assertion rather than the case",
      `stage B reports ${c.tautologies.length} assertion(s) in this case`
    );
  }
  if (c.accumulator.length > 0) {
    return refuse(
      base,
      "the subject is a file-scope binding the other cases write, so the case is an aggregate guard over them",
      `the case reads ${c.accumulator.join(", ")}, assigned elsewhere in the file`
    );
  }
  if (c.io.length > 0) {
    return refuse(
      base,
      "the case reads the filesystem or runs a process, so it may assert over the source tree",
      `the case reaches ${c.io.join(", ")}`
    );
  }
  if (c.vendor.length > 0) {
    return refuse(
      base,
      "the case may pin a dependency's behavior on purpose, which nothing else in the suite would notice",
      `the case reaches ${c.vendor.join(", ")}, imported from a dependency`
    );
  }
  if (helpers.has(rel)) {
    return refuse(
      base,
      "a runner can fail a test file that declares no case, so a placeholder case in a module other test files import is structural",
      `${rel} is imported by another test file`
    );
  }
  return {
    ...base,
    severity: "question",
    evidence:
      "the case's reference closure, following helpers declared in this file, names no symbol imported from this repo, so no change here can fail it",
    proposal:
      "confirm the case covers nothing this repo owns, then delete it; an import this scan failed to attribute looks the same",
    refused: false,
  };
}

function scan(ts, root, opts) {
  const own = ownSpecifiers(ts, root);
  const skipped = [];
  const files = discoverTests(root, opts.scopes, skipped);
  if (files.length === 0) {
    fail("no test files in scope");
  }
  const exempt = new Set(opts.exempt.map((p) => toRel(root, p)));
  const texts = new Map();
  const sources = new Map();
  for (const rel of files) {
    const full = join(root, rel);
    try {
      if (statSync(full).size > MAX_FILE_BYTES) {
        skipped.push({ file: rel, reason: "larger than 2 MiB" });
        continue;
      }
      const text = readFileSync(full, "utf8");
      const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
      // A file with syntax errors gives a partial tree, and a partial tree
      // reads as a case with no assertion.
      if (sf.parseDiagnostics.length > 0) {
        skipped.push({ file: rel, reason: "syntax errors" });
        continue;
      }
      texts.set(rel, text);
      sources.set(rel, sf);
    } catch (error) {
      skipped.push({ file: rel, reason: `unreadable: ${error.code ?? error.message}` });
    }
  }
  const scanned = files.filter((f) => texts.has(f));
  if (scanned.length === 0) {
    fail(`none of the ${files.length} test files could be scanned (see skipped_files)`);
  }
  const helpers = helperModules(scanned, texts);

  const raw = [];
  for (const rel of scanned) {
    const sf = sources.get(rel);
    const facts = fileFacts(ts, sf, own.isOwn);
    for (const c of casesIn(ts, sf, facts)) {
      const a = stageA(rel, c, exempt);
      if (a !== null) {
        raw.push(a);
      }
      raw.push(...stageB(rel, c, exempt));
      const cc = stageC(rel, c, helpers, exempt);
      if (cc !== null) {
        raw.push(cc);
      }
    }
  }
  const rank = (f) => SEVERITY_ORDER.indexOf(f.severity);
  const sorted = [...raw].sort(
    (a, b) =>
      Number(a.refused) - Number(b.refused) ||
      rank(a) - rank(b) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line)
  );
  const refusedByReason = {};
  for (const f of raw.filter((x) => x.refused)) {
    refusedByReason[f.reason] = (refusedByReason[f.reason] ?? 0) + 1;
  }
  return {
    tool: "useless-test-pruner",
    root,
    scope: opts.scopes.length === 0 ? "." : opts.scopes.map((s) => toRel(root, s)).join(", "),
    generated_at: new Date().toISOString(),
    own_packages: own.names,
    own_aliases: own.aliases,
    counts: {
      test_files: scanned.length,
      candidates: raw.length,
      refused: raw.filter((f) => f.refused).length,
      reported: raw.filter((f) => !f.refused).length,
      refused_by_reason: refusedByReason,
    },
    skipped_files: skipped,
    findings: sorted,
  };
}

function summary(doc) {
  const lines = [
    `useless-test-pruner: ${doc.counts.test_files} test files, ${doc.counts.candidates} candidates, ${doc.counts.refused} refused, ${doc.counts.reported} reported`,
  ];
  for (const f of doc.findings.filter((x) => !x.refused)) {
    lines.push(`${f.severity} [${f.stage}] ${f.file}:${f.line}  ${f.signal}`);
    lines.push(`    proposal: ${f.proposal}`);
  }
  for (const [reason, count] of Object.entries(doc.counts.refused_by_reason)) {
    lines.push(`refused ${count}: ${reason}`);
  }
  for (const s of doc.skipped_files) {
    lines.push(`skipped ${s.file}: ${s.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = findRoot(opts.root);
  const ts = loadTypeScript(root);
  const doc = scan(ts, root, opts);
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  if (opts.out === null) {
    process.stdout.write(json);
  } else {
    writeFileSync(opts.out, json);
    process.stdout.write(summary(doc));
  }
  return doc.counts.reported > 0 ? 1 : 0;
}

// An uncaught throw would exit 1, which means "findings reported".
try {
  process.exitCode = main();
} catch (error) {
  fail(error.stack ?? String(error));
}
