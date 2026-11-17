#!/usr/bin/env node
// Language-neutral, text-based helpers for the unused-abstraction-scan skill.
// No parser and no packages. A helper finds candidates and counts text
// matches; it does not decide anything. Semantic facts (references, callers,
// unused diagnostics) come from a language server when one exists, and the
// model confirms every candidate by reading the code.
//
// Subcommands (all print JSON, except `report`):
//   inert        comments that say a declaration does nothing
//   refs NAME    word matches of NAME, split into production and test files
//   empty-types  declarations of types with no members (listed forms only)
//   ignored      identifiers that look like deliberately unused option bags
//   verdict SYMBOL FILE   whether SYMBOL leaves its package
//   report FILE  validate a findings file and print a ranked summary
//
// Exit codes: 0 ok, 1 `report` has at least one reported finding, 2 error.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const usage = `usage: survey.mjs <command> [options]

Commands:
  inert [--phrase <text>]...    Comments such as "has no effect" and the
                                declaration after each.
  refs <name>                   Word matches of <name> outside comments.
  empty-types                   Empty type declarations (forms listed in
                                references/languages.md).
  ignored [--pattern <regex>]   Identifiers like _options (default
                                ^_\\w*(options?|opts|config|cfg|settings)\\w*$).
  verdict <symbol> <file>       Consumer verdict for a symbol declared in file.
  diff-scope [--base <ref>] [--working-tree]
                                Files changed against the base (default
                                origin/main, else origin/master).
  report <findings.json|-> [--out <file>] [--wire]
                                Validate findings (- reads stdin), print a
                                ranked summary, and write the result to <file>
                                when given. With --wire, print the review-lens
                                JSON array instead of the summary. Writes
                                nothing else.

Options for inert, empty-types, and ignored (they limit candidates only;
refs and verdict always search the whole tree):
  --scope <path>      Candidates only under this path. Repeatable.
  --diff              Candidates only in files changed against the base.
  --base <ref>        Base for --diff (default origin/main, else origin/master).
                      A range base..head also works; pass a pull request as
                      its base and head refs.
  --working-tree      With --diff, add uncommitted and untracked files.
  With --diff and --scope, a file must satisfy both.
Options for every command that reads source:
  --ext <.ext>        Treat this extension as source. Repeatable.
Options for verdict:
  --offline              Skip the gh search.
  --assume-unpublished   Treat every package as unpublished.
`;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_GH_QUERIES = 10;
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "coverage",
  ".next", ".turbo", ".claude", "vendor", "__pycache__", ".venv", "venv",
]);
const SOURCE_EXTENSIONS = new Set(
  `ts tsx mts cts js jsx mjs cjs py go rs java kt kts scala c h cc cpp cxx hpp
   hh cs swift rb php jl lua ex exs erl hs ml dart zig`.split(/\s+/)
);
const MANIFESTS = [
  "package.json", "Cargo.toml", "pyproject.toml", "setup.py", "setup.cfg",
  "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Project.toml",
];
const INERT_PHRASES = [
  "is not implemented", "has no effect", "is accepted but", "does nothing",
  "is ignored", "is unused",
];
const QUIET_DIRS = new Set([".git", "node_modules", ".claude", "__pycache__"]);
const SEVERITY_RANK ={ high: 0, medium: 1, low: 2 };
const EVIDENCE_SOURCES = new Set(["lsp", "text", "read"]);
const JUDGMENTS = new Set(["confirmed", "downgraded", "dropped"]);

function fail(message) {
  process.stderr.write(`survey.mjs: ${message}\n`);
  process.exit(2);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toPosix = (path) => path.split(sep).join("/");
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|--|;|%|"""|''')/;
const isCommentLine = (line) => COMMENT_LINE.test(line);

function isTestFile(file) {
  const name = file.split("/").pop();
  return (
    /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|testing)\//.test(file) ||
    /(^|\/)src\/test\//.test(file) ||
    /\.(test|spec)\.[a-z]+$/.test(name) ||
    /(_test|_spec)\.[a-z]+$/.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /(Test|Tests|IT)\.(java|kt|scala|cs)$/.test(name) ||
    /^(test_.*|.*_test)\.(c|cc|cpp|cxx)$/.test(name) ||
    name === "runtests.jl"
  );
}

function tryExec(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
    });
  } catch {
    return null;
  }
}

function walk(root, directory = "") {
  const names = [];
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      // A placeholder entry records an excluded tree for `excludedDirs`.
      SKIP_DIRS.has(entry.name)
        ? names.push(`${path}/.excluded`)
        : names.push(...walk(root, path));
    } else {
      names.push(path);
    }
  }
  return names;
}

function parseOptions(args, valueFlags, boolFlags) {
  const options = { _: [] };
  for (const flag of valueFlags) {
    options[flag] = [];
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (valueFlags.includes(arg.slice(2))) {
      i + 1 < args.length || fail(`${arg} needs a value`);
      options[arg.slice(2)].push(args[(i += 1)]);
    } else if (arg.startsWith("--") && boolFlags.includes(arg.slice(2))) {
      options[arg.slice(2)] = true;
    } else if (arg.startsWith("--")) {
      fail(`unknown option ${arg}\n${usage}`);
    } else {
      options._.push(arg);
    }
  }
  return options;
}

/**
 * The tree: repo-relative paths (git's view when available, so ignore files
 * apply) and the source files loaded once. A symlink is never followed. A link
 * to a listed file inside the tree is ignored, because the target is scanned
 * as itself. Any other source file that cannot be read goes in `skipped`: it
 * may hold a reader.
 */
function loadTree(extraExtensions) {
  const cwd = process.cwd();
  const top = tryExec("git", ["rev-parse", "--show-toplevel"], cwd);
  const root = top === null ? cwd : resolve(top.trim());
  const listed =
    top === null
      ? null
      : tryExec(
          "git",
          ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
          root
        );
  const all = listed === null ? walk(root) : listed.split("\0").filter(Boolean);
  // Excluded trees that may hold readers are reported. Third-party and tool
  // directories are not.
  const excludedDirs = new Set();
  for (const name of all) {
    const parts = name.split("/");
    const at = parts.findIndex((part) => SKIP_DIRS.has(part));
    at !== -1 &&
      !QUIET_DIRS.has(parts[at]) &&
      excludedDirs.add(parts.slice(0, at + 1).join("/"));
  }
  const paths = all
    .filter((name) => !name.split("/").some((part) => SKIP_DIRS.has(part)))
    .sort();
  const pathSet = new Set(paths);
  const extensions = new Set([
    ...SOURCE_EXTENSIONS,
    ...extraExtensions.map((ext) => ext.replace(/^\./, "")),
  ]);
  const rootReal = realpathSync(root);
  const sources = new Map();
  const skipped = [];

  for (const file of paths) {
    if (!extensions.has(file.split(".").pop())) {
      // A symlink to a directory hides a whole tree from the scan.
      try {
        lstatSync(join(root, file)).isSymbolicLink() &&
          statSync(join(root, file)).isDirectory() &&
          skipped.push(file);
      } catch {
        // A dangling link or a deleted file holds no source.
      }
      continue;
    }
    try {
      const stat = lstatSync(join(root, file));
      if (stat.isSymbolicLink()) {
        const target = realpathSync(join(root, file));
        pathSet.has(toPosix(relative(rootReal, target))) || skipped.push(file);
        continue;
      }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        stat.isFile() && skipped.push(file);
        continue;
      }
      const text = readFileSync(join(root, file), "utf8");
      if (text.includes("\0")) {
        continue;
      }
      const lines = text.split("\n");
      sources.set(file, {
        lines,
        test: isTestFile(file),
        code: lines.map((line) => (isCommentLine(line) ? "" : line)),
      });
    } catch {
      existsSync(join(root, file)) && skipped.push(file);
    }
  }
  return { root, paths, sources, skipped, excludedDirs: [...excludedDirs].sort() };
}

/** What a run could not see, repeated in every command's output. */
const meta = (tree) => ({
  skippedFiles: tree.skipped,
  excludedDirs: tree.excludedDirs,
});

/**
 * Files changed against a base: `git diff --name-only <base>...HEAD`, plus the
 * working tree and untracked files when asked. A renamed file counts under its
 * new path.
 */
function changedPaths(root, spec, workingTree) {
  // `spec` is a ref, or a range `base..head` or `base...head`. A pull request
  // is passed as its base and head refs in that form.
  const [left, right] = spec === null ? [null, "HEAD"] : spec.split(/\.{2,3}/);
  const head = right === undefined || right === "" ? "HEAD" : right;
  const verify = (ref) =>
    tryExec("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root) !== null;
  const ref = (left === null ? ["origin/main", "origin/master"] : [left]).find(verify);
  ref === undefined &&
    fail(`no base ref found${left === null ? " (tried origin/main, origin/master)" : `: ${left}`}`);
  verify(head) || fail(`no head ref found: ${head}`);
  workingTree && head !== "HEAD" && fail("--working-tree needs a head of HEAD");
  const mergeBase = tryExec("git", ["merge-base", ref, head], root)?.trim() ?? null;
  mergeBase === null && fail(`no merge base between ${ref} and ${head}`);
  const names = (args) => (tryExec("git", args, root) ?? "").split("\0").filter(Boolean);
  // With the working tree, the net change is merge base to working tree, so a
  // committed change that was reverted does not count. Untracked files are new.
  const paths = new Set(
    workingTree
      ? [
          ...names(["diff", "--name-only", "-z", mergeBase]),
          ...names(["ls-files", "-z", "--others", "--exclude-standard"]),
        ]
      : names(["diff", "--name-only", "-z", `${ref}...${head}`])
  );
  return { base: ref, head, mergeBase, workingTree, paths: [...paths].sort() };
}

/**
 * Which files may yield candidates. Evidence searches never use this: readers
 * and callers are always searched in the whole tree.
 *
 * - `--diff [--base <ref>] [--working-tree]`: files changed against the base.
 * - `--scope <path>`: named paths. With `--diff`, both must hold.
 */
function scopeFilter(root, options) {
  const scopes = options.scope.map((scope) => {
    const rel = toPosix(relative(root, resolve(process.cwd(), scope)));
    (rel === ".." || rel.startsWith("../")) && fail(`scope ${scope} is outside ${root}`);
    return rel.replace(/\/+$/, "");
  });
  const diff = options.diff
    ? changedPaths(root, options.base[0] ?? null, options["working-tree"] === true)
    : null;
  const changed = diff === null ? null : new Set(diff.paths);
  const inScope = (file) =>
    (changed === null || changed.has(file)) &&
    (scopes.length === 0 ||
      scopes.some((s) => s === "" || file === s || file.startsWith(`${s}/`)));
  const mode = diff !== null ? "diff" : scopes.length > 0 ? "paths" : "repo";
  return {
    inScope,
    scope: {
      mode,
      ...(diff === null ? {} : { base: diff.base, head: diff.head, mergeBase: diff.mergeBase, workingTree: diff.workingTree, changedFiles: diff.paths.length }),
      ...(scopes.length === 0 ? {} : { paths: scopes }),
      candidatesOnly: true,
    },
  };
}

function diffScope(args) {
  const options = parseOptions(args, ["base"], ["working-tree"]);
  const top = tryExec("git", ["rev-parse", "--show-toplevel"], process.cwd());
  top === null && fail("not inside a git repository");
  return changedPaths(resolve(top.trim()), options.base[0] ?? null, options["working-tree"] === true);
}

const wordPattern = (name) => new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`);

// --- inert -------------------------------------------------------------

function inert(args) {
  const options = parseOptions(args, ["scope", "ext", "phrase", "base"], ["diff", "working-tree"]);
  const tree = loadTree(options.ext);
  const { inScope, scope } = scopeFilter(tree.root, options);
  const phrases = options.phrase.length > 0 ? options.phrase : INERT_PHRASES;
  const pattern = new RegExp(phrases.map(escapeRegExp).join("|"), "i");
  const candidates = [];

  for (const [file, { lines, test }] of tree.sources) {
    if (test || !inScope(file)) {
      continue;
    }
    lines.forEach((line, index) => {
      const match = isCommentLine(line) && pattern.exec(line);
      if (!match) {
        return;
      }
      let next = index + 1;
      while (next < lines.length && (isCommentLine(lines[next]) || lines[next].trim() === "")) {
        next += 1;
      }
      candidates.push({
        file,
        line: index + 1,
        phrase: match[0],
        comment: line.trim(),
        declarationLine: next + 1,
        declaration: lines[next]?.trim() ?? null,
      });
    });
  }
  return { scope, candidates, ...meta(tree) };
}

// --- refs --------------------------------------------------------------

function refs(args) {
  // No scope options: readers are always searched in the whole tree.
  const options = parseOptions(args, ["ext"], []);
  const [name] = options._;
  name === undefined && fail("refs needs a name");
  const tree = loadTree(options.ext);
  const word = wordPattern(name);
  const escaped = escapeRegExp(name);
  // `.name`, `->name`, `::name`: a member access reads. A declaration or a
  // keyed literal (`name:`) does not, which is why the shapes are separated.
  const access = new RegExp(`(\\.|->|::)\\s*${escaped}(?![\\w$])`);
  const quoted = new RegExp(`["'\`]${escaped}["'\`]`);
  const hits = [];

  for (const [file, { code, test }] of tree.sources) {
    code.forEach((line, index) => {
      if (!word.test(line)) {
        return;
      }
      hits.push({
        file,
        line: index + 1,
        text: line.trim(),
        kind: test ? "test" : "production",
        shape: access.test(line) ? "access" : quoted.test(line) ? "quoted" : "other",
      });
    });
  }
  const production = hits.filter((hit) => hit.kind === "production");
  return {
    name,
    evidenceSource: "text",
    counts: {
      production: production.length,
      productionAccess: production.filter((h) => h.shape === "access").length,
      test: hits.length - production.length,
    },
    hits,
    ...meta(tree),
  };
}

// --- empty-types -------------------------------------------------------

/** Declaration forms with no members. Each form is exercised in the tests. */
const EMPTY_FORMS = [
  // TypeScript, Java, Kotlin, C#, Scala, C++: `interface X {}`, `class X {}`
  { language: "braces", re: /^\s*(?:export\s+|public\s+|pub\s+|data\s+|final\s+|abstract\s+)*(?:interface|class|struct|record|trait|object)\s+([A-Za-z_]\w*)\s*(?:\(\s*\)\s*)?\{\s*\}\s*;?\s*$/ },
  // Rust: `struct X;`
  { language: "rust", re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)\s*;\s*$/ },
  // Go: `type X struct{}`
  { language: "go", re: /^\s*type\s+([A-Za-z_]\w*)\s+struct\s*\{\s*\}\s*$/ },
  // Julia: `struct X end`
  { language: "julia", re: /^\s*(?:mutable\s+)?struct\s+([A-Za-z_]\w*)\s+end\s*$/ },
];

function emptyTypes(args) {
  const options = parseOptions(args, ["scope", "ext", "base"], ["diff", "working-tree"]);
  const tree = loadTree(options.ext);
  const { inScope, scope } = scopeFilter(tree.root, options);
  const found = [];

  for (const [file, { lines, test, code }] of tree.sources) {
    if (test || !inScope(file)) {
      continue;
    }
    lines.forEach((line, index) => {
      let name = null;
      for (const form of EMPTY_FORMS) {
        name ??= form.re.exec(line)?.[1] ?? null;
      }
      // Python: `class X:` followed by `pass` or `...` as the only body line.
      const python = /^class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*$/.exec(line);
      if (name === null && python !== null) {
        const body = lines[index + 1]?.trim();
        (body === "pass" || body === "...") && (name = python[1]);
      }
      if (name === null) {
        return;
      }
      const word = wordPattern(name);
      const uses = code.filter((text, i) => i !== index && word.test(text)).length;
      let elsewhere = 0;
      for (const [other, source] of tree.sources) {
        other === file || source.test || (elsewhere += source.code.filter((t) => word.test(t)).length);
      }
      found.push({ file, line: index + 1, name, usesInFile: uses, usesInOtherProductionFiles: elsewhere });
    });
  }
  return { scope, candidates: found, ...meta(tree) };
}

// --- ignored -----------------------------------------------------------

function ignored(args) {
  const options = parseOptions(args, ["scope", "ext", "pattern", "base"], ["diff", "working-tree"]);
  const tree = loadTree(options.ext);
  const { inScope, scope } = scopeFilter(tree.root, options);
  const source = options.pattern[0] ?? "^_\\w*(options?|opts|config|cfg|settings)\\w*$";
  let identifier;
  try {
    identifier = new RegExp(source, "i");
  } catch {
    return fail(`invalid pattern ${source}`);
  }
  const candidates = [];

  for (const [file, { code, test }] of tree.sources) {
    if (test || !inScope(file)) {
      continue;
    }
    code.forEach((line, index) => {
      for (const [name] of line.matchAll(/[A-Za-z_]\w*/g)) {
        if (identifier.test(name)) {
          candidates.push({ file, line: index + 1, name, text: line.trim() });
        }
      }
    });
  }
  return { scope, pattern: source, candidates, ...meta(tree) };
}

// --- verdict -----------------------------------------------------------

/** Nearest manifest at or above a file: its directory, name, and privacy. */
function manifestOf(tree, cache, file) {
  const parentDir = (dir) => (dirname(dir) === "." ? "" : dirname(dir));
  for (let dir = parentDir(file); ; dir = parentDir(dir)) {
    if (cache.has(dir)) {
      return cache.get(dir);
    }
    const found = MANIFESTS.find((m) => existsSync(join(tree.root, dir, m)));
    if (found !== undefined || dir === "") {
      const info = found === undefined
        ? { dir, manifest: null, name: null, private: false }
        : readManifest(join(tree.root, dir, found), dir, found);
      cache.set(dir, info);
      return info;
    }
  }
}

function readManifest(path, dir, manifest) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // An unreadable manifest counts as published and unnamed.
  }
  const info = { dir, manifest, name: null, private: false };
  if (manifest === "package.json") {
    try {
      const json = JSON.parse(text);
      info.name = typeof json.name === "string" ? json.name : null;
      info.private = json.private === true;
    } catch {
      // Keep the defaults.
    }
  } else if (manifest === "Cargo.toml") {
    info.name = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
    info.private = /^\s*publish\s*=\s*false\b/m.test(text);
  } else if (manifest === "pyproject.toml") {
    info.name = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
    info.private = /Private\s*::\s*Do Not Upload/.test(text);
  } else if (manifest === "go.mod") {
    info.name = /^module\s+(\S+)/m.exec(text)?.[1] ?? null;
  } else if (manifest === "pom.xml") {
    info.name = /<artifactId>([^<]+)<\/artifactId>/.exec(text)?.[1] ?? null;
  } else if (manifest === "Project.toml") {
    info.name = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
  }
  return info;
}

function ghSearch(root, symbol, pkg, state) {
  if (pkg.name === null) {
    return { verdict: "unknown", detail: "package has no name to search for" };
  }
  if (state.queries >= MAX_GH_QUERIES) {
    return { verdict: "unknown", detail: "gh query limit reached" };
  }
  state.selfRepo ??=
    tryExec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], root)?.trim() ?? null;
  if (!state.selfRepo) {
    return { verdict: "unknown", detail: "gh is unavailable or not logged in" };
  }
  state.queries += 1;
  const out = tryExec(
    "gh",
    ["search", "code", `${symbol} ${pkg.name}`, "--json", "repository,path", "--limit", "100"],
    root
  );
  let results = null;
  try {
    results = out === null ? null : JSON.parse(out);
  } catch {
    // Handled below.
  }
  if (!Array.isArray(results)) {
    return { verdict: "unknown", detail: "gh search failed" };
  }
  const others = results.filter((hit) => hit.repository?.nameWithOwner !== state.selfRepo);
  return others.length > 0
    ? {
        verdict: "exported-with-hits",
        detail: `${others.length} hits in other repositories, first ${others[0].repository?.nameWithOwner}:${others[0].path}`,
      }
    : { verdict: "exported-no-hits", detail: "no hits in other repositories; the code index is incomplete" };
}

/**
 * Whether a symbol leaves its package. Only `internal-only` clears an edit.
 * A "package" is the directory of the nearest manifest. Text matches in
 * another package make it `exported-with-hits`; a private package, or the
 * user's flag, makes it `internal-only`; otherwise gh decides or the verdict
 * is `unknown`.
 */
function verdict(args) {
  const options = parseOptions(args, ["ext"], ["offline", "assume-unpublished"]);
  const [symbol, file] = options._;
  (symbol === undefined || file === undefined) && fail("verdict needs <symbol> <file>");
  const tree = loadTree(options.ext);
  const rel = toPosix(relative(tree.root, resolve(process.cwd(), file)));
  const cache = new Map();
  const pkg = manifestOf(tree, cache, rel);
  const word = wordPattern(symbol);
  let elsewhere = null;
  for (const [other, source] of tree.sources) {
    if (elsewhere !== null || manifestOf(tree, cache, other).dir === pkg.dir) {
      continue;
    }
    const index = source.code.findIndex((line) => word.test(line));
    index !== -1 && (elsewhere = `${other}:${index + 1}`);
  }
  let result;
  if (elsewhere !== null) {
    result = { verdict: "exported-with-hits", detail: `named in another package at ${elsewhere}` };
  } else if (pkg.private) {
    result = { verdict: "internal-only", detail: `package ${pkg.dir || "."} is private` };
  } else if (rel.endsWith(".go") && `/${rel}`.includes("/internal/")) {
    // The Go toolchain limits importers of an `internal/` directory to the
    // tree under its parent.
    result = { verdict: "internal-only", detail: "Go internal/ directory" };
  } else if (options["assume-unpublished"]) {
    result = { verdict: "internal-only", detail: "assumed by --assume-unpublished" };
  } else if (options.offline) {
    result = { verdict: "unknown", detail: "--offline" };
  } else {
    result = ghSearch(tree.root, symbol, pkg, { queries: 0, selfRepo: undefined });
  }
  return {
    symbol,
    file: rel,
    package: { dir: pkg.dir, manifest: pkg.manifest, name: pkg.name, private: pkg.private },
    evidenceSource: "text",
    ...result,
    ...meta(tree),
  };
}

// --- report ------------------------------------------------------------

function validateFinding(finding, index) {
  const where = `findings[${index}]`;
  const problems = [];
  const need = (ok, message) => ok || problems.push(`${where}: ${message}`);
  need(typeof finding === "object" && finding !== null, "must be an object");
  if (problems.length > 0) {
    return problems;
  }
  for (const key of ["id", "check", "file", "symbol", "proposal", "evidence"]) {
    need(typeof finding[key] === "string" && finding[key] !== "", `${key} must be a non-empty string`);
  }
  need(["script", "reviewer"].includes(finding.source), "source must be script or reviewer");
  need(finding.severity in SEVERITY_RANK, "severity must be high, medium, or low");
  need(Number.isInteger(finding.line), "line must be an integer");
  need(typeof finding.refused === "boolean", "refused must be a boolean");
  const sources = [finding.evidenceSource].flat();
  need(
    sources.length > 0 && sources.every((s) => EVIDENCE_SOURCES.has(s)),
    "evidenceSource must be lsp, text, or read (or a list of them)"
  );
  need(JUDGMENTS.has(finding.judgment), "judgment must be confirmed, downgraded, or dropped");
  need(
    typeof finding.judgmentReason === "string" && finding.judgmentReason !== "",
    "judgmentReason is required"
  );
  need(
    finding.refused !== true || (typeof finding.reason === "string" && finding.reason !== ""),
    "a refused finding needs a reason"
  );
  return problems;
}

/**
 * The only file this script writes. It refuses to replace a file that is not
 * an earlier findings file, so a mistyped path cannot overwrite source code.
 */
function writeFindings(path, document) {
  if (existsSync(path)) {
    let previous = null;
    try {
      previous = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Not JSON: refused below.
    }
    previous?.tool === document.tool ||
      fail(`${path} exists and is not a findings file; choose another path`);
  }
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

function report(args) {
  const options = parseOptions(args, ["out"], ["wire"]);
  const [path] = options._;
  path === undefined && fail("report needs a findings file, or - for stdin");
  let input;
  try {
    input = JSON.parse(readFileSync(path === "-" ? 0 : path, "utf8"));
  } catch (error) {
    return fail(`cannot read ${path}: ${error.message}`);
  }
  const findings = Array.isArray(input) ? input : input.findings;
  Array.isArray(findings) || fail("input must be an array or an object with a findings array");
  const problems = findings.flatMap(validateFinding);
  problems.length > 0 && fail(`invalid findings:\n${problems.join("\n")}`);

  const dropped = findings.filter((f) => f.judgment === "dropped");
  const live = findings.filter((f) => f.judgment !== "dropped");
  const reported = live.filter((f) => !f.refused);
  const counts = {
    candidates: findings.length,
    reported: reported.length,
    refused: live.length - reported.length,
    dropped: dropped.length,
    byReviewer: findings.filter((f) => f.source === "reviewer").length,
  };
  const skippedFiles = Array.isArray(input.skippedFiles) ? input.skippedFiles : [];
  const excludedDirs = Array.isArray(input.excludedDirs) ? input.excludedDirs : [];
  const document = { tool: "unused-abstraction-scan", counts, skippedFiles, excludedDirs, findings };
  options.out.length > 0 && writeFindings(options.out[0], document);

  const lines = [
    `candidates ${counts.candidates}, reported ${counts.reported}, refused ${counts.refused}, dropped ${counts.dropped}, by reviewer ${counts.byReviewer}`,
  ];
  reported
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line)
    .forEach((f, i) =>
      lines.push(
        `${i + 1}. [${f.severity}] (${f.source}, ${[f.evidenceSource].flat().join("+")}) ${f.file}:${f.line} ${f.symbol}: ${f.proposal}`
      )
    );
  live
    .filter((f) => f.refused)
    .forEach((f) => lines.push(`refused ${f.file}:${f.line} ${f.symbol}: ${f.reason}`));
  skippedFiles.length > 0 && lines.push(`skipped files: ${skippedFiles.length}`);

  const wire = [
    ...reported.map(toWire),
    ...live.filter((f) => f.refused && f.worthALook === true).slice(0, MAX_WIRE_REFUSALS).map(toWire),
  ];
  return {
    text: `${lines.join("\n")}\n`,
    reported: reported.length,
    wire,
    wantWire: options.wire === true,
  };
}

const LENS_SLUG = "unused-abstraction-scan";
const MAX_WIRE_REFUSALS = 5;

/**
 * One finding in the review-lens wire format. Our severities are already
 * high, medium, and low. A refusal is listed as low and its fix says what to
 * confirm. `source: script|reviewer` moves into the body and evidence text,
 * because `source` is the lens slug in this format.
 */
function toWire(finding) {
  const sources = [finding.evidenceSource].flat();
  const verified = sources.includes("lsp") || (sources.includes("text") && sources.includes("read"));
  const origin = `finding source: ${finding.source}`;
  const evidence = `${verified ? "Verified" : "Inferred"}: ${sources.join("+")}; ${origin}; ${finding.evidence}`;
  return finding.refused
    ? {
        source: LENS_SLUG,
        path: finding.file,
        line: finding.line,
        severity: "low",
        title: `${finding.check}: ${finding.symbol} (kept, worth a look)`,
        body: `${finding.reason} (${origin}; judgment ${finding.judgment}: ${finding.judgmentReason})`,
        suggested_fix: `Confirm: ${finding.confirm ?? finding.reason}`,
        evidence,
      }
    : {
        source: LENS_SLUG,
        path: finding.file,
        line: finding.line,
        severity: finding.severity,
        title: `${finding.check}: ${finding.symbol}`,
        body: `${finding.evidence} (${origin}; judgment ${finding.judgment}: ${finding.judgmentReason})`,
        suggested_fix: finding.proposal,
        evidence,
      };
}

// --- main --------------------------------------------------------------

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "-h" || command === "--help") {
    process.stdout.write(usage);
    return;
  }
  const json = { inert, refs, "empty-types": emptyTypes, ignored, verdict, "diff-scope": diffScope };
  if (command === "report") {
    const { text, reported, wire, wantWire } = report(args);
    if (wantWire) {
      process.stdout.write(`${JSON.stringify(wire, null, 2)}\n`);
      process.stderr.write(`headline: ${wire.length > 0 ? "needs-attention" : "approve"}\n`);
    } else {
      process.stdout.write(text);
    }
    process.exitCode = reported > 0 ? 1 : 0;
  } else if (command in json) {
    process.stdout.write(`${JSON.stringify(json[command](args), null, 2)}\n`);
  } else {
    fail(`unknown command ${command}\n${usage}`);
  }
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
