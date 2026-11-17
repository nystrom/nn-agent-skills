#!/usr/bin/env node
//
// Finds functions whose bodies are the same text once comments and whitespace
// are removed, groups them, and reports each group with the evidence a merge
// needs. It never edits files.
//
// The comparison is exact. A similarity threshold also reports pairs that only
// resemble each other because they solve similar problems, and a merge
// proposal against those is a bug report against correct code. The price is
// that renaming one local variable hides a pair.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

const USAGE = `usage: scan.mjs [options]

Options:
  --root <dir>            Repository root. Default: git top level of the
                          current directory, else the current directory.
  --scope <path>          Keep groups with a member under this path (relative
                          to the root). A group that straddles the scope
                          boundary is kept. Repeatable.
  --min-statements <n>    Smallest function body to compare. Default 2.
  --max-file-bytes <n>    Skip files larger than this. Default 1048576.
  --gh-owner <org>        Also search this GitHub owner for callers of exported
                          names with \`gh search code\`.
  --out <file>            Write the findings JSON here and print a ranked
                          summary. Without it, print the JSON.
  -h, --help              This text.

Exit codes: 0 no groups found, 1 groups found, 2 the scan could not run.
`;

const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".claude",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  ".next",
  ".turbo",
]);
const ASI_SENSITIVE = new Set(["return", "throw", "break", "continue", "yield"]);
const GENERATED_MARKER = /@generated|DO NOT EDIT|Code generated/i;
// A comment that says the copies are on purpose is a refusal, because the
// author already decided the question this tool would reopen.
const DELIBERATE_MARKER =
  /\b(?:intentional(?:ly)?|deliberate(?:ly)?)\b|keep in sync|do not (?:merge|unify|dedupe|deduplicate)|duplicated on purpose/i;
const DOC_NAMES = new Set([
  "ARCHITECTURE.md",
  "DESIGN.md",
  "LAYERING.md",
  "LAYERS.md",
  "CONTRIBUTING.md",
]);
const LAYERING_CONFIG =
  /boundaries|no-restricted-imports|no-restricted-paths|dependency-cruiser|import\/no-/i;

function die(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    root: undefined,
    scopes: [],
    minStatements: 2,
    maxFileBytes: 1024 * 1024,
    ghOwner: undefined,
    out: undefined,
  };
  const needValue = (i, flag) => {
    if (argv[i + 1] === undefined) {
      die(`${flag} needs a value\n${USAGE}`);
    }
    return argv[i + 1];
  };
  const needNumber = (i, flag) => {
    const n = Number(needValue(i, flag));
    if (!Number.isInteger(n) || n < 1) {
      die(`${flag} needs a positive integer`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--root":
        opts.root = resolve(needValue(i, "--root"));
        i += 1;
        break;
      case "--scope":
        opts.scopes.push(needValue(i, "--scope"));
        i += 1;
        break;
      case "--min-statements":
        opts.minStatements = needNumber(i, "--min-statements");
        i += 1;
        break;
      case "--max-file-bytes":
        opts.maxFileBytes = needNumber(i, "--max-file-bytes");
        i += 1;
        break;
      case "--gh-owner":
        opts.ghOwner = needValue(i, "--gh-owner");
        i += 1;
        break;
      case "--out":
        opts.out = resolve(needValue(i, "--out"));
        i += 1;
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
      default:
        die(`unexpected argument ${argv[i]}\n${USAGE}`);
    }
  }
  return opts;
}

function gitOutput(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function findRoot(explicit) {
  if (explicit !== undefined) {
    return explicit;
  }
  try {
    return gitOutput(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return process.cwd();
  }
}

/** The `typescript` package of the target repository, or exit 2. */
function loadTypescript(root) {
  for (const base of [root, process.cwd()]) {
    try {
      return createRequire(join(base, "package.json"))("typescript");
    } catch {
      // try the next base
    }
  }
  return die(
    "cannot resolve the `typescript` package from the repository root or the current directory; install it in the target repository and run again"
  );
}

function walk(root, dir, files) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    // Symlinks are skipped so a link cannot make a file appear twice or point
    // outside the root.
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      SKIP_DIRS.has(entry.name) || walk(root, rel, files);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
}

/** Every non-ignored file under the root, relative, sorted. */
function listFiles(root) {
  let files;
  try {
    files = gitOutput(root, ["ls-files", "-co", "--exclude-standard", "-z"])
      .split("\0")
      .filter((f) => f.length > 0)
      .filter((f) => {
        try {
          return lstatSync(join(root, f)).isFile();
        } catch {
          return false;
        }
      })
      .filter((f) => !f.split("/").some((part) => SKIP_DIRS.has(part)));
  } catch {
    files = [];
    walk(root, "", files);
  }
  return files.sort();
}

function readHead(path, bytes) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const n = readSync(fd, buffer, 0, bytes, 0);
    return buffer.toString("utf8", 0, n);
  } finally {
    closeSync(fd);
  }
}

/**
 * Leaf tokens of a node in source order. Comments and whitespace are trivia, so
 * they are absent; string, template, and regex literals keep their full text.
 */
function leaves(ts, node, sf, out) {
  if (
    node.kind >= ts.SyntaxKind.FirstJSDocNode &&
    node.kind <= ts.SyntaxKind.LastJSDocNode
  ) {
    return out;
  }
  const children = node.getChildren(sf);
  if (children.length === 0) {
    if (node.kind !== ts.SyntaxKind.EndOfFileToken) {
      const start = node.getStart(sf);
      const trivia = sf.text.slice(node.pos, start);
      const previous = out.length > 0 ? out[out.length - 1].text : "";
      // A line break changes the meaning after these tokens (automatic
      // semicolon insertion), so it is kept as a token there and only there.
      const breaks =
        /[\n\r\u2028\u2029]/.test(trivia) &&
        (ASI_SENSITIVE.has(previous) || node.getText(sf) === "++" || node.getText(sf) === "--");
      out.push({ start, text: node.getText(sf), trivia, breaks });
    }
  } else {
    for (const child of children) {
      leaves(ts, child, sf, out);
    }
  }
  return out;
}

/**
 * Every named function with a block body: declarations, methods, and arrow or
 * function expressions bound to a variable. Nested ones are included because
 * duplicated closures are common inside constructors and factories.
 */
function unitsOf(ts, root, rel, opts) {
  const abs = join(root, rel);
  const stat = lstatSync(abs);
  if (stat.size > opts.maxFileBytes) {
    return { units: [], skipped: `${rel}: larger than ${opts.maxFileBytes} bytes` };
  }
  if (GENERATED_MARKER.test(readHead(abs, 512))) {
    return { units: [], skipped: undefined };
  }
  const source = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
  if (sf.parseDiagnostics?.length > 0) {
    return { units: [], skipped: `${rel}: parse errors, not compared` };
  }
  const found = [];

  // Names exported by `export { f }` or `export default f`. A file that
  // assigns to CommonJS exports counts every function as exported, because the
  // assigned names are not tracked.
  const listed = new Map();
  const commonjs = /\b(?:module\.exports|exports(?:\.[A-Za-z_$]|\[))/.test(source);
  for (const statement of sf.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        listed.set(local, [...(listed.get(local) ?? []), element.name.text]);
      }
    } else if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression)
    ) {
      listed.set(statement.expression.text, listed.get(statement.expression.text) ?? []);
    }
  }
  const isExported = (node, name) =>
    commonjs ||
    listed.has(name) ||
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
  const render = (list) =>
    list.map((t) => (t.breaks ? "\n" : "") + t.text).join(" ");

  const visit = (node) => {
    let name;
    let body;
    let exported = false;
    if (ts.isFunctionDeclaration(node) && node.body && node.name) {
      name = node.name.text;
      body = node.body;
      exported = isExported(node, name);
    } else if (ts.isMethodDeclaration(node) && node.body && node.name) {
      name = node.name.getText(sf);
      body = node.body;
      exported =
        !ts.isPrivateIdentifier(node.name) &&
        // A method of an object literal is treated as exported, since the
        // object may be exported or passed out.
        (!ts.isClassLike(node.parent) ||
        (commonjs ||
          (node.parent.name !== undefined &&
            listed.has(node.parent.name.text)) ||
          (ts.getCombinedModifierFlags(node.parent) &
            ts.ModifierFlags.Export) !==
            0)) &&
        (ts.getCombinedModifierFlags(node) &
          (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) ===
          0;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      ts.isBlock(node.initializer.body)
    ) {
      name = node.name.text;
      body = node.initializer.body;
      exported = isExported(node, name);
    }
    if (body !== undefined && body.statements.length >= opts.minStatements) {
      const start = node.getStart(sf);
      const tokens = leaves(ts, node, sf, []);
      const bodyStart = body.getStart(sf);
      const signature = render(tokens.filter((t) => t.start < bodyStart));
      found.push({
        file: rel,
        line: sf.getLineAndCharacterOfPosition(start).line + 1,
        name,
        exported,
        aliases: listed.get(name) ?? [],
        statements: body.statements.length,
        start,
        end: node.getEnd(),
        signature,
        body: render(
          tokens.filter((t) => t.start >= bodyStart && t.start < body.getEnd())
        ),
        // Only comments count, so a string literal cannot trigger a refusal.
        deliberate: tokens.some(
          (t) => t.start < body.getEnd() && DELIBERATE_MARKER.test(t.trivia)
        ),
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return { units: found, skipped: undefined };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Nearest `package.json` at or above a file, up to the root. */
function makePackageResolver(root) {
  const cache = new Map();
  const packageOf = (file) => {
    let dir = dirname(file);
    for (;;) {
      if (!cache.has(dir)) {
        const manifest = join(root, dir, "package.json");
        const json = existsSync(manifest) ? readJson(manifest) : undefined;
        const deps = new Set([
          ...Object.keys(json?.dependencies ?? {}),
          ...Object.keys(json?.peerDependencies ?? {}),
        ]);
        const devDeps = new Set(Object.keys(json?.devDependencies ?? {}));
        cache.set(
          dir,
          json === undefined
            ? null
            : {
                dir,
                name: json.name ?? (dir === "." ? "(root)" : dir),
                deps,
                devDeps,
              }
        );
      }
      if (cache.get(dir) !== null) {
        return cache.get(dir);
      }
      if (dir === ".") {
        return { dir: ".", name: "(no package.json)", deps: new Set(), devDeps: new Set() };
      }
      dir = dirname(dir);
    }
  };
  return packageOf;
}

/**
 * Where a shared function could live. Inside one package it always can.
 * Across packages the host has to be one the others already depend on, since a
 * new package edge is a different decision from removing a duplicate. A
 * devDependency counts only when every member is a test file, because
 * production code cannot import a dev-only package at run time.
 */
function sharedHome(members, packageOf) {
  const pkgs = new Map();
  for (const member of members) {
    const pkg = packageOf(member.file);
    pkgs.set(pkg.dir, pkg);
  }
  const entries = [...pkgs.values()];
  if (entries.length === 1) {
    return { ok: true, host: entries[0].name, why: `one package, ${entries[0].name}` };
  }
  const testsOnly = members.every((m) => isTestFile(m.file));
  const depends = (other, candidate) =>
    other.deps.has(candidate.name) ||
    (testsOnly && other.devDeps.has(candidate.name));
  const host = entries.find((candidate) =>
    entries.every((other) => other === candidate || depends(other, candidate))
  );
  if (host === undefined) {
    return {
      ok: false,
      why: `${entries.map((p) => p.name).join(" and ")} declare no dependency on each other`,
    };
  }
  return {
    ok: true,
    host: host.name,
    why: `${host.name}, which the others already depend on`,
  };
}

/** Layering configs and docs found at runtime, for the reviewer to read. */
function discoverConventions(root, files) {
  const base = (f) => f.slice(f.lastIndexOf("/") + 1);
  const eslint = files.filter((f) =>
    /^(?:\.eslintrc(?:\..*)?|eslint\.config\.[cm]?[jt]s)$/.test(base(f))
  );
  const layeringConfigs = [
    ...eslint.filter((f) => {
      try {
        return LAYERING_CONFIG.test(readFileSync(join(root, f), "utf8"));
      } catch {
        return false;
      }
    }),
    ...files.filter(
      (f) =>
        /^(?:layers?\.(?:[cm]?js|json|ts)|\.dependency-cruiser\.[cm]?js)$/.test(
          base(f)
        )
    ),
  ];
  const rootManifest = readJson(join(root, "package.json"));
  return {
    workspaces: rootManifest?.workspaces ?? null,
    tsconfigs: files.filter((f) => /^tsconfig.*\.json$/.test(base(f))).slice(0, 50),
    eslintConfigs: eslint,
    layeringConfigs,
  };
}

function docsNear(files, member) {
  const fileSet = new Set(files);
  const found = [];
  let dir = dirname(member.file);
  for (;;) {
    for (const name of DOC_NAMES) {
      const candidate = dir === "." ? name : `${dir}/${name}`;
      fileSet.has(candidate) && found.push(candidate);
    }
    if (dir === ".") {
      return found;
    }
    dir = dirname(dir);
  }
}

/**
 * Callers of the exported names in a group. In-repo search is
 * `git grep -w --untracked`, which matches by spelling only, so a same-named
 * symbol elsewhere gives hits that are not callers. In a member's own file, a
 * hit counts only when the name occurs more often than the file declares it.
 * External search needs `--gh-owner` and an authenticated `gh`. Anything that
 * could not be searched reports `unknown`.
 */
function consumers(root, group, opts) {
  const exportedNames = [
    ...new Set(
      group.filter((m) => m.exported).flatMap((m) => [m.name, ...m.aliases])
    ),
  ];
  if (exportedNames.length === 0) {
    return { verdict: "internal-only", detail: "no member is exported" };
  }
  const details = [];
  let unknown = false;
  let hits = false;
  for (const name of exportedNames) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      details.push(`${name}: not an identifier, not searched`);
      unknown = true;
      continue;
    }
    try {
      const out = gitOutput(root, [
        "grep",
        "-ow",
        "-F",
        "--untracked",
        "-e",
        name,
      ]);
      const counts = new Map();
      for (const line of out.split("\n").filter((l) => l.length > 0)) {
        const file = line.slice(0, line.indexOf(":"));
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
      const others = [...counts]
        .filter(
          ([file, count]) =>
            count >
            group.filter((m) => m.file === file && m.name === name).length
        )
        .map(([file]) => file);
      others.length > 0 && (hits = true);
      details.push(
        `${name}: ${others.length} file(s) in the repo spell it beyond the declarations${others.length > 0 ? ` (${others.slice(0, 5).join(", ")})` : ""}`
      );
    } catch (error) {
      if (error.status === 1) {
        details.push(`${name}: no file in the repo spells it`);
      } else {
        details.push(`${name}: repo search failed`);
        unknown = true;
      }
    }
    if (opts.ghOwner === undefined) {
      details.push(`${name}: external repos not searched (no --gh-owner)`);
      unknown = true;
      continue;
    }
    try {
      const out = execFileSync(
        "gh",
        [
          "search",
          "code",
          name,
          "--owner",
          opts.ghOwner,
          "--limit",
          "5",
          "--json",
          "path",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 }
      );
      const results = JSON.parse(out);
      results.length > 0 && (hits = true);
      details.push(
        `${name}: gh search in ${opts.ghOwner} found ${results.length} hit(s)`
      );
    } catch {
      details.push(`${name}: gh search unavailable or failed`);
      unknown = true;
    }
  }
  return {
    verdict: unknown
      ? "unknown"
      : hits
        ? "exported-with-hits"
        : "exported-no-hits",
    detail: details.join("; "),
  };
}

/** Whether every member of `group` nests inside a member of `outer`. */
function nestedIn(group, outer) {
  return group.every((member) =>
    outer.some(
      (o) =>
        o.file === member.file && o.start <= member.start && o.end >= member.end
    )
  );
}

const isTestFile = (file) =>
  /(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests?)\//.test(
    file
  );

const compact = (items) => [...new Set(items)].sort();

const isDeclarationFile = (file) => /\.d\.[cm]?ts$/.test(file);

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = findRoot(opts.root);
  try {
    statSync(root).isDirectory() || die(`root is not a directory: ${root}`);
  } catch {
    die(`root does not exist: ${root}`);
  }
  const ts = loadTypescript(root);
  const files = listFiles(root);
  const sources = files.filter(
    (f) => SOURCE_EXT.test(f) && !isDeclarationFile(f)
  );
  const skipped = [];
  const all = [];
  for (const rel of sources) {
    try {
      const result = unitsOf(ts, root, rel, opts);
      result.skipped !== undefined && skipped.push(result.skipped);
      all.push(...result.units);
    } catch (error) {
      skipped.push(`${rel}: ${error.message}`);
    }
  }

  const byBody = new Map();
  for (const unit of all) {
    const group = byBody.get(unit.body);
    group === undefined ? byBody.set(unit.body, [unit]) : group.push(unit);
  }
  const groups = [...byBody.values()]
    .filter((group) => group.length > 1)
    .map((group) =>
      [...group].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    )
    .sort((a, b) => a[0].file.localeCompare(b[0].file) || a[0].line - b[0].line);

  // Scopes are resolved against the root so `.`, `./x`, and absolute paths
  // work. A scope outside the root matches nothing.
  const scopes = opts.scopes.map((s) => relative(root, resolve(root, s)));
  const inScope = (path) =>
    scopes.length === 0 ||
    scopes.some((s) => s === "" || path === s || path.startsWith(`${s}/`));
  const packageOf = makePackageResolver(root);
  const fileKey = (group) => compact(group.map((m) => m.file)).join("|");
  const idOf = (index) =>
    `dup-${index + 1}-${compact(groups[index].map((m) => m.name)).join("-").replace(/[^A-Za-z0-9._-]/g, "")}`;

  // Refusals that need only the group itself.
  const homes = groups.map((group) => sharedHome(group, packageOf));
  const own = groups.map((group, index) => {
    const names = compact(group.map((m) => m.name));
    const sameFile = new Set(group.map((m) => m.file)).size === 1;
    const signaturesDiffer = new Set(group.map((m) => m.signature)).size > 1;
    if (group.some((m) => m.deliberate)) {
      return "a comment on a member says the duplication is intentional or must stay in sync; read it before proposing a merge";
    }
    if (!homes[index].ok) {
      return `no home for a shared function: ${homes[index].why}`;
    }
    if (sameFile && signaturesDiffer && names.length === group.length) {
      return "same file, different signatures: the bodies coincide but each function looks like the entry point for one type in a dispatch family, and a merge would replace per-type signatures with a type parameter";
    }
    return null;
  });

  // A group nested in one larger group that is itself actionable is covered by
  // that group. A refused outer group covers nothing.
  const nesting = groups.map((group, index) => {
    if (own[index] !== null) {
      return null;
    }
    const outerIndex = groups.findIndex(
      (other, j) =>
        j !== index &&
        own[j] === null &&
        other[0].body.length > group[0].body.length &&
        nestedIn(group, other)
    );
    return outerIndex === -1
      ? null
      : `every member nests inside a member of ${idOf(outerIndex)}, so this is that duplication counted twice and merging the outer group removes it`;
  });

  // Groups over the same files are one review decision. The first group over a
  // set of files that no rule above refused is the one reported.
  const representatives = new Map();
  for (const [index, group] of groups.entries()) {
    if (own[index] !== null || nesting[index] !== null) {
      continue;
    }
    const key = fileKey(group);
    const entry = representatives.get(key);
    entry === undefined
      ? representatives.set(key, { index, folded: 0 })
      : (entry.folded += 1);
  }

  const findings = [];
  for (const [index, group] of groups.entries()) {
    if (!group.some((m) => inScope(m.file))) {
      continue;
    }
    const names = compact(group.map((m) => m.name));
    const home = homes[index];
    const representative = representatives.get(fileKey(group));
    const statements = group[0].statements;
    const where = group.map((m) => `${m.file}:${m.line} ${m.name}`).join(", ");
    const docs = compact(group.flatMap((m) => docsNear(files, m)));
    const allTests = group.every((m) => isTestFile(m.file));
    const mixesTests = !allTests && group.some((m) => isTestFile(m.file));

    let refusal = own[index] ?? nesting[index];
    if (refusal === null && representative.index !== index) {
      refusal = `folded into ${idOf(representative.index)}, which covers the same files and is one review decision with this one`;
    }
    const consumer =
      refusal === null
        ? consumers(root, group, opts)
        : {
            verdict: "not-gathered",
            detail: "group refused before the consumer search",
          };
    if (refusal === null && consumer.verdict === "unknown") {
      refusal = `consumer check is unknown, so removing an exported name is not safe to propose: ${consumer.detail}`;
    }

    const proposal =
      refusal !== null
        ? "none"
        : allTests
          ? `keep one ${names.join(" or ")} in the package's test helpers, with a parameter for whatever each copy closes over; delete the rest`
          : names.length === 1
            ? `keep one ${names[0]} in ${home.host}, and give it a parameter for whatever each copy closes over; delete the rest. Check the layering configs and docs named in the evidence before choosing the file`
            : `keep one of ${names.join(", ")} and call it from the other sites, generalizing the parameter or the type rather than copying the body again`;

    findings.push({
      id: idOf(index),
      file: group[0].file,
      line: group[0].line,
      ...(names.length === 1 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(names[0])
        ? { symbol: names[0] }
        : {}),
      severity:
        refusal !== null
          ? "low"
          : (representative?.folded ?? 0) > 0 ||
              group.length > 2 ||
              statements >= 6
            ? "medium"
            : "low",
      members: group.length,
      signal: `${group.length} functions share one body, ${statements} statements, identical after comments and whitespace are removed: ${where}`,
      evidence: [
        representative?.index === index && representative.folded > 0
          ? `${representative.folded} further group(s) over the same files fold into this one`
          : null,
        `a shared function can live in ${home.ok ? home.why : "no package"}`,
        `consumers: ${consumer.verdict} (${consumer.detail})`,
        mixesTests ? "the group mixes test files and production files" : null,
        docs.length > 0 ? `docs near the members: ${docs.join(", ")}` : null,
      ]
        .filter((e) => e !== null)
        .join(". "),
      proposal,
      refused: refusal !== null,
      ...(refusal !== null ? { reason: refusal } : {}),
    });
  }

  const reported = findings.filter((f) => !f.refused).length;
  const document = {
    tool: "duplicate-function-unifier",
    root,
    scope: scopes.length === 0 ? "whole repository" : opts.scopes.join(", "),
    generated_at: new Date().toISOString(),
    files_scanned: sources.length,
    skipped,
    conventions: discoverConventions(root, files),
    counts: {
      candidates: findings.length,
      refused: findings.length - reported,
      reported,
    },
    findings,
  };

  const json = `${JSON.stringify(document, null, 2)}\n`;
  if (opts.out === undefined) {
    process.stdout.write(json);
  } else {
    try {
      writeFileSync(opts.out, json);
    } catch (error) {
      die(`cannot write ${opts.out}: ${error.message}`);
    }
    const rank = { medium: 0, low: 1 };
    const lines = [
      `duplicate-function-unifier: ${reported} reported, ${document.counts.refused} refused, ${sources.length} source files scanned`,
      ...findings
        .filter((f) => !f.refused)
        .sort(
          (a, b) => rank[a.severity] - rank[b.severity] || b.members - a.members
        )
        .map((f) => `  [${f.severity}] ${f.id} ${f.file}:${f.line}`),
      `findings written to ${opts.out}`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  // exitCode rather than exit() so a large write is not cut off on a pipe.
  process.exitCode = findings.length > 0 ? 1 : 0;
}

main();
