#!/usr/bin/env node
//
// Candidate finder for unhandled cases, for any language in languages.mjs.
//
// It matches patterns and verifies nothing: every finding is a candidate that
// the model confirms or overturns with the language server, compiler
// diagnostics, or by reading the code. It reads the repository and writes only
// the findings file.
//
// usage: candidates.mjs [--scope <path>]... [--language <name>]... [--out <file>]
//
// Exit codes: 0 no candidates, 1 candidates reported, 2 could not run.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { LANGUAGES } from "./languages.mjs";

const usage = `usage: candidates.mjs [--scope <path>]... [--language <name>]... [--out <file>]

Lists places where a dispatch over a finite set may miss a case, and handlers
that swallow a failure. Matches patterns only; the model verifies each result.
Writes nothing to the repository under review.

Options:
  --scope <path>      Restrict to this subtree. Resolved against the working
                      directory. Repeatable. A scope outside the repository, or
                      one that matches no scanned file, exits 2.
  --language <name>   Restrict to this language entry. Repeatable.
  --out <file>        Write the findings document here. The path must be
                      outside the repository. Default: a new file under the
                      system temp directory. The path is printed to stderr.
  -h, --help          This text.

Languages: ${LANGUAGES.map((language) => language.name).join(", ")}

Exit codes: 0 no candidates, 1 candidates reported, 2 could not run.
`;

const fail = (message) => {
  process.stderr.write(`candidates.mjs: ${message}\n`);
  process.exit(2);
};

const MAX_FILE_BYTES = 1024 * 1024;
const SKIPPED_DIRS = new Set([
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
]);

// ------------------------------------------------------------------ arguments

const scopeArgs = [];
const languageArgs = [];
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
    case "--language":
      languageArgs.push(valueOf(i, "--language"));
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

const unknownLanguages = languageArgs.filter(
  (name) => !LANGUAGES.some((language) => language.name === name)
);
unknownLanguages.length > 0 &&
  fail(`unknown language ${unknownLanguages.join(", ")}\n${usage}`);
const languages =
  languageArgs.length === 0
    ? LANGUAGES
    : LANGUAGES.filter((language) => languageArgs.includes(language.name));
const byExtension = new Map(
  languages.flatMap((language) =>
    language.extensions.map((extension) => [extension, language])
  )
);

// ---------------------------------------------------------------------- paths

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

const scopes = scopeArgs.map((given) => {
  const absolute = resolve(process.cwd(), given);
  const rel = relRoot(absolute).replace(/\/$/, "");
  insideRoot(rel) ||
    fail(`--scope ${given} resolves to ${absolute}, outside the repository ${root}`);
  return { given, rel, matched: 0 };
});

/** The scopes that contain `rel`; every file is in scope when none is given. */
const scopesHolding = (rel) =>
  scopes.filter(
    (scope) =>
      scope.rel === "" || rel === scope.rel || rel.startsWith(`${scope.rel}/`)
  );

// The findings file is the only file this script writes. Real paths are
// compared, so a symlink cannot route the write into the repository.
const out = resolve(
  process.cwd(),
  outFile ??
    join(tmpdir(), `unhandled-case-scan-${process.pid}-${Date.now()}.json`)
);
try {
  const realRoot = realpathSync(root);
  const realParent = realpathSync(dirname(out));
  const target = existsSync(out) ? realpathSync(out) : join(realParent, basename(out));
  [realParent, target].some((path) => insideRoot(posix(relative(realRoot, path)))) &&
    fail(`--out ${out} is inside the repository ${root}; choose a path outside it`);
} catch (error) {
  fail(`--out ${out}: ${error.code ?? error.message}; its directory must exist`);
}

// Test code asserts on failures and builds partial fixtures on purpose.
const isTestPath = (rel) =>
  /(^|\/)(test|tests|__tests__|__mocks__|spec)\//.test(rel) ||
  /[._]((test|spec)s?)\.[^/]+$/.test(rel) ||
  /(^|\/)test_[^/]+$/.test(rel) ||
  /Tests?\.[^/.]+$/.test(rel);

/** Tracked and untracked-but-not-ignored files, or a walk outside git. */
function listFiles() {
  try {
    return execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 }
    )
      .split("\0")
      .filter((path) => path !== "");
  } catch {
    return walk(root).map(relRoot);
  }
}

function walk(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      found.push(join(dir, entry.name));
    } else if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !SKIPPED_DIRS.has(entry.name)
    ) {
      walk(join(dir, entry.name), found);
    }
  }
  return found;
}

// ------------------------------------------------------------------ text work

const lineStarts = (text) => {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    text[i] === "\n" && starts.push(i + 1);
  }
  return starts;
};

const lineAt = (starts, index) => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    starts[mid] <= index ? (low = mid) : (high = mid - 1);
  }
  return low + 1;
};

const oneLine = (text) => text.replace(/\s+/g, " ").trim();

/** Text from the first `{` at or after `from` to its match, or undefined. */
function braceBlock(text, from) {
  const open = text.indexOf("{", from);
  if (open === -1) {
    return undefined;
  }
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    text[i] === "{" && (depth += 1);
    text[i] === "}" && (depth -= 1);
    if (depth === 0) {
      return text.slice(open, i + 1);
    }
  }
  return undefined;
}

/** The lines after `from` that are indented deeper than the line at `from`. */
function indentBlock(text, from) {
  const lines = text.slice(from).split("\n");
  const indent = (line) => line.match(/^[ \t]*/)[0].length;
  const base = indent(lines[0]);
  const body = [];
  for (const line of lines.slice(1)) {
    if (line.trim() !== "" && indent(line) <= base) {
      break;
    }
    body.push(line);
  }
  return body.join("\n");
}

const idFor = (prefix, file, line) =>
  `${prefix}-${file.replace(/[^A-Za-z0-9]/g, "-")}-${line}`;

// ----------------------------------------------------------------------- scan

const findings = [];
const markerCounts = new Map();
const unscanned = new Map();
const skipped = [];
let scanned = 0;
const perLanguage = new Map();

const VERIFY_DISPATCH =
  "add a case to the set in a scratch copy of the file and compile it, or read the language server diagnostics: the build must report the new case here";

const knownExtensions = new Set(LANGUAGES.flatMap((language) => language.extensions));
let testFiles = 0;

for (const file of listFiles()) {
  const rel = posix(file);
  const holding = scopesHolding(rel);
  if (scopes.length > 0 && holding.length === 0) {
    continue;
  }
  const extension = extname(rel);
  const language = byExtension.get(extension);
  if (language === undefined) {
    extension !== "" &&
      !knownExtensions.has(extension) &&
      unscanned.set(extension, (unscanned.get(extension) ?? 0) + 1);
    continue;
  }
  if (isTestPath(rel)) {
    testFiles += 1;
    continue;
  }
  const path = resolve(root, rel);
  let text;
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      skipped.push({ path: rel, reason: "symbolic link" });
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: "larger than 1 MiB" });
      continue;
    }
    text = readFileSync(path, "utf8");
  } catch (error) {
    skipped.push({ path: rel, reason: `unreadable: ${error.code ?? error.message}` });
    continue;
  }
  if (text.includes("\0")) {
    skipped.push({ path: rel, reason: "binary" });
    continue;
  }
  scanned += 1;
  holding.forEach((scope) => (scope.matched += 1));
  perLanguage.set(language.name, (perLanguage.get(language.name) ?? 0) + 1);
  const starts = lineStarts(text);

  for (const marker of language.markers ?? []) {
    const count = [...text.matchAll(marker)].length;
    const key = `${language.name}\t${marker.source}`;
    count > 0 && markerCounts.set(key, (markerCounts.get(key) ?? 0) + count);
  }

  if (language.dispatch !== null && language.dispatch !== undefined) {
    for (const match of text.matchAll(language.dispatch)) {
      const end = match.index + match[0].length;
      const body =
        language.block === "indent"
          ? indentBlock(text, match.index)
          : braceBlock(text, end - 1);
      if (body === undefined) {
        continue;
      }
      const hasCatchAll = language.catchAll.test(body);
      const isCandidate =
        language.mode === "no-default" ? !hasCatchAll : hasCatchAll;
      if (!isCandidate) {
        continue;
      }
      const line = lineAt(starts, match.index);
      const check =
        language.mode === "no-default" ? "dispatch-no-default" : "dispatch-wildcard";
      findings.push({
        id: idFor(check, rel, line),
        check,
        file: rel,
        line,
        language: language.name,
        severity: "medium",
        signal:
          language.mode === "no-default"
            ? `dispatch \`${oneLine(match[0])}\` has no catch-all arm`
            : `dispatch \`${oneLine(match[0])}\` has a catch-all arm that hides new cases`,
        evidence: "text",
        refused: false,
        source: "script",
        verify: VERIFY_DISPATCH,
        closeWith: language.closeWith,
      });
    }
  }

  const handlerFinding = (index, severity, signal, refused) => {
    const line = lineAt(starts, index);
    return {
      id: idFor("empty-handler", rel, line),
      check: "empty-handler",
      file: rel,
      line,
      language: language.name,
      severity,
      signal,
      evidence: "text",
      refused,
      source: "script",
    };
  };
  const seen = new Set();
  for (const pattern of language.commented ?? []) {
    for (const match of text.matchAll(pattern)) {
      seen.add(lineAt(starts, match.index));
      findings.push({
        ...handlerFinding(match.index, "low", "handler holds only a comment", true),
        reason: "the comment states why the failure is ignored",
      });
    }
  }
  for (const { pattern, severity, signal } of language.empty ?? []) {
    for (const match of text.matchAll(pattern)) {
      const line = lineAt(starts, match.index);
      // Two patterns can match the same handler.
      if (!seen.has(line)) {
        seen.add(line);
        findings.push(handlerFinding(match.index, severity, signal, false));
      }
    }
  }
}

// -------------------------------------------------------------------- results

const unmatched = scopes.filter((scope) => scope.matched === 0);
unmatched.length > 0 &&
  fail(
    `--scope ${unmatched.map((scope) => scope.given).join(", ")} matched no file with a language entry; scopes are ${scopes.map((scope) => scope.rel).join(", ")} relative to ${root}`
  );
scanned === 0 &&
  fail(`no file with a language entry found under ${root}; no table entry covers: ${[...unscanned.keys()].join(" ") || "any extension"}`);

const markers = [...markerCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([key, uses]) => {
    const [language, pattern] = key.split("\t");
    return { language, pattern, uses };
  });

for (const finding of findings) {
  if (finding.refused) {
    finding.proposal = "none, because this finding is refused";
  } else if (finding.check === "empty-handler") {
    finding.proposal =
      "act on the failure, or write a comment that states why it is ignored";
    finding.verify =
      "read the callers: confirm no caller depends on the failure being reported";
  } else {
    const marker = markers.find((m) => m.language === finding.language);
    finding.proposal =
      marker !== undefined
        ? `close the dispatch the way this repository does (marker pattern ${marker.pattern}), or ${finding.closeWith}`
        : finding.closeWith;
  }
  delete finding.closeWith;
}

const RANK = { high: 0, medium: 1, low: 2 };
findings.sort(
  (a, b) =>
    Number(a.refused) - Number(b.refused) ||
    RANK[a.severity] - RANK[b.severity] ||
    a.file.localeCompare(b.file) ||
    a.line - b.line
);
const reported = findings.filter((finding) => !finding.refused);

const document = {
  tool: "unhandled-case-scan",
  root,
  scope:
    scopes.length === 0
      ? "every file with a language entry"
      : scopes.map((scope) => scope.rel).join(", "),
  generated_at: new Date().toISOString(),
  languages_scanned: Object.fromEntries(perLanguage),
  extensions_without_entry: Object.fromEntries(
    [...unscanned.entries()].sort((a, b) => b[1] - a[1])
  ),
  closing_markers: markers,
  skipped,
  excluded_test_files: testFiles,
  counts: {
    files: scanned,
    candidates: findings.length,
    refused: findings.length - reported.length,
    reported: reported.length,
  },
  findings,
};

try {
  writeFileSync(out, JSON.stringify(document, null, 2) + "\n");
} catch (error) {
  fail(`cannot write ${out}: ${error.code ?? error.message}`);
}

process.stderr.write(
  [
    `candidates.mjs: ${scanned} files, ${findings.length} candidates (${findings.length - reported.length} commented), written to ${out}`,
    markers.length > 0
      ? `closing markers: ${markers.map((m) => `${m.language} ${m.pattern} (${m.uses})`).join(", ")}`
      : "closing markers: none found",
    ...skipped.map((entry) => `skipped ${entry.path}: ${entry.reason}`),
    ...reported.map(
      (finding) =>
        `${finding.severity} ${finding.file}:${finding.line} ${finding.signal}`
    ),
  ].join("\n") + "\n"
);

process.exitCode = reported.length > 0 ? 1 : 0;
