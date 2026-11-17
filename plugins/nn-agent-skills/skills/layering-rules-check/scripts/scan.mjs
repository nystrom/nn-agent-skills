#!/usr/bin/env node
// Checks layering rules that lint and the type checker usually do not enforce.
// Needs only Node 20+ and the files of the repository under scan. See
// ../references/checks.md for each check and the bounds of what it sees.
//
// Exit codes: 0 no reported findings, 1 findings reported, 2 could not run.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `usage: scan.mjs [--root <dir>] [--scope <path>]... [--doc <file>] [--out <file>]

  --root <dir>    Repository root. Default: git top level of the working
                  directory, else the working directory.
  --scope <path>  Restrict findings to this subtree. Repeatable.
  --doc <file>    Dependency-table document, relative to the root. Default:
                  discovered by file name.
  --out <file>    Write the JSON findings here and print a ranked summary.
                  Without it, the JSON goes to standard output.
  -h, --help      This text.
`;

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".claude",
  "target",
]);
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const UNCHECKED_EXT = /\.(?:jsx?|cjs|mjs)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_SPECIFIER = /(?:\.(?:test|spec)(?:\.[cm]?[jt]sx?)?|\/__tests__\/.*)$/;
const TEST_DIR = new Set(["test", "tests", "__tests__", "testing"]);
const BARREL = /^index\.[cm]?[jt]sx?$/;
const DOC_NAME = /^(?:DEPENDENCIES|LAYERS|LAYERING|ARCHITECTURE)\.md$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SEVERITY_ORDER = ["high", "medium", "low", "nit"];

function die(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

function toPosix(path) {
  return path.split(sep).join("/");
}

function parseArgs(argv) {
  const options = { root: undefined, scopes: [], doc: undefined, out: undefined };
  const needValue = (i, flag) => {
    if (argv[i + 1] === undefined) {
      die(`${flag} needs a value\n${USAGE}`);
    }
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--root":
        options.root = resolve(needValue(i, "--root"));
        i += 1;
        break;
      case "--scope":
        options.scopes.push(needValue(i, "--scope"));
        i += 1;
        break;
      case "--doc":
        options.doc = needValue(i, "--doc");
        i += 1;
        break;
      case "--out":
        options.out = resolve(needValue(i, "--out"));
        i += 1;
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        die(`unexpected argument ${argv[i]}\n${USAGE}`);
    }
  }
  return options;
}

function findRoot(explicit) {
  if (explicit !== undefined) {
    return explicit;
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

/** Walks the tree without following symlinks. Returns root-relative POSIX paths. */
function walk(root, skipped) {
  const files = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: dir || ".", reason: `unreadable directory: ${error.code}` });
      return;
    }
    for (const entry of entries) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        IGNORED_DIRS.has(entry.name) || visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  visit("");
  return files.sort();
}

function readText(root, path, skipped) {
  try {
    const info = lstatSync(join(root, path));
    if (info.isSymbolicLink()) {
      skipped.push({ path, reason: "symlink" });
      return undefined;
    }
    const size = info.size;
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: `larger than ${MAX_FILE_BYTES} bytes` });
      return undefined;
    }
    return readFileSync(join(root, path), "utf8");
  } catch (error) {
    skipped.push({ path, reason: `unreadable: ${error.code}` });
    return undefined;
  }
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    text.charCodeAt(i) === 10 && (line += 1);
  }
  return line;
}

/** Blanks comments with spaces so offsets and line numbers stay valid. */
function blankComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^.*$/gm, (line) => {
      // A `//` starts a comment only outside a string, so require an even
      // quote count before it. This keeps "http://x" intact.
      for (let i = line.indexOf("//"); i !== -1; i = line.indexOf("//", i + 1)) {
        if ((line.slice(0, i).match(/["'`]/g) ?? []).length % 2 === 0) {
          return line.slice(0, i) + " ".repeat(line.length - i);
        }
      }
      return line;
    });
}

const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g;

/** Returns [{specifier, line}] for static, dynamic, and CommonJS imports. */
function importsOf(text) {
  const clean = blankComments(text);
  return [...clean.matchAll(IMPORT_RE)].map((m) => ({
    specifier: m[2],
    line: lineOf(clean, m.index),
  }));
}

function isTestFile(path) {
  return TEST_FILE.test(path) || path.split("/").includes("__tests__");
}

function packageNameOf(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return undefined;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function globToRegExp(pattern) {
  const body = pattern
    .replace(/^\.\//, "")
    .replace(/\/$/, "")
    .split("")
    .map((c) => (/[.+^${}()|[\]\\?]/.test(c) ? `\\${c}` : c))
    .join("")
    .replace(/\*\*\//g, "\u0001")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0001/g, "(?:.*/)?")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${body}$`);
}

function workspacePatterns(root, files, skipped) {
  const patterns = [];
  const manifest = files.includes("package.json") ? readJson(root, "package.json", skipped) : undefined;
  const declared = manifest?.workspaces;
  const list = Array.isArray(declared) ? declared : declared?.packages;
  Array.isArray(list) && patterns.push(...list.filter((p) => typeof p === "string"));
  if (files.includes("pnpm-workspace.yaml")) {
    const text = readText(root, "pnpm-workspace.yaml", skipped) ?? "";
    const block = text.split(/^packages:[ \t]*(?:#.*)?$/m)[1] ?? "";
    for (const line of block.split("\n")) {
      if (line.trim() === "" || line.trim().startsWith("#")) {
        continue;
      }
      const m = /^\s*-\s*['"]?([^'"#\s]+)['"]?/.exec(line);
      if (m === null) {
        break;
      }
      patterns.push(m[1]);
    }
  }
  return patterns;
}

function readJson(root, path, skipped) {
  const text = readText(root, path, skipped);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    skipped.push({ path, reason: `invalid JSON: ${error.message}` });
    return undefined;
  }
}

/** Packages are the workspace members when declared, else every package.json. */
function discoverPackages(root, files, skipped) {
  const patterns = workspacePatterns(root, files, skipped);
  const include = patterns.filter((p) => !p.startsWith("!")).map(globToRegExp);
  const exclude = patterns.filter((p) => p.startsWith("!")).map((p) => globToRegExp(p.slice(1)));
  const packages = [];
  for (const file of files.filter((f) => basename(f) === "package.json")) {
    const dir = dirname(file) === "." ? "" : dirname(file);
    if (dir !== "" && include.length > 0) {
      if (!include.some((re) => re.test(dir)) || exclude.some((re) => re.test(dir))) {
        continue;
      }
    }
    const manifest = readJson(root, file, skipped);
    if (manifest === undefined) {
      continue;
    }
    const declared = new Set(
      ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
        (field) => Object.keys(manifest[field] ?? {})
      )
    );
    packages.push({ dir, name: manifest.name, declared, manifestPath: file });
  }
  const members = packages.filter((p) => p.dir !== "");
  // A repo with member packages treats the root manifest as the workspace
  // wrapper, not as a package with its own source.
  return members.length > 0 ? members : packages;
}

function owner(packages, file) {
  let best;
  for (const pkg of packages) {
    const inside = pkg.dir === "" || file.startsWith(`${pkg.dir}/`);
    inside && (best === undefined || pkg.dir.length > best.dir.length) && (best = pkg);
  }
  return best;
}

function finding(check, fields) {
  const where = fields.line === undefined ? fields.file : `${fields.file}:${fields.line}`;
  return { id: `${check}:${where}${fields.idSuffix ?? ""}`, check, refused: false, ...fields };
}

function stripExt(path) {
  return path.replace(/\.(?:d\.)?[cm]?[jt]sx?$/, "");
}

/** A production module imports a test module. */
function testImports(ctx) {
  const findings = [];
  for (const file of ctx.sourceFiles.filter((f) => !isTestFile(f))) {
    for (const { specifier, line } of ctx.imports.get(file)) {
      if (!specifier.startsWith(".") || !TEST_SPECIFIER.test(specifier)) {
        continue;
      }
      const support = file.split("/").some((segment) => TEST_DIR.has(segment));
      findings.push(
        finding("test-import", {
          severity: support ? "low" : "high",
          file,
          line,
          idSuffix: ` ${specifier}`,
          signal: `production module imports test module ${specifier}`,
          evidence:
            "test files are usually excluded from layering rules, so this import reaches whatever the test reaches without a rule in the way",
          proposal: support
            ? "none"
            : "move the shared helper from the test file into a non-test module",
          refused: support,
          ...(support && {
            reason: "the file is under a test directory and acts as test support",
          }),
        })
      );
    }
  }
  return findings;
}

function tsconfigAllowsJs(root, dir, skipped) {
  let current = dir;
  for (;;) {
    const path = current === "" ? "tsconfig.json" : `${current}/tsconfig.json`;
    if (existsSync(join(root, path))) {
      const text = readText(root, path, skipped);
      // An unreadable config is unknown, so the check stays silent.
      return text === undefined
        ? { found: false, allowJs: false }
        : { found: true, allowJs: /"allowJs"\s*:\s*true/.test(text) };
    }
    if (current === "") {
      return { found: false, allowJs: false };
    }
    current = dirname(current) === "." ? "" : dirname(current);
  }
}

/** A non-TypeScript source file in a TypeScript package that tsc does not read. */
function uncheckedSources(ctx) {
  const findings = [];
  const imported = new Set();
  for (const file of ctx.sourceFiles) {
    for (const { specifier } of ctx.imports.get(file)) {
      specifier.startsWith(".") &&
        imported.add(stripExt(posix.join(dirname(file), specifier)));
    }
  }
  for (const file of ctx.sourceFiles) {
    if (!UNCHECKED_EXT.test(file) || isTestFile(file)) {
      continue;
    }
    const pkg = owner(ctx.packages, file);
    if (pkg === undefined || !file.startsWith(`${pkg.dir === "" ? "" : `${pkg.dir}/`}src/`)) {
      continue;
    }
    const config = tsconfigAllowsJs(ctx.root, pkg.dir, ctx.skipped);
    if (!config.found || config.allowJs) {
      continue;
    }
    const isImported = imported.has(stripExt(file));
    findings.push(
      finding("unchecked-source", {
        severity: isImported ? "medium" : "low",
        file,
        signal: `${isImported ? "imported " : ""}non-TypeScript file under src/ that tsc does not read`,
        evidence:
          "the nearest tsconfig.json does not enable allowJs for this extension; lint commonly targets .ts only, so imports inside this file escape both tools",
        proposal: "port it to .ts, or move it out of src/ where nothing imports it",
      })
    );
  }
  return findings;
}

/** A package imports a workspace package that its manifest does not declare. */
function undeclaredPackageDeps(ctx) {
  const workspaceNames = new Set(ctx.packages.map((p) => p.name).filter((n) => n !== undefined));
  const usage = new Map();
  for (const file of ctx.sourceFiles) {
    const pkg = owner(ctx.packages, file);
    if (pkg === undefined) {
      continue;
    }
    const test = isTestFile(file);
    for (const { specifier, line } of ctx.imports.get(file)) {
      const name = packageNameOf(specifier);
      if (name === undefined || !workspaceNames.has(name) || name === pkg.name) {
        continue;
      }
      const key = `${pkg.dir}\u0000${name}\u0000${test}`;
      const entry = usage.get(key) ?? { pkg, name, test, sources: [] };
      entry.sources.push({ file, line });
      usage.set(key, entry);
    }
  }
  const findings = [];
  for (const { pkg, name, test, sources } of usage.values()) {
    const { file, line } = sources[0];
    if (pkg.declared.has(name)) {
      continue;
    }
    // A production import needs a runtime dependency, which covers the test use.
    if (test && usage.has(`${pkg.dir}\u0000${name}\u0000false`)) {
      continue;
    }
    const field = test ? "devDependencies" : "dependencies";
    findings.push(
      finding("undeclared-package-dep", {
        severity: test ? "medium" : "high",
        file: pkg.manifestPath,
        idSuffix: ` ${name} ${test ? "test" : "production"}`,
        signal: `${pkg.dir || "."} imports ${name} from ${test ? "test" : "production"} code (first at ${file}:${line}) and its manifest declares it nowhere`,
        evidence:
          "workspace hoisting makes the import resolve inside the repo; it fails when the package is installed on its own",
        proposal: `add ${name} to ${field} in ${pkg.manifestPath}, or stop importing it`,
        sources: [...sources, ...(test ? [] : (usage.get(`${pkg.dir}\u0000${name}\u0000true`)?.sources ?? []))].map(
          (s) => `${s.file}:${s.line}`
        ),
      })
    );
  }
  return findings;
}

/** A barrel re-exports a module from outside its own directory. */
function foreignBarrelReexports(ctx) {
  const findings = [];
  const re =
    /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*["'](\.\.\/[^"'\n]*)["']/g;
  for (const file of ctx.sourceFiles.filter((f) => BARREL.test(basename(f)))) {
    const clean = blankComments(ctx.texts.get(file));
    for (const m of clean.matchAll(re)) {
      const line = lineOf(clean, m.index);
      findings.push(
        finding("foreign-barrel-reexport", {
          severity: "medium",
          file,
          line,
          signal: `barrel re-exports another directory's module (${m[1]})`,
          evidence:
            "every consumer of the barrel now depends on the other directory, and the barrel misstates which directory owns the symbol",
          proposal:
            "export the symbol from the barrel of the directory that defines it, and import it from there",
        })
      );
    }
  }
  return findings;
}

function cellText(cell) {
  return cell.trim().replace(/^[*_`]+|[*_`]+$/g, "").replace(/\/$/, "");
}

/** Reads rows `| dir | a, b |` from non-test tables whose first cell names a sibling directory. */
function parseDependencyRows(doc, siblingDirs) {
  const claims = new Map();
  let inTestSection = false;
  for (const line of doc.split("\n")) {
    const heading = /^#+\s+(.*)$/.exec(line);
    if (heading !== null) {
      inTestSection = /\btest/i.test(heading[1]);
      continue;
    }
    const cells = /^\s*\|(.*)\|\s*$/.exec(line)?.[1].split("|");
    if (inTestSection || cells === undefined || cells.length < 2) {
      continue;
    }
    const dir = cellText(cells[0]);
    if (!siblingDirs.has(dir)) {
      continue;
    }
    const set = claims.get(dir) ?? new Set();
    cells[1]
      .replace(/_\(none[^)]*\)_/g, "")
      .split(",")
      .map(cellText)
      .filter((entry) => entry.length > 0)
      .forEach((entry) => set.add(entry));
    claims.set(dir, set);
  }
  return claims;
}

/** A dependency table lists fewer cross-directory imports than the code has. */
function dependencyDocDrift(ctx) {
  const candidates = ctx.options.doc
    ? [toPosix(ctx.options.doc)]
    : ctx.files.filter((f) => DOC_NAME.test(basename(f)));
  if (candidates.length === 0) {
    ctx.skippedChecks.push({ check: "dependency-doc-drift", reason: "no dependency document found" });
    return [];
  }
  const findings = [];
  let parsedRows = 0;
  for (const docPath of candidates) {
    const text = readText(ctx.root, docPath, ctx.skipped);
    if (text === undefined) {
      continue;
    }
    const base = dirname(docPath) === "." ? "" : dirname(docPath);
    const prefix = base === "" ? "" : `${base}/`;
    const siblingDirs = new Set(
      ctx.files
        .filter((f) => f.startsWith(prefix) && f.slice(prefix.length).includes("/"))
        .map((f) => f.slice(prefix.length).split("/")[0])
    );
    const claims = parseDependencyRows(text, siblingDirs);
    parsedRows += claims.size;
    for (const [dir, claimed] of claims) {
      const actual = new Map();
      for (const file of ctx.sourceFiles) {
        if (!file.startsWith(`${prefix}${dir}/`) || isTestFile(file)) {
          continue;
        }
        for (const { specifier, line } of ctx.imports.get(file)) {
          if (!specifier.startsWith(".")) {
            continue;
          }
          const resolved = posix.join(dirname(file), specifier);
          if (!resolved.startsWith(prefix)) {
            continue;
          }
          const top = resolved.slice(prefix.length).split("/")[0];
          if (top !== dir && siblingDirs.has(top)) {
            actual.set(top, [...(actual.get(top) ?? []), `${file}:${line}`]);
          }
        }
      }
      const missing = [...actual.keys()].filter((edge) => !claimed.has(edge)).sort();
      missing.length > 0 &&
        findings.push(
          finding("dependency-doc-drift", {
            severity: "low",
            file: docPath,
            idSuffix: ` ${dir}`,
            signal: `the row for ${dir} does not list ${missing.join(", ")}, which its production modules import`,
            evidence:
              "the imports are the fact; a dependency table that omits an edge misleads readers about what is allowed",
            proposal: `update the ${dir} row, or move the import if the edge should not exist`,
            sources: missing.flatMap((edge) => actual.get(edge)),
          })
        );
    }
  }
  parsedRows === 0 &&
    ctx.skippedChecks.push({
      check: "dependency-doc-drift",
      reason: `no table row names a sibling directory in ${candidates.join(", ")}`,
    });
  return findings;
}

const CHECKS = [
  testImports,
  uncheckedSources,
  undeclaredPackageDeps,
  foreignBarrelReexports,
  dependencyDocDrift,
];

function inScope(finding, scopes) {
  return (
    scopes.length === 0 ||
    scopes.some((scope) => {
      const within = (path) => scope === "" || path === scope || path.startsWith(`${scope}/`);
      // A manifest or dependency table finding aggregates imports from other
      // files. It stays when the table or any contributing import is in scope.
      return (
        within(finding.file) ||
        (finding.sources ?? []).some((source) => within(source.replace(/:\d+$/, "")))
      );
    })
  );
}

function rank(a, b) {
  return (
    Number(a.refused) - Number(b.refused) ||
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    a.id.localeCompare(b.id)
  );
}

export function scan(options) {
  const root = findRoot(options.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    die(`root is not a directory: ${root}`);
  }
  const skipped = [];
  const files = walk(root, skipped);
  const packages = discoverPackages(root, files, skipped);
  const sourceFiles = [];
  const texts = new Map();
  const imports = new Map();
  for (const file of files.filter((f) => SOURCE_EXT.test(f))) {
    const text = readText(root, file, skipped);
    if (text === undefined) {
      continue;
    }
    sourceFiles.push(file);
    texts.set(file, text);
    imports.set(file, importsOf(text));
  }
  const scopes = options.scopes.map((scope) => {
    const rel = toPosix(relative(root, resolve(root, scope))).replace(/\/$/, "");
    (rel === ".." || rel.startsWith("../")) && die(`scope is outside the root: ${scope}`);
    return rel;
  });
  const ctx = {
    root,
    options,
    files,
    packages,
    sourceFiles,
    texts,
    imports,
    skipped,
    skippedChecks: [],
  };
  const all = CHECKS.flatMap((check) => check(ctx))
    .filter((f) => inScope(f, scopes))
    .sort(rank);
  return {
    tool: "layering-rules-check",
    root,
    scope: scopes.length === 0 ? "." : scopes.join(", "),
    generated_at: new Date().toISOString(),
    counts: {
      candidates: all.length,
      refused: all.filter((f) => f.refused).length,
      reported: all.filter((f) => !f.refused).length,
    },
    skipped_checks: ctx.skippedChecks,
    skipped_files: skipped,
    findings: all,
  };
}

function summary(report, limit = 20) {
  const lines = [
    `layering-rules-check: ${report.counts.reported} reported, ${report.counts.refused} refused`,
  ];
  for (const f of report.findings.filter((x) => !x.refused).slice(0, limit)) {
    lines.push(`  [${f.severity}] ${f.check} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.signal}`);
  }
  report.counts.reported > limit && lines.push(`  ... ${report.counts.reported - limit} more in the JSON`);
  for (const s of report.skipped_checks) {
    lines.push(`  skipped ${s.check}: ${s.reason}`);
  }
  report.skipped_files.length > 0 &&
    lines.push(`  ${report.skipped_files.length} file(s) skipped; see skipped_files in the JSON`);
  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = scan(options);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.out === undefined) {
      process.stdout.write(json);
    } else {
      writeFileSync(options.out, json);
      process.stdout.write(summary(report));
    }
    process.exitCode = report.counts.reported > 0 ? 1 : 0;
  } catch (error) {
    die(error.message);
  }
}

process.argv[1] === fileURLToPath(import.meta.url) && main();
