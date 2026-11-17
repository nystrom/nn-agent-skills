#!/usr/bin/env node
//
// Dead code scan for JavaScript and TypeScript repositories.
//
// Finds exported symbols whose name occurs nowhere else in the repository, and
// named re-exports in a nested barrel that only the barrel and its source file
// name. Each candidate gets a visibility verdict (is it published, is it named
// in another repository) before it is reported. See ../references/checks.md.
//
// usage: scan.mjs [options]   (--help lists them)
//
// Exit codes: 0 nothing to report, 1 at least one reportable finding,
// 2 could not run.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";

const usage = `usage: scan.mjs [options]

Run from inside the git repository to scan.

Options:
  --scope <path>        Restrict the declaration scan to this subtree.
                        Repeatable. The reference index always covers the
                        whole repository.
  --out <file>          Write the findings JSON here instead of stdout.
  --keep <name>         Never report this symbol. Repeatable.
  --no-external         Skip the cross-repository search. Use only when the
                        repository has no consumers elsewhere.
  --org <owner>         GitHub owner to search. Default: owner of the origin
                        remote.
  --max-external <n>    Search at most n distinct symbols (default 40).
  --pace-ms <ms>        Wait between searches (default 6500).
  --retry-ms <ms>       Wait before retrying a failed search (default 30000).
  -h, --help            This text.

The findings JSON goes to stdout (or --out); a short summary goes to stderr.
Exit codes: 0 nothing to report, 1 reportable findings, 2 could not run.
`;

const GH = process.env.DEAD_CODE_SCAN_GH ?? "gh";
const SOURCE_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
// Wider than SOURCE_EXT: a template, config or doc that names a symbol is a
// reference, and an extra reference can only push a candidate toward refusal.
const REFERENCE_EXT = new Set([
  ...SOURCE_EXT,
  ".json", ".md", ".mdx", ".yml", ".yaml", ".html", ".vue", ".svelte", ".hbs",
  ".toml", ".txt", ".graphql", ".proto", ".sh",
]);
const OUTPUT_DIRS = new Set(["dist", "lib", "build", "out", "esm", "cjs", "types"]);
const GENERATED_SEGMENTS = new Set([
  "node_modules", "dist", "build", "out", "coverage", ".next",
]);
const TEST_SEGMENTS = new Set([
  "test", "tests", "__tests__", "__mocks__", "fixtures", "samples", "examples", "e2e",
]);
const DOC_NAMES = new Set(["design.md", "architecture.md", "readme.md"]);
// Generated bundles are not hand-written declarations, and parsing them is slow.
const MAX_DECLARATION_BYTES = 2 * 1024 * 1024;

function fail(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

function sleep(ms) {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    encoding: "utf8",
    cwd,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseArgs(argv) {
  const options = {
    scopes: [],
    keep: new Set(),
    out: undefined,
    external: true,
    org: undefined,
    maxExternal: 40,
    paceMs: 6500,
    retryMs: 30000,
  };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith("-") && v !== "-")) {
      fail(`${flag} needs a value`);
    }
    return v;
  };
  const integer = (i, flag) => {
    const n = Number(value(i, flag));
    if (!Number.isInteger(n) || n < 0) {
      fail(`${flag} needs a non-negative integer`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--scope":
        options.scopes.push(value(i, "--scope"));
        break;
      case "--out":
        options.out = value(i, "--out");
        break;
      case "--keep":
        options.keep.add(value(i, "--keep"));
        break;
      case "--org":
        options.org = value(i, "--org");
        break;
      case "--max-external":
        options.maxExternal = integer(i, "--max-external");
        break;
      case "--pace-ms":
        options.paceMs = integer(i, "--pace-ms");
        break;
      case "--retry-ms":
        options.retryMs = integer(i, "--retry-ms");
        break;
      case "--no-external":
        options.external = false;
        continue;
      case "-h":
      case "--help":
        process.stdout.write(usage);
        process.exit(0);
      default:
        fail(`unknown option ${argv[i]}\n${usage}`);
    }
    i += 1;
  }
  return options;
}

function gitRoot() {
  const result = run("git", ["rev-parse", "--show-toplevel"], process.cwd());
  if (result.status !== 0) {
    fail("not inside a git repository");
  }
  return path.resolve(result.stdout.trim());
}

/**
 * Regular files that are tracked or untracked-and-not-ignored. Ignore rules
 * keep node_modules, build output and nested worktrees out. Symlinks are
 * skipped: their target is either listed itself or outside the repository.
 */
function repoFiles(root) {
  const result = run(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    root
  );
  if (result.status !== 0) {
    fail(`git ls-files failed: ${result.stderr.trim()}`);
  }
  const files = [];
  for (const file of new Set(result.stdout.split("\0"))) {
    if (file === "" || file.split("/").includes("node_modules")) {
      continue;
    }
    let stat;
    try {
      stat = lstatSync(path.join(root, file));
    } catch (error) {
      if (error.code === "ENOENT") {
        continue; // tracked but deleted in the working tree
      }
      // An unreadable path could hide a reference.
      fail(`cannot stat ${file}: ${error.message}`);
    }
    if (stat.isFile()) {
      files.push({ file, size: stat.size });
    }
  }
  return files;
}

/**
 * The TypeScript parser, resolved from the repository being scanned so the
 * scan uses the version the repository builds with.
 */
function loadTypescript(root) {
  try {
    return createRequire(path.join(root, "package.json"))("typescript");
  } catch {
    return fail(
      `cannot resolve the "typescript" package from ${root}. ` +
        "Install the repository's dependencies first."
    );
  }
}

/**
 * Every identifier in the repository: occurrence count and naming files.
 * Comments and strings count as references. That over-counts, which hides a
 * dead symbol instead of proposing a live one for deletion.
 */
function referenceIndex(root, files) {
  const occurrences = new Map();
  const sites = new Map();
  for (const { file } of files) {
    if (!REFERENCE_EXT.has(path.posix.extname(file))) {
      continue;
    }
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      // An unread file would lower counts and could make a live symbol look dead.
      fail(`cannot read ${file}: ${error.message}`);
    }
    for (const match of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
      const name = match[0];
      occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
      let where = sites.get(name);
      if (where === undefined) {
        where = new Set();
        sites.set(name, where);
      }
      where.add(file);
    }
  }
  return { occurrences, sites };
}

function stripExt(file) {
  return file.replace(/\.d\.[cm]?ts$/, "").replace(/\.[^./]+$/, "");
}

function collectStrings(value, out) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
  } else if (value !== null && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, out));
  }
}

/**
 * Entry files of a package as regexes over extensionless repo paths, one entry
 * per manifest value. `explicit` is false for the npm defaults, which need not
 * exist.
 */
function entryMatchers(dir, manifest) {
  const declared = [];
  for (const key of ["main", "module", "types", "typings"]) {
    collectStrings(manifest[key], declared);
  }
  collectStrings(manifest.bin, declared);
  collectStrings(manifest.exports, declared);
  const values = [
    ...["index.js", "src/index"].map((value) => ({ value, explicit: false })),
    ...declared.map((value) => ({ value, explicit: true })),
  ];
  const entries = [];
  for (const { value, explicit } of values) {
    const regexes = [];
    const relative = path.posix.normalize(value.replace(/^\.\//, ""));
    const bases = [relative];
    const [head, ...rest] = relative.split("/");
    // Published output (dist/index.js) is built from src/index.ts.
    if (rest.length > 0 && OUTPUT_DIRS.has(head)) {
      bases.push(["src", ...rest].join("/"));
    }
    for (const base of bases) {
      const full = path.posix.join(dir, stripExt(base));
      const pattern = full
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      regexes.push(new RegExp(`^${pattern}$`));
    }
    entries.push({ value, explicit, regexes });
  }
  return entries;
}

/**
 * Packages by directory. A package with no `exports` map can be deep-imported,
 * so every file in it counts as published.
 */
function loadPackages(root, files) {
  const packages = new Map();
  for (const { file } of files) {
    if (path.posix.basename(file) !== "package.json") {
      continue;
    }
    const dir = path.posix.dirname(file) === "." ? "" : path.posix.dirname(file);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(root, file), "utf8"));
    } catch {
      // Its files must not inherit a parent's verdict.
      process.stderr.write(`scan.mjs: ${file} is not valid JSON; its files get verdict unknown\n`);
      packages.set(dir, {
        dir,
        invalid: true,
        private: false,
        hasExports: false,
        entries: [],
        deps: new Set(),
        unmapped: [],
        unresolved: [],
      });
      continue;
    }
    packages.set(dir, {
      dir,
      name: manifest.name,
      deps: new Set(
        ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((key) =>
          Object.keys(manifest[key] ?? {})
        )
      ),
      private: manifest.private === true,
      hasExports: manifest.exports !== undefined && manifest.exports !== null,
      entries: entryMatchers(dir, manifest),
      // Filled by exposedFiles: manifest paths no source file matches, and
      // re-exports the scan cannot follow. Either leaves the surface unknown.
      unmapped: [],
      unresolved: [],
    });
  }
  return packages;
}

function owningPackage(packages, file) {
  let dir = path.posix.dirname(file);
  for (;;) {
    const normalized = dir === "." ? "" : dir;
    if (packages.has(normalized)) {
      return packages.get(normalized);
    }
    if (normalized === "") {
      return undefined;
    }
    dir = path.posix.dirname(dir);
  }
}

function resolveSpecifier(from, specifier, fileSet) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = path.posix.join(path.posix.dirname(from), specifier);
  const bare = base.replace(/\.[cm]?jsx?$/, "");
  const tries = [base];
  for (const ext of SOURCE_EXT) {
    tries.push(`${base}${ext}`, `${bare}${ext}`, `${base}/index${ext}`);
  }
  return tries.find((candidate) => fileSet.has(candidate));
}

/**
 * Files a module re-exports from, resolved to repo paths, and the specifiers
 * that could not be resolved. A specifier that is not relative is resolved by
 * `isExternal` (a dependency or a Node built-in) or counts as unresolved: it
 * may be a path alias or a package of this repository.
 */
function reexportTargets(ts, source, file, fileSet, isExternal) {
  const imported = new Map();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const specifier = statement.moduleSpecifier.text;
      if (clause?.name !== undefined) {
        imported.set(clause.name.text, specifier);
      }
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        imported.set(bindings.name.text, specifier);
      } else if (bindings !== undefined) {
        bindings.elements.forEach((e) => imported.set(e.name.text, specifier));
      }
    }
  }
  const targets = [];
  const unresolved = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) {
      continue;
    }
    const specifiers = [];
    if (statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
    } else if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        if (imported.has(local)) {
          specifiers.push(imported.get(local));
        }
      }
    }
    for (const specifier of specifiers) {
      const target = resolveSpecifier(file, specifier, fileSet);
      if (target !== undefined) {
        targets.push(target);
      } else if (!isExternal(file, specifier)) {
        unresolved.push(`${specifier} in ${file}`);
      }
    }
  }
  return { targets, unresolved };
}

/**
 * Files a non-private package publishes through its `exports` map: the entry
 * files and everything they re-export, with the file that exposed each.
 */
function exposedFiles(ts, root, files, packages, parse) {
  const fileSet = new Set(files.map((f) => f.file));
  const packageNames = new Set(
    [...packages.values()].map((pkg) => pkg.name).filter((name) => name !== undefined)
  );
  const isExternal = (file, specifier) => {
    if (specifier.startsWith(".")) {
      return false;
    }
    const parts = specifier.replace(/^node:/, "").split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (specifier.startsWith("node:") || (builtinModules.includes(name) && !packageNames.has(name))) {
      return true;
    }
    if (packageNames.has(name)) {
      return false;
    }
    // A dependency of the owning package or of an enclosing one (hoisted).
    for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
      const normalized = dir === "." ? "" : dir;
      if (packages.get(normalized)?.deps.has(name)) {
        return true;
      }
      if (normalized === "") {
        return false;
      }
    }
  };
  const exposed = new Map();
  const queue = [];
  const matched = new Set();
  for (const { file } of files) {
    const pkg = owningPackage(packages, file);
    if (pkg === undefined || pkg.private || !pkg.hasExports) {
      continue;
    }
    for (const entry of pkg.entries) {
      if (entry.regexes.some((m) => m.test(stripExt(file)))) {
        matched.add(entry);
        if (!exposed.has(file)) {
          exposed.set(file, undefined);
          queue.push(file);
        }
      }
    }
  }
  for (const pkg of packages.values()) {
    for (const entry of pkg.entries) {
      if (entry.explicit && !matched.has(entry) && !pkg.private && pkg.hasExports) {
        pkg.unmapped.push(entry.value);
      }
    }
  }
  while (queue.length > 0) {
    const file = queue.shift();
    if (!SOURCE_EXT.includes(path.posix.extname(file))) {
      continue;
    }
    const { targets, unresolved } = reexportTargets(ts, parse(file), file, fileSet, isExternal);
    owningPackage(packages, file)?.unresolved.push(...unresolved);
    for (const target of targets) {
      if (!exposed.has(target)) {
        exposed.set(target, file);
        queue.push(target);
      }
    }
  }
  return exposed;
}

/**
 * Whether a file's exports can be imported from outside this repository,
 * judged from package manifests alone.
 * @returns {{verdict: "internal-only"|"published"|"unknown", reason: string}}
 */
function localVerdict(file, packages, exposed) {
  const pkg = owningPackage(packages, file);
  if (pkg === undefined) {
    return {
      verdict: "unknown",
      reason: "no package.json owns this file, so its published surface cannot be determined",
    };
  }
  const label = pkg.name ?? (pkg.dir === "" ? "the root package" : pkg.dir);
  if (pkg.invalid) {
    return { verdict: "unknown", reason: `${label}/package.json is not valid JSON` };
  }
  if (pkg.private) {
    return { verdict: "internal-only", reason: `${label} is private and not published` };
  }
  if (!pkg.hasExports) {
    return {
      verdict: "published",
      reason: `${label} has no exports map, so any file in it can be imported by path`,
    };
  }
  if (exposed.has(file)) {
    const via = exposed.get(file);
    return {
      verdict: "published",
      reason:
        via === undefined
          ? `${file} is an entry point of ${label}`
          : `${file} is re-exported from ${via}, which ${label} publishes`,
    };
  }
  if (pkg.unmapped.length > 0) {
    return {
      verdict: "unknown",
      reason: `${label} lists ${pkg.unmapped.join(", ")} in its manifest, and no source file maps to it, so the entry points are unknown`,
    };
  }
  if (pkg.unresolved.length > 0) {
    return {
      verdict: "unknown",
      reason: `${label} publishes a re-export the scan cannot follow (${pkg.unresolved[0]}), so the entry points are unknown`,
    };
  }
  return {
    verdict: "internal-only",
    reason: `${label} publishes only its exports map and no entry point reaches ${file}`,
  };
}

function inScope(file, scopes) {
  return scopes.length === 0 || scopes.some((s) => file === s || file.startsWith(`${s}/`));
}

function isDeclarationFile(file, size, scopes) {
  const segments = file.split("/");
  return (
    SOURCE_EXT.includes(path.posix.extname(file)) &&
    !/\.d\.[cm]?ts$/.test(file) &&
    !/\.(test|spec)\.[^/]+$/.test(file) &&
    !/\.min\.[cm]?js$/.test(file) &&
    !segments.slice(0, -1).some((s) => GENERATED_SEGMENTS.has(s) || s === "__tests__") &&
    size <= MAX_DECLARATION_BYTES &&
    inScope(file, scopes)
  );
}

/**
 * Whether evaluating an expression can only produce a value. A call, `new`,
 * spread, computed key, or getter may have an effect that deleting the
 * declaration would remove.
 */
function isPlainValue(ts, node) {
  if (node === undefined) {
    return true;
  }
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    return true;
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return isPlainValue(ts, node.expression);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every((e) => !ts.isSpreadElement(e) && isPlainValue(ts, e));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) => {
      if (ts.isPropertyAssignment(property)) {
        return !ts.isComputedPropertyName(property.name) && isPlainValue(ts, property.initializer);
      }
      return (
        ts.isShorthandPropertyAssignment(property) ||
        (ts.isMethodDeclaration(property) && !ts.isComputedPropertyName(property.name))
      );
    });
  }
  return false;
}

/**
 * A class runs code when defined if it has a decorator, a static member, a
 * computed member name, or a base class that is not a plain reference.
 */
function isPlainClass(ts, node) {
  const decorated = (n) => ts.canHaveDecorators(n) && (ts.getDecorators(n) ?? []).length > 0;
  const plainBase = (node.heritageClauses ?? []).every((clause) =>
    clause.types.every((t) => ts.isIdentifier(t.expression) || ts.isPropertyAccessExpression(t.expression))
  );
  return (
    plainBase &&
    !decorated(node) &&
    node.members.every(
      (member) =>
        !ts.isClassStaticBlockDeclaration(member) &&
        !decorated(member) &&
        !(member.name !== undefined && ts.isComputedPropertyName(member.name)) &&
        !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static)
    )
  );
}

/**
 * The names a top-level statement declares. `pure` is false when removing the
 * statement could remove an effect: a non-plain initializer, an effectful
 * class or enum, or a sibling declarator in a multi-declarator statement.
 */
function declaredNames(ts, node) {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    if (node.name === undefined || !ts.isIdentifier(node.name)) {
      return [];
    }
    const pure = ts.isClassDeclaration(node)
      ? isPlainClass(ts, node)
      : ts.isEnumDeclaration(node)
        ? node.members.every((m) => isPlainValue(ts, m.initializer))
        : true;
    return [{ name: node.name.text, kind: ts.SyntaxKind[node.kind], pure }];
  }
  if (!ts.isVariableStatement(node)) {
    return [];
  }
  const declarations = node.declarationList.declarations;
  const pure = declarations.every((d) => isPlainValue(ts, d.initializer));
  return declarations
    .filter((d) => ts.isIdentifier(d.name))
    .map((d) => ({ name: d.name.text, kind: "VariableDeclaration", pure }));
}

const BARREL = /^index\.[cm]?[jt]sx?$/;

/**
 * `dead-export`: an exported declaration whose name occurs once in the whole
 * repository, which is its own declaration. A name used in its own file (an
 * interface in a union) occurs twice and is not a candidate.
 *
 * `dead-barrel-reexport`: a named re-export in an `index` file where the only
 * two files naming the symbol are the barrel and the module it re-exports from.
 */
function candidates(ts, files, index, scopes, parse, fileSet) {
  const found = [];
  for (const { file, size } of files) {
    if (!isDeclarationFile(file, size, scopes)) {
      continue;
    }
    const source = parse(file);
    const lineOf = (node) =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    for (const statement of source.statements) {
      const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
      const has = (kind) => modifiers.some((m) => m.kind === kind);
      if (has(ts.SyntaxKind.DeclareKeyword)) {
        continue;
      }
      // A default export is imported under any name, so its own name says nothing.
      if (has(ts.SyntaxKind.ExportKeyword) && !has(ts.SyntaxKind.DefaultKeyword)) {
        for (const declared of declaredNames(ts, statement)) {
          if ((index.occurrences.get(declared.name) ?? 0) === 1) {
            found.push({ ...declared, check: "dead-export", file, line: lineOf(statement) });
          }
        }
      }
      if (
        !BARREL.test(path.posix.basename(file)) ||
        !ts.isExportDeclaration(statement) ||
        statement.moduleSpecifier === undefined ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.exportClause === undefined ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        continue;
      }
      const origin = resolveSpecifier(file, statement.moduleSpecifier.text, fileSet);
      for (const element of statement.exportClause.elements) {
        const name = element.name.text;
        const where = index.sites.get(name) ?? new Set();
        if (
          origin !== undefined &&
          element.propertyName === undefined &&
          (index.occurrences.get(name) ?? 0) === 2 &&
          where.size === 2 &&
          where.has(file) &&
          where.has(origin)
        ) {
          found.push({
            name,
            kind: "ExportSpecifier",
            pure: true,
            check: "dead-barrel-reexport",
            file,
            line: lineOf(element),
          });
        }
      }
    }
  }
  return found;
}

/**
 * The refusal that applies to a candidate even when no one outside names it,
 * as `{category, reason}`, or undefined.
 */
function localRefusal(candidate, root, keep) {
  if (keep.has(candidate.name)) {
    return { category: "kept-by-caller", reason: "the caller listed this name with --keep" };
  }
  if (candidate.name.startsWith("_")) {
    return {
      category: "underscore-name",
      reason: "a leading underscore marks a name as intentionally unreferenced",
    };
  }
  if (!candidate.pure) {
    return {
      category: "side-effect-initializer",
      reason: "the declaration is not a plain value (a call, a class with static code, or a statement with another declarator), so removing it may remove a side effect",
    };
  }
  const dir = path.posix.dirname(candidate.file);
  if (dir.split("/").some((s) => TEST_SEGMENTS.has(s))) {
    return {
      category: "test-support",
      reason: "the file sits under a test, fixture, sample or example directory, which another tool or owner prunes",
    };
  }
  for (const doc of DOC_NAMES) {
    for (const name of [doc, doc.toUpperCase().replace(/\.MD$/, ".md")]) {
      if (existsSync(path.join(root, dir, name))) {
        return {
          category: "doc-in-directory",
          reason: `${path.posix.join(dir, name)} documents this directory, and a symbol that completes a documented set is not dead because nothing uses it yet`,
        };
      }
    }
  }
  return undefined;
}

function originRepo(root) {
  const result = run("git", ["remote", "get-url", "origin"], root);
  const match =
    result.status === 0
      ? result.stdout.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
      : null;
  return match === null ? undefined : { owner: match[1], repo: `${match[1]}/${match[2]}` };
}

/** Why the cross-repository search cannot run, or undefined when it can. */
function externalBlocker(root, options) {
  if (run(GH, ["--version"], root).status !== 0) {
    return "gh is not installed";
  }
  if (run(GH, ["auth", "status"], root).status !== 0) {
    return "gh is not authenticated";
  }
  if (options.org === undefined && originRepo(root) === undefined) {
    return "the GitHub owner is unknown; pass --org";
  }
  return undefined;
}

/**
 * Other repositories naming a symbol, by `gh search code`. A failed search is
 * `unknown`, never `none`.
 */
function searchExternal(root, name, options, self) {
  const owner = options.org ?? originRepo(root).owner;
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      sleep(options.retryMs);
    }
    const result = run(
      GH,
      ["search", "code", name, "--owner", owner, "--json", "repository,path", "--limit", "100"],
      root
    );
    if (result.status === 0) {
      try {
        const rows = JSON.parse(result.stdout);
        const hits = rows
          .map((row) => ({ repo: row.repository?.nameWithOwner ?? "?", path: row.path }))
          .filter((hit) => hit.repo !== self);
        const capped = rows.length >= 100;
        // A full page of rows from this repository can hide other repositories.
        const status = hits.length > 0 ? "hits" : capped ? "unknown" : "none";
        return { status, hits, capped, error: "the search hit its 100-result cap with no other repository visible" };
      } catch {
        lastError = "gh returned output that is not JSON";
        continue;
      }
    }
    lastError = result.stderr.trim().split("\n")[0] || `gh exited ${result.status}`;
  }
  return { status: "unknown", hits: [], capped: false, error: lastError };
}

/**
 * Verdict per distinct candidate name that the manifests leave internal-only.
 * A published candidate is refused on that ground and needs no search.
 */
function externalVerdicts(root, names, options) {
  const verdicts = new Map();
  if (names.length === 0) {
    return verdicts;
  }
  if (!options.external) {
    for (const name of names) {
      verdicts.set(name, { verdict: "internal-only", note: "cross-repository search skipped by --no-external" });
    }
    return verdicts;
  }
  const blocker = externalBlocker(root, options);
  const self = originRepo(root)?.repo;
  const owner = options.org ?? originRepo(root)?.owner;
  let searched = 0;
  for (const name of names) {
    if (blocker !== undefined) {
      verdicts.set(name, { verdict: "unknown", note: `cross-repository search unavailable: ${blocker}` });
      continue;
    }
    if (searched >= options.maxExternal) {
      verdicts.set(name, {
        verdict: "unknown",
        note: `search limit of ${options.maxExternal} symbols reached; rerun with a larger --max-external`,
      });
      continue;
    }
    if (searched > 0) {
      sleep(options.paceMs);
    }
    searched += 1;
    const answer = searchExternal(root, name, options, self);
    if (answer.status === "unknown") {
      verdicts.set(name, { verdict: "unknown", note: `cross-repository search failed: ${answer.error}` });
    } else if (answer.status === "hits") {
      verdicts.set(name, {
        verdict: "exported-with-hits",
        hits: answer.hits,
        note: answer.capped ? "the search hit its 100-result cap" : undefined,
      });
    } else {
      verdicts.set(name, { verdict: "internal-only", note: `gh search code found no repository of ${owner} other than this one naming it` });
    }
  }
  return verdicts;
}

function evidenceFor(candidate, local, external, index) {
  const parts = [`verdict: ${external?.verdict ?? local.verdict}`, local.reason];
  parts.push(`files naming it in this repository: ${[...(index.sites.get(candidate.name) ?? [])].join(", ")}`);
  if (external?.note !== undefined) {
    parts.push(external.note);
  }
  if (external?.hits?.length > 0) {
    parts.push(`other repositories: ${external.hits.map((h) => `${h.repo}:${h.path}`).join(", ")}`);
  }
  return parts.join("; ");
}

function buildFindings(found, localVerdicts, externals, root, options, index) {
  const refused = [];
  const reported = [];
  for (const candidate of found) {
    const local = localVerdicts.get(candidate.file);
    const external = local.verdict === "internal-only" ? externals.get(candidate.name) : undefined;
    const verdict = external?.verdict ?? local.verdict;
    const base = { candidate, verdict, evidence: evidenceFor(candidate, local, external, index) };
    if (verdict !== "internal-only") {
      refused.push({ ...base, category: verdict, reason: `the visibility check does not clear this symbol: ${verdict}` });
      continue;
    }
    const refusal = localRefusal(candidate, root, options.keep);
    if (refusal === undefined) {
      reported.push(base);
    } else {
      refused.push({ ...base, ...refusal });
    }
  }
  const findings = [];
  for (const { candidate, verdict, evidence } of reported) {
    const exportCheck = candidate.check === "dead-export";
    findings.push({
      id: `dc-${findings.length + 1}`,
      severity: exportCheck ? "low" : "nit",
      check: candidate.check,
      file: candidate.file,
      line: candidate.line,
      symbol: candidate.name,
      verdict,
      signal: exportCheck
        ? `this ${candidate.kind} is exported and its name occurs once in the repository`
        : "this barrel re-exports a name that only it and the declaring file use",
      evidence,
      proposal: exportCheck
        ? "Delete the declaration and its comments, then run the type check and tests."
        : "Delete the re-export from the barrel and leave the declaration.",
      refused: false,
    });
  }
  for (const { candidate, verdict, evidence, category, reason } of refused) {
    findings.push({
      id: `dc-${findings.length + 1}`,
      severity: "question",
      check: candidate.check,
      file: candidate.file,
      line: candidate.line,
      symbol: candidate.name,
      verdict,
      signal: "candidate refused before any edit",
      evidence,
      proposal: "None. Recorded so the refusal is countable.",
      refused: true,
      category,
      reason,
    });
  }
  return { findings, reported: reported.length, refused: refused.length };
}

function summarize(document) {
  const { counts, findings } = document;
  const lines = [
    `dead-code-scan: ${counts.candidates} candidates, ${counts.reported} reported, ${counts.refused} refused`,
  ];
  const shown = findings.filter((f) => !f.refused);
  for (const f of shown.slice(0, 20)) {
    lines.push(`  ${f.severity.padEnd(4)} ${f.file}:${f.line} ${f.symbol} (${f.check})`);
  }
  if (shown.length > 20) {
    lines.push(`  ... ${shown.length - 20} more in the JSON`);
  }
  const byCategory = new Map();
  for (const f of findings.filter((x) => x.refused)) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }
  if (byCategory.size > 0) {
    lines.push(`  refused: ${[...byCategory].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = gitRoot();
  const resolved = options.scopes.map((s) =>
    path.relative(root, path.resolve(process.cwd(), s)).split(path.sep).join("/")
  );
  // The repository root among the scopes means the whole repository.
  const scopes = resolved.includes("") ? [] : resolved;
  for (const scope of scopes) {
    if (scope.startsWith("..")) {
      fail(`--scope ${scope} is outside the repository`);
    }
  }
  const ts = loadTypescript(root);
  const files = repoFiles(root);
  const fileSet = new Set(files.map((f) => f.file));
  const index = referenceIndex(root, files);
  const packages = loadPackages(root, files);

  const cache = new Map();
  const parse = (file) => {
    if (!cache.has(file)) {
      cache.set(
        file,
        ts.createSourceFile(file, readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true)
      );
    }
    return cache.get(file);
  };

  const exposed = exposedFiles(ts, root, files, packages, parse);
  const found = candidates(ts, files, index, scopes, parse, fileSet);
  const localVerdicts = new Map();
  for (const { file } of found) {
    if (!localVerdicts.has(file)) {
      localVerdicts.set(file, localVerdict(file, packages, exposed));
    }
  }
  const searchNames = [
    ...new Set(found.filter((c) => localVerdicts.get(c.file).verdict === "internal-only").map((c) => c.name)),
  ];
  const externals = externalVerdicts(root, searchNames, options);
  const built = buildFindings(found, localVerdicts, externals, root, options, index);

  const document = {
    tool: "dead-code-scan",
    scope: scopes.length === 0 ? "whole repository" : scopes.join(", "),
    generated_at: new Date().toISOString(),
    counts: { candidates: found.length, refused: built.refused, reported: built.reported },
    findings: built.findings,
  };
  const json = JSON.stringify(document, null, 2) + "\n";
  if (options.out === undefined) {
    process.stdout.write(json);
  } else {
    writeFileSync(options.out, json);
  }
  process.stderr.write(summarize(document));
  // Refusals alone exit 0: they ask for no action. `exitCode` rather than
  // `exit` so a piped stdout write is not truncated.
  process.exitCode = built.reported > 0 ? 1 : 0;
}

try {
  main();
} catch (error) {
  // Node would exit 1 on an uncaught error, which means "findings".
  fail(error.message);
}
