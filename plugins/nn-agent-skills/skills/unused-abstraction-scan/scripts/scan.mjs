#!/usr/bin/env node
// Finds TypeScript indirection that no production module reads: a field whose
// doc comment says it has no effect, an options type that declares no fields,
// and an ignored options parameter whose type nothing reads.
//
// Every check asks one question in a different syntactic place: does any
// production module read this? A finding is reported only when the readers
// are absent and the consumer verdict says the symbol is internal. Everything
// else is kept as a refusal with its reason.
//
// Exit codes: 0 nothing reported, 1 at least one finding reported, 2 error.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const usage = `usage: scan.mjs [--scope <path>]... [--out <file>] [--offline]
                [--assume-unpublished] [--ignore-pattern <regex>]

Scans TypeScript files under the git root (or the current directory outside a
git repository) and reports unused indirection.

Options:
  --scope <path>          Restrict findings to declarations under this path.
                          Readers are still searched in the whole tree.
                          Repeatable.
  --out <file>            Write the findings JSON to <file> and print a short
                          ranked summary. Without it the JSON goes to stdout.
  --offline               Skip the gh search. A symbol of a published package
                          then has verdict "unknown", which is a refusal.
  --assume-unpublished    Treat every package as unpublished: a symbol with no
                          reference in another package is "internal-only".
  --ignore-pattern <re>   Parameter-name pattern for "deliberately unread".
                          Default: eslint's argsIgnorePattern if found, else ^_.
  -h, --help              This text.

Exit codes: 0 nothing reported, 1 findings reported, 2 could not run.
`;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_GH_QUERIES = 10;
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".claude",
]);
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

function fail(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toPosix = (path) => path.split(sep).join("/");
const isCommentLine = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);
const isTestFile = (file) =>
  /(^|\/)(__tests__|__mocks__|tests?|e2e)\//.test(file) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

/** Run a command; null when it fails or is missing. */
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
      SKIP_DIRS.has(entry.name) || names.push(...walk(root, path));
    } else {
      names.push(path);
    }
  }
  return names;
}

/** Repo-relative paths: git's view when available, so .gitignore applies. */
function listPaths(root, inGit) {
  const listed = inGit
    ? tryExec(
        "git",
        ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        root
      )
    : null;
  const names =
    listed === null ? walk(root) : listed.split("\0").filter(Boolean);
  return names
    .filter((name) => !name.split("/").some((part) => SKIP_DIRS.has(part)))
    .sort();
}

/**
 * Load TypeScript sources into memory once. A symlink is never followed. A
 * link to a file inside the tree is skipped silently, because the target is
 * scanned as itself. Any other file that cannot be read (outside link, over
 * the size limit, unreadable) goes in `skipped`: it may hold a reader, so a
 * run with skipped files refuses every proposal.
 */
function loadSources(root, paths) {
  const sources = new Map();
  const skipped = [];
  const rootReal = realpathSync(root);
  const listed = new Set(paths);
  for (const file of paths) {
    if (!/\.(ts|tsx|mts|cts)$/.test(file)) {
      continue;
    }
    try {
      const stat = lstatSync(join(root, file));
      if (stat.isSymbolicLink()) {
        const target = realpathSync(join(root, file));
        // The target must be among the listed paths, or it is never scanned.
        listed.has(toPosix(relative(rootReal, target))) || skipped.push(file);
        continue;
      }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        stat.isFile() && skipped.push(file);
        continue;
      }
      const text = readFileSync(join(root, file), "utf8");
      const lines = text.split("\n");
      sources.set(file, {
        text,
        lines,
        // Comment-only lines blanked, so a match is never in prose.
        code: lines.map((line) => (isCommentLine(line) ? "" : line)).join("\n"),
        test: isTestFile(file),
      });
    } catch {
      // A path git lists but the disk lacks is a deleted file, not a source.
      existsSync(join(root, file)) && skipped.push(file);
    }
  }
  return { sources, skipped };
}

/** eslint's argsIgnorePattern from the repo's config, else `^_`. */
function discoverIgnorePattern(root, paths) {
  const configs = paths.filter(
    (path) =>
      /(^|\/)(\.eslintrc(\.[a-z]+)?|eslint\.config\.[cm]?[jt]s)$/.test(path) ||
      /(^|\/)\.config\/eslint[^/]*$/.test(path) ||
      path === "package.json"
  );
  for (const path of configs) {
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue;
    }
    const quoted =
      /["']?argsIgnorePattern["']?\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(
        text
      );
    const bare = /argsIgnorePattern\s*:\s*([^\s,}"'`]+)/.exec(text);
    const raw = quoted !== null ? quoted[2] : bare !== null ? bare[1] : null;
    if (raw === null) {
      continue;
    }
    for (const candidate of [raw, raw.replace(/\\\\/g, "\\")]) {
      try {
        new RegExp(candidate);
        return { pattern: candidate, source: path };
      } catch {
        // Try the unescaped form, then the next config.
      }
    }
  }
  return { pattern: "^_", source: "default" };
}

function parseArgs(argv) {
  const options = {
    scopes: [],
    out: null,
    offline: false,
    assumeUnpublished: false,
    ignorePattern: null,
  };
  const value = (i, flag) =>
    i + 1 < argv.length ? argv[i + 1] : fail(`${flag} needs a value`);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(usage);
      process.exit(0);
    } else if (arg === "--scope") {
      options.scopes.push(value(i, arg));
      i += 1;
    } else if (arg === "--out") {
      options.out = value(i, arg);
      i += 1;
    } else if (arg === "--ignore-pattern") {
      options.ignorePattern = value(i, arg);
      i += 1;
    } else if (arg === "--offline") {
      options.offline = true;
    } else if (arg === "--assume-unpublished") {
      options.assumeUnpublished = true;
    } else {
      fail(`unknown argument ${arg}\n${usage}`);
    }
  }
  return options;
}

// --- Context -----------------------------------------------------------

function makeContext(options) {
  const cwd = process.cwd();
  const top = tryExec("git", ["rev-parse", "--show-toplevel"], cwd);
  const inGit = top !== null;
  const root = inGit ? resolve(top.trim()) : cwd;
  const paths = listPaths(root, inGit);
  const { sources, skipped } = loadSources(root, paths);

  let ignore = discoverIgnorePattern(root, paths);
  if (options.ignorePattern !== null) {
    ignore = { pattern: options.ignorePattern, source: "--ignore-pattern" };
  }
  let ignoreRegExp;
  try {
    ignoreRegExp = new RegExp(ignore.pattern);
  } catch {
    return fail(`invalid ignore pattern ${ignore.pattern}`);
  }

  const scopes = options.scopes.map((scope) => {
    const rel = toPosix(relative(root, resolve(cwd, scope)));
    if (rel === ".." || rel.startsWith("../")) {
      fail(`scope ${scope} is outside ${root}`);
    }
    return rel === "" ? "" : rel.replace(/\/+$/, "");
  });

  return {
    root,
    sources,
    skipped,
    scopes,
    options,
    ignore,
    ignoreRegExp,
    packageCache: new Map(),
    verdictCache: new Map(),
    ghQueries: 0,
    selfRepo: undefined,
  };
}

/**
 * A scope matches in both directions: a check reads a declaring file and a
 * whole tree of readers, so a scope inside either keeps the check alive.
 */
function inScope(ctx, file) {
  return (
    ctx.scopes.length === 0 ||
    ctx.scopes.some(
      (scope) =>
        scope === "" ||
        file === scope ||
        file.startsWith(`${scope}/`) ||
        scope.startsWith(`${file}/`)
    )
  );
}

const lineOf = (text, index) => {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; ) {
    line += 1;
    i = text.indexOf("\n", i + 1);
  }
  return line;
};

function idOf(check, file, line, name) {
  return `${check}-${`${file}-${line}-${name}`.replace(/[^A-Za-z0-9]/g, "-")}`;
}

// --- Searches ----------------------------------------------------------

function productionSources(ctx) {
  return [...ctx.sources].filter(([, source]) => !source.test);
}

/**
 * Production reads of a field. A member access, a quoted key, or a name inside
 * a destructuring pattern makes a field live. `{ name: true }` written by a
 * caller and `name: boolean` in a declaration read nothing and do not count.
 * Quoted keys and destructuring over-count on purpose: a missed read turns
 * into a wrong deletion, an extra one into a refusal.
 */
function fieldReads(ctx, name) {
  const word = escapeRegExp(name);
  // The access pattern spans lines (`options.\n  name`). The destructuring
  // pattern allows one level of nested braces and any type annotation.
  const access = new RegExp(`\\.\\s*${word}\\b|["'\`]${word}["'\`]`, "g");
  const inner = "(?:[^{}]|\\{[^{}]*\\})*";
  const destructure = new RegExp(
    `\\{${inner}(?:\\{[^{}]*\\b${word}\\b[^{}]*\\}|\\b${word}\\b)${inner}\\}\\s*(?:=(?![=>])|:\\s*[\\w.$\\{])`,
    "g"
  );
  const hits = [];
  for (const [file, source] of productionSources(ctx)) {
    if (!source.code.includes(name)) {
      continue;
    }
    for (const pattern of [access, destructure]) {
      for (const match of source.code.matchAll(pattern)) {
        hits.push({ file, line: lineOf(source.code, match.index) });
      }
    }
  }
  return hits;
}

/**
 * Test files that stop compiling once a field is gone. Broader than
 * `fieldReads`: a `name:` key and a shorthand `{ name }` both fail the type
 * check. It words the proposal and never decides whether to report.
 */
function testMentions(ctx, name) {
  const word = escapeRegExp(name);
  const pattern = new RegExp(`(\\.\\s*${word}\\b|\\b${word}\\s*[:,}])`);
  const hits = [];
  for (const [file, source] of ctx.sources) {
    if (!source.test || !source.text.includes(name)) {
      continue;
    }
    source.lines.forEach((line, index) => {
      pattern.test(line) && hits.push({ file, line: index + 1 });
    });
  }
  return hits;
}

function wordHits(ctx, name, { production }) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  const hits = [];
  for (const [file, source] of ctx.sources) {
    if ((production && source.test) || !pattern.test(source.text)) {
      continue;
    }
    source.lines.forEach((line, index) => {
      !isCommentLine(line) &&
        pattern.test(line) &&
        hits.push({ file, line: index + 1, text: line });
    });
  }
  return hits;
}

const declarationPattern = (name) =>
  new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?interface\\s+${name}\\b`);

/** Every `interface Name` declaration in the tree, with its heritage. */
function interfaceDeclarations(ctx, name) {
  const pattern = declarationPattern(escapeRegExp(name));
  const found = [];
  for (const [file, source] of ctx.sources) {
    source.lines.forEach((line, index) => {
      pattern.test(line) && found.push({ file, index, text: line });
    });
  }
  return found;
}

/** True when another interface extends `name`. */
function isExtended(ctx, name) {
  const pattern = new RegExp(
    `^\\s*(?:export\\s+)?interface\\s+\\w+[^{]*\\bextends\\b[^{]*\\b${escapeRegExp(name)}\\b`
  );
  return productionSources(ctx).some(([, source]) =>
    source.lines.some((line) => pattern.test(line))
  );
}

/**
 * The fields an interface declares between its own braces, or null when the
 * declaration has a shape this scan does not read (index signature, mapped
 * type, computed key). Fields from `extends` belong to the base.
 */
function interfaceFields(ctx, name) {
  const declarations = interfaceDeclarations(ctx, name);
  if (declarations.length !== 1) {
    return null;
  }
  const [{ file, index, text }] = declarations;
  const lines = ctx.sources.get(file).lines;
  const fieldPattern = /^\s*(?:readonly\s+)?(\w+)\??\s*[:(<]/;
  const extendsBase = /\bextends\b/.test(text.split("{")[0]);

  if (/\{.*\}\s*$/.test(text)) {
    const inner = text.slice(text.indexOf("{") + 1, text.lastIndexOf("}"));
    const fields = [];
    for (const part of inner.split(/[;,]/).filter((p) => p.trim() !== "")) {
      const field = fieldPattern.exec(part);
      if (field === null) {
        return null;
      }
      fields.push(field[1]);
    }
    return { file, line: index + 1, fields, extendsBase };
  }

  const declIndent = /^\s*/.exec(text)[0];
  const fields = [];
  let fieldIndent = null;
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || isCommentLine(line)) {
      continue;
    }
    const indent = /^\s*/.exec(line)[0];
    if (indent === declIndent && line.trim().startsWith("}")) {
      return { file, line: index + 1, fields, extendsBase };
    }
    fieldIndent ??= indent;
    if (indent.length > fieldIndent.length) {
      continue;
    }
    const field = fieldPattern.exec(line);
    if (field === null) {
      return null;
    }
    fields.push(field[1]);
  }
  return null;
}

/**
 * The interface whose own braces directly enclose a line, or null. Brace depth
 * from the declaration must be exactly 1: a field of a nested object type, or
 * a line after the interface closed, has no owner here.
 */
function owningInterface(lines, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const match = /^\s*(?:export\s+)?(?:declare\s+)?interface\s+(\w+)/.exec(
      lines[i]
    );
    if (match === null) {
      continue;
    }
    let depth = 0;
    for (const line of lines.slice(i, index)) {
      const bare = line
        .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")
        .replace(/\/\/.*$/, "");
      depth += (bare.match(/\{/g) ?? []).length - (bare.match(/\}/g) ?? []).length;
    }
    return depth === 1 ? match[1] : null;
  }
  return null;
}

// --- Consumer verdict --------------------------------------------------

const parentDir = (dir) => (dirname(dir) === "." ? "" : dirname(dir));

/** Nearest package.json at or above a file's directory, within the root. */
function packageOf(ctx, file) {
  for (let dir = parentDir(file); ; dir = parentDir(dir)) {
    if (ctx.packageCache.has(dir)) {
      return ctx.packageCache.get(dir);
    }
    const manifest = join(ctx.root, dir, "package.json");
    if (existsSync(manifest)) {
      let json = {};
      try {
        json = JSON.parse(readFileSync(manifest, "utf8"));
      } catch {
        // An unreadable manifest counts as published and unnamed.
      }
      const pkg = {
        dir,
        name: typeof json.name === "string" ? json.name : null,
        private: json.private === true,
      };
      ctx.packageCache.set(dir, pkg);
      return pkg;
    }
    if (dir === "") {
      const none = { dir: "", name: null, private: false };
      ctx.packageCache.set(dir, none);
      return none;
    }
  }
}

function ghSearch(ctx, symbol, pkg) {
  if (pkg.name === null) {
    return { verdict: "unknown", detail: "package has no name to search for" };
  }
  if (ctx.ghQueries >= MAX_GH_QUERIES) {
    return { verdict: "unknown", detail: "gh query limit reached" };
  }
  ctx.selfRepo ??=
    tryExec(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
      ctx.root
    )?.trim() ?? null;
  if (ctx.selfRepo === null || ctx.selfRepo === "") {
    return { verdict: "unknown", detail: "gh is unavailable or not logged in" };
  }
  ctx.ghQueries += 1;
  const out = tryExec(
    "gh",
    [
      "search",
      "code",
      `${symbol} ${pkg.name}`,
      "--json",
      "repository,path",
      "--limit",
      "100",
    ],
    ctx.root
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
  const others = results.filter(
    (hit) => hit.repository?.nameWithOwner !== ctx.selfRepo
  );
  return others.length > 0
    ? {
        verdict: "exported-with-hits",
        detail: `${others.length} hits in other repositories, first ${others[0].repository?.nameWithOwner}:${others[0].path}`,
      }
    : {
        verdict: "exported-no-hits",
        detail: "no hits in other repositories; the code index is incomplete",
      };
}

/**
 * Whether a symbol leaves its package. Only `internal-only` clears an edit.
 *
 * - `exported-with-hits`: another package in this repo names the symbol, or
 *   gh search finds it elsewhere.
 * - `internal-only`: the package is private, or the user said so, and no other
 *   package in this repo names it.
 * - `exported-no-hits`: a published package, and gh found nothing.
 * - `unknown`: the question could not be asked.
 */
function consumerVerdict(ctx, symbol, file) {
  const key = `${file}\0${symbol}`;
  if (ctx.verdictCache.has(key)) {
    return ctx.verdictCache.get(key);
  }
  const pkg = packageOf(ctx, file);
  const elsewhere = wordHits(ctx, symbol, { production: false }).find(
    (hit) => packageOf(ctx, hit.file).dir !== pkg.dir
  );
  let result;
  if (elsewhere !== undefined) {
    result = {
      verdict: "exported-with-hits",
      detail: `named in another package at ${elsewhere.file}:${elsewhere.line}`,
    };
  } else if (pkg.private) {
    result = { verdict: "internal-only", detail: "package is private" };
  } else if (ctx.options.assumeUnpublished) {
    result = {
      verdict: "internal-only",
      detail: "assumed by --assume-unpublished",
    };
  } else if (ctx.options.offline) {
    result = { verdict: "unknown", detail: "--offline" };
  } else {
    result = ghSearch(ctx, symbol, pkg);
  }
  ctx.verdictCache.set(key, result);
  return result;
}

const quoteVerdict = (symbol, { verdict, detail }) =>
  `consumer verdict for ${symbol}: ${verdict} (${detail})`;

// --- Design argument ---------------------------------------------------

/**
 * The written argument for a target's shape, if the repo makes one: the
 * file's leading comment, then DESIGN.md, ARCHITECTURE.md and README.md from
 * the file's directory up to its package root. A whole-word mention is quoted
 * into the finding. It does not refuse the finding, because weighing it
 * against the reader count is a judgment.
 */
function designArgument(ctx, file, names) {
  const patterns = names.map((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`));
  const mention = (text) => {
    for (const line of text.split("\n")) {
      if (patterns.some((pattern) => pattern.test(line))) {
        return line.trim().replace(/^[*#/\s]+/, "");
      }
    }
    return null;
  };

  const lines = ctx.sources.get(file).lines;
  const header = [];
  for (const line of lines) {
    if (!isCommentLine(line)) {
      break;
    }
    header.push(line);
  }
  const quotedHeader = mention(header.join("\n"));
  if (quotedHeader !== null) {
    return { source: `${file}, leading comment`, quoted: quotedHeader };
  }

  const pkgDir = packageOf(ctx, file).dir;
  for (let directory = parentDir(file); ; directory = parentDir(directory)) {
    for (const doc of ["DESIGN.md", "ARCHITECTURE.md", "README.md"]) {
      const path = directory === "" ? doc : `${directory}/${doc}`;
      let text;
      try {
        text = readFileSync(join(ctx.root, path), "utf8");
      } catch {
        continue;
      }
      const quoted = mention(text);
      if (quoted !== null) {
        return { source: path, quoted };
      }
    }
    if (directory === pkgDir || directory === "") {
      return null;
    }
  }
}

// --- Checks ------------------------------------------------------------

const INERT_PHRASES = [
  "is not implemented",
  "has no effect",
  "is accepted but",
  "does nothing",
];

/**
 * A declaration whose own comment says it does nothing. A comment on an
 * interface field names the deletion target. A comment on a callable says its
 * options parameter is inert, which is a fact about the parameter's type, so
 * that entry is refused and points at the type's own entry.
 */
function checkInertDoc(ctx) {
  const phrase = new RegExp(
    `^\\s*(?:\\*|//|/\\*).*(${INERT_PHRASES.join("|")})`,
    "i"
  );
  const keyword = /^(if|for|while|switch|catch|return|await|do|else|case)$/;
  const findings = [];
  const seen = new Set();

  for (const [file, source] of productionSources(ctx)) {
    const { lines } = source;
    for (let hit = 0; hit < lines.length; hit += 1) {
      const match = phrase.exec(lines[hit]);
      if (match === null) {
        continue;
      }
      let index = hit + 1;
      while (index < lines.length && (isCommentLine(lines[index]) || lines[index].trim() === "")) {
        index += 1;
      }
      if (index >= lines.length || seen.has(`${file}:${index}`)) {
        continue;
      }
      seen.add(`${file}:${index}`);

      const owner = owningInterface(lines, index);
      const field =
        owner === null
          ? null
          : /^\s+(?:readonly\s+)?(\w+)\??:\s*[^(]+[;,]?\s*$/.exec(lines[index]);
      const callable = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+)?(\w+)\s*[<(]/.exec(
        lines[index]
      );
      const kind =
        field !== null
          ? "field"
          : callable !== null && !keyword.test(callable[1])
            ? "callable"
            : null;
      if (kind === null || !inScope(ctx, file)) {
        continue;
      }
      findings.push(
        kind === "field"
          ? inertField(ctx, { file, line: index + 1, name: field[1], owner, phrase: match[1] })
          : {
              ...base("inert-doc", "medium", file, index + 1, callable[1]),
              signal: `a comment on this declaration says "${match[1]}"`,
              evidence: `the comment is attached to the callable ${callable[1]}, not to a field`,
              proposal: "none",
              refused: true,
              reason:
                "a comment on a callable is not a deletion target; if it describes an inert options parameter, the deletion belongs to that parameter's type, which the field entry for that type reports",
            }
      );
    }
  }
  return findings;
}

const base = (check, severity, file, line, symbol) => ({
  id: idOf(check, file, line, symbol),
  check,
  severity,
  file,
  line,
  symbol,
});

function inertField(ctx, { file, line, name, owner, phrase }) {
  const reads = fieldReads(ctx, name);
  const entry = {
    ...base("inert-doc", "medium", file, line, `${owner}.${name}`),
    signal: `the comment on this field says "${phrase}"`,
  };
  if (reads.length > 0) {
    return {
      ...entry,
      evidence: `production code reads .${name} at ${reads
        .slice(0, 3)
        .map((read) => `${read.file}:${read.line}`)
        .join(", ")}`,
      proposal: "none",
      refused: true,
      reason: `the comment says it has no effect but production code reads .${name}; the comment and the code disagree and a reader has to decide which is wrong`,
    };
  }

  const declarations = interfaceDeclarations(ctx, owner);
  const heritage =
    declarations.length > 1 ||
    declarations.some(({ text }) => /\bextends\b/.test(text.split("{")[0])) ||
    isExtended(ctx, owner);
  const verdict = consumerVerdict(ctx, owner, file);
  const evidence = `no production code reads .${name}; ${quoteVerdict(owner, verdict)}`;
  if (verdict.verdict !== "internal-only") {
    return {
      ...entry,
      evidence,
      proposal: "none",
      refused: true,
      reason: `${owner} may be used outside this package, so deleting the field changes a published type; only internal-only clears an edit`,
    };
  }
  if (heritage) {
    return {
      ...entry,
      evidence,
      proposal: "none",
      refused: true,
      reason: `${owner} is declared more than once or takes part in an extends relation, so the field may be reached through another declaration`,
    };
  }
  const mentions = testMentions(ctx, name);
  return {
    ...entry,
    evidence,
    proposal:
      mentions.length === 0
        ? `delete ${name}; no test file names it, so the deletion stands alone`
        : `delete ${name}, and with it the test mentions at ${mentions
            .slice(0, 3)
            .map((mention) => `${mention.file}:${mention.line}`)
            .join(", ")}, which stop compiling once the field is gone`,
    refused: false,
    target: owner,
  };
}

/**
 * A parameter that the repo's lint config marks as deliberately unread, named
 * like an options bag, whose type has fields no production code reads.
 */
function checkUnreadParam(ctx, reportedOwners) {
  const parameter = /\b(\w+)\s*\??:\s*([A-Z]\w*)/g;
  const optionsLike = /options?|opts/i;
  const findings = [];

  for (const [file, source] of productionSources(ctx)) {
    if (!inScope(ctx, file)) {
      continue;
    }
    source.lines.forEach((text, index) => {
      if (isCommentLine(text) || owningInterface(source.lines, index) !== null) {
        return;
      }
      for (const match of text.matchAll(parameter)) {
        const [, name, typeName] = match;
        // A local `const _options: T = ...` is not a parameter.
        if (
          !ctx.ignoreRegExp.test(name) ||
          !optionsLike.test(name) ||
          /\b(?:const|let|var)\b/.test(text.slice(0, match.index))
        ) {
          continue;
        }
        findings.push(unreadParam(ctx, { file, line: index + 1, name, typeName }, reportedOwners));
      }
    });
  }
  return findings;
}

/** The name appears in the file other than as `name: Type` or `name?: Type`. */
const usedAsValue = (ctx, file, name) =>
  new RegExp(`\\b${escapeRegExp(name)}\\b(?!\\s*\\??:)`).test(
    ctx.sources.get(file).code
  );

const occurrences = (text, name) =>
  (text.match(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g")) ?? []).length;

/** Annotations `_name: Type` whose parameter name matches the ignore pattern. */
function ignoredAnnotations(ctx, text, typeName) {
  const annotation = new RegExp(
    `(\\w+)\\s*\\??:\\s*${escapeRegExp(typeName)}\\b`,
    "g"
  );
  return [...text.matchAll(annotation)].filter(([, name]) =>
    ctx.ignoreRegExp.test(name)
  ).length;
}

/**
 * Production lines that name a type, other than its declaration and import or
 * export list entries.
 */
function typeUses(ctx, typeName, declaration) {
  const listEntry = new RegExp(`^\\s*(?:type\\s+)?${escapeRegExp(typeName)},?\\s*$`);
  return wordHits(ctx, typeName, { production: true }).filter(
    (hit) =>
      !(hit.file === declaration.file && hit.line === declaration.line) &&
      !/^\s*import\b/.test(hit.text) &&
      !listEntry.test(hit.text)
  );
}

function unreadParam(ctx, { file, line, name, typeName }, reportedOwners) {
  const declared = interfaceFields(ctx, typeName);
  const fields = declared?.fields ?? [];
  const readFields = fields.filter((field) => fieldReads(ctx, field).length > 0);
  const entry = {
    ...base("unread-param", "low", file, line, name),
    signal: `parameter ${name} matches the ignore pattern ${ctx.ignore.pattern} (${ctx.ignore.source}), so this implementation declares it reads none of ${typeName}`,
  };

  let reason = null;
  let verdict = null;
  let other;
  if (declared === null) {
    reason = `${typeName} is not declared by exactly one readable \`interface\` in this repo, so its fields could not be enumerated`;
  } else if (fields.length === 0) {
    reason = `${typeName} declares no fields, which the empty-options entry for it reports instead`;
  } else if (usedAsValue(ctx, file, name)) {
    reason = `${name} is used as a value in ${file}, so some function reads it; the ignore pattern is not a guarantee`;
  } else if (readFields.length > 0) {
    reason = `${typeName} is live: production code reads .${readFields.join(", .")}, so one function not needing it is not indirection with no consumer`;
  } else if (reportedOwners.has(typeName)) {
    reason = `the same fact as the reported field of ${typeName}; the deletion happens there and removes this parameter's only content`;
  } else if (declared.extendsBase || isExtended(ctx, typeName)) {
    reason = `${typeName} takes part in an extends relation, so removing it changes the shape of a related interface`;
  } else if (
    (other = typeUses(ctx, typeName, declared).find(
      (hit) =>
        occurrences(hit.text, typeName) !==
        ignoredAnnotations(ctx, hit.text, typeName)
    )) !== undefined
  ) {
    reason = `${typeName} is also used at ${other.file}:${other.line}, so the type stays and only unread parameters could go; review that use first`;
  } else {
    verdict = consumerVerdict(ctx, typeName, declared.file);
    if (verdict.verdict !== "internal-only") {
      reason = `${quoteVerdict(typeName, verdict)}; dropping the parameter changes a signature that may be used outside this package, and only internal-only clears an edit`;
    }
  }

  return {
    ...entry,
    evidence:
      reason === null
        ? `${typeName} declares .${fields.join(", .")} and no production code reads any of them; ${quoteVerdict(typeName, verdict)}`
        : reason,
    proposal: reason === null ? `drop the parameter, and ${typeName} with it` : "none",
    refused: reason !== null,
    ...(reason === null ? { target: typeName } : { reason }),
  };
}

/**
 * `interface X {}` used as a parameter type. An empty interface that is not
 * annotated anywhere, or that is declared twice or in an augmentation, is a
 * marker or a merge point and is skipped or refused.
 */
function checkEmptyOptions(ctx) {
  const empty = /^\s*(export\s+)?interface\s+(\w+)\s*\{\s*\}\s*$/;
  const findings = [];

  for (const [file, source] of productionSources(ctx)) {
    if (!inScope(ctx, file)) {
      continue;
    }
    source.lines.forEach((text, index) => {
      const match = empty.exec(text);
      if (match === null) {
        return;
      }
      const name = match[2];
      const annotated = new RegExp(`:\\s*${escapeRegExp(name)}\\b`);
      const uses = new Set(
        wordHits(ctx, name, { production: true })
          .filter((hit) => annotated.test(hit.text))
          .map((hit) => hit.file)
      );
      if (uses.size === 0) {
        return;
      }
      const entry = {
        ...base("empty-options", "low", file, index + 1, name),
        signal: `\`interface ${name} {}\` declares no fields and annotates parameters or fields in ${uses.size} production files`,
      };
      const merged =
        interfaceDeclarations(ctx, name).length > 1 ||
        /^\s*declare\s+(module|global)\b/m.test(source.text);
      const verdict = consumerVerdict(ctx, name, file);
      // `{}` accepts any non-nullish value, so only an optional parameter can
      // lose the type without a change in what callers may pass.
      const optional = new RegExp(`\\w+\\?:\\s*${escapeRegExp(name)}\\b`, "g");
      const other = typeUses(ctx, name, { file, line: index + 1 }).find(
        (hit) => occurrences(hit.text, name) !== (hit.text.match(optional) ?? []).length
      );
      let reason = null;
      if (merged) {
        reason = `${name} is declared more than once or sits in a file with an augmentation, so it may be a merge point`;
      } else if (other !== undefined) {
        reason = `${name} is used other than as an optional parameter at ${other.file}:${other.line}; \`{}\` accepts any non-nullish value, so removing a required parameter or a field type changes what callers may pass`;
      } else if (isExtended(ctx, name)) {
        reason = `${name} is the base of another interface, so removing it changes that interface's shape`;
      } else if (verdict.verdict !== "internal-only") {
        reason = `${quoteVerdict(name, verdict)}; the parameters typed by it are part of a signature that may be used outside this package, and only internal-only clears an edit`;
      }
      findings.push({
        ...entry,
        evidence: reason ?? quoteVerdict(name, verdict),
        proposal: reason === null ? `delete ${name} and the parameters typed by it` : "none",
        refused: reason !== null,
        ...(reason === null ? { target: name } : { reason }),
      });
    });
  }
  return findings;
}

// --- Output ------------------------------------------------------------

function summarize(document) {
  const { counts, findings } = document;
  const ranked = findings
    .filter((finding) => !finding.refused)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.file.localeCompare(b.file) ||
        a.line - b.line
    );
  const lines = [
    `candidates ${counts.candidates}, reported ${counts.reported}, refused ${counts.refused}`,
  ];
  ranked.forEach((finding, i) =>
    lines.push(
      `${i + 1}. [${finding.severity}] ${finding.file}:${finding.line} ${finding.symbol}: ${finding.proposal}`
    )
  );
  findings
    .filter((finding) => finding.refused)
    .slice(0, 10)
    .forEach((finding) =>
      lines.push(
        `refused ${finding.file}:${finding.line} ${finding.symbol}: ${finding.reason}`
      )
    );
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const ctx = makeContext(options);

  const inert = checkInertDoc(ctx);
  const reportedOwners = new Set(
    inert.filter((f) => !f.refused && f.target).map((f) => f.target)
  );
  const candidates = [
    ...inert,
    ...checkUnreadParam(ctx, reportedOwners),
    ...checkEmptyOptions(ctx),
  ];

  const designed = candidates.map(({ target, ...finding }) => {
    if (finding.refused) {
      return finding;
    }
    if (ctx.skipped.length > 0) {
      return {
        ...finding,
        proposal: "none",
        refused: true,
        reason: `${ctx.skipped.length} source files were not scanned (first: ${ctx.skipped[0]}) and may hold a reader; see skippedFiles`,
      };
    }
    const file = ctx.sources.get(finding.file);
    const names = [finding.symbol.split(".").pop(), ...(target ? [target] : [])];
    const argument = file ? designArgument(ctx, finding.file, names) : null;
    return argument === null
      ? finding
      : {
          ...finding,
          evidence: `${finding.evidence}; ${argument.source} argues for this shape: "${argument.quoted}"`,
        };
  });
  // The reader search sees names, not calls: a caller in another package can
  // pass the field in an object literal without naming its type.
  const caveat =
    "; callers that pass this in an object literal without naming the type are not searched, so the type check decides";
  const findings = designed.map((finding) =>
    finding.refused
      ? finding
      : { ...finding, evidence: `${finding.evidence}${caveat}` }
  );

  const reported = findings.filter((finding) => !finding.refused).length;
  const document = {
    tool: "unused-abstraction-scan",
    scope: ctx.scopes.length === 0 ? "." : ctx.scopes.join(" "),
    ignorePattern: ctx.ignore,
    skippedFiles: ctx.skipped,
    counts: {
      candidates: findings.length,
      refused: findings.length - reported,
      reported,
    },
    findings,
  };

  if (options.out === null) {
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  } else {
    writeFileSync(options.out, `${JSON.stringify(document, null, 2)}\n`);
    process.stdout.write(summarize(document));
  }
  process.exitCode = reported > 0 ? 1 : 0;
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
