#!/usr/bin/env node
// Language-neutral, text-based helpers for the single-use-abstraction-scan
// skill. No parser and no packages. A helper lists declarations from a table
// of per-language forms, counts textual references, and flags declarations
// with exactly one production reference. It does not decide anything: the
// model confirms every candidate by reading the code, and takes semantic facts
// (references, implementations, call hierarchy) from a language server when
// one exists.
//
// Subcommands (all print JSON, except `report`):
//   candidates   declarations with one production reference, or one implementer
//   refs NAME    word matches of NAME, split into production and test files
//   verdict SYMBOL FILE   whether SYMBOL leaves its package
//   forms        the declaration forms the table knows
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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const TOOL = "single-use-abstraction-scan";

const usage = `usage: scan.mjs <command> [options]

Commands:
  candidates                    Declarations with exactly one production
                                reference, and interfaces with one implementer.
  refs <name>                   Word matches of <name> outside comments.
  verdict <symbol> <file>       Consumer verdict for a symbol declared in file.
  forms                         Declaration forms by language.
  diff-scope [--base <ref>] [--working-tree]
                                The files a change set touched, as scope paths.
  report <findings.json|-> [--out <file>] [--wire]
                                Validate findings (- reads stdin), print a
                                ranked summary, and write the result to <file>
                                when given. <file> must be outside the
                                repository and not a symlink. --wire prints
                                the review-lens wire format as a JSON array
                                on stdout and the headline on stderr.

Options for candidates and refs:
  --scope <path>   candidates: only declarations under this path (references
                   are always counted in the whole tree). refs: only matches
                   under this path. Repeatable.
  --ext <.ext>     Treat this extension as source. Repeatable.
Options for candidates:
  --kind <kind>    Only this kind: function, method, class, interface,
                   type-alias. Repeatable.
  --decl <regex>   Add a declaration form for any language. The regex needs a
                   named group (?<name>...) and is matched per line.
  --limit <n>      Print at most n candidates (default 500).
  --clean          Only candidates with no gate hint. Without it, candidates
                   with no hint come first, then the smallest bodies.
  --diff           Only declarations in the files a change touched, and
                   declarations whose production use count fell to one. Uses
                   are still counted in the whole tree. Needs a git repository.
  --base <ref>     Base of the change (default origin/main, then origin/master,
                   main, master). Merge base is used. For --diff and diff-scope.
  --working-tree   Include uncommitted and untracked files in the change.
Options for verdict:
  --offline              Skip the gh search.
  --assume-unpublished   Treat every package as unpublished.
`;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_BODY_LINES = 2000;
// Declaration regexes backtrack. A longer line is minified or generated code.
const MAX_DECLARATION_LINE = 2000;
// A body this long makes the caller much longer when inlined: a hint for
// `named-intent`, never a verdict.
const NAMED_INTENT_LINES = 8;
const MAX_GH_QUERIES = 10;
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "coverage",
  ".next", ".turbo", ".claude", "vendor", "__pycache__", ".venv", "venv",
]);
const QUIET_DIRS = new Set([".git", "node_modules", ".claude", "__pycache__"]);
const MANIFESTS = [
  "package.json", "Cargo.toml", "pyproject.toml", "setup.py", "setup.cfg",
  "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Project.toml",
];
const DOC_EXTENSIONS = new Set(["md", "mdx", "rst", "txt", "adoc"]);
const CONFIG_EXTENSIONS = new Set(
  `json yml yaml toml cfg ini xml gradle cmake mk sh bash zsh properties`.split(/\s+/)
);
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const EVIDENCE_SOURCES = new Set(["lsp", "text", "read"]);
const JUDGMENTS = new Set(["confirmed", "downgraded", "dropped"]);
const CHECKS = new Set(["single-use", "single-impl", "forwarder", "reviewer"]);
const REFUSAL_IDS = new Set([
  "seam", "public-api", "named-intent", "multi-site", "dynamic",
  "has-own-tests", "recursive", "override-or-interface-contract",
]);
const CLEARED_VERDICTS = new Set(["internal-only", "not-exported", "user-stated-internal"]);
const ALL_VERDICTS = new Set([
  ...CLEARED_VERDICTS, "exported-with-hits", "exported-no-hits", "unknown",
]);
const SKIP_NAMES = new Set(["main"]);

function fail(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toPosix = (path) => path.split(sep).join("/");
const extOf = (file) => (file.includes(".") ? file.split(".").pop() : "");
const indentOf = (line) => /^\s*/.exec(line)[0].length;

// --- language table ------------------------------------------------------
// Each row is one declaration form. `kind` is function, class, interface, or
// type-alias; a `(?<kind>...)` group in the regex overrides it. `body` says
// how a body ends: brace, indent, end, or none (one line).

const KEYWORDS = new Set(
  `if for while switch catch function return else with do try constructor new
   throw yield assert case goto synchronized`.split(/\s+/)
);
const JAVA_MODS =
  "(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed|strictfp)\\s+)*";
const JS_ID = "[A-Za-z_$][\\w$]*";
const RUST_VIS = "(?:pub(?:\\([^)]*\\))?\\s+)?";

const LANGUAGES = [
  {
    id: "typescript-javascript",
    exts: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    comment: "slash",
    identChars: "$",
    rows: [
      { kind: "function", body: "brace", re: new RegExp(`^\\s*(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(?<name>${JS_ID})`) },
      { kind: "function", body: "brace", re: new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+(?<name>${JS_ID})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:\\([^)]*\\)|${JS_ID})\\s*(?::\\s*[^=]+?)?\\s*=>`) },
      { kind: "class", body: "brace", re: new RegExp(`^\\s*(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:abstract\\s+)?(?<kind>class)\\s+(?<name>${JS_ID})`) },
      { kind: "interface", body: "brace", re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?<kind>interface)\\s+(?<name>${JS_ID})`) },
      { kind: "type-alias", body: "none", re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?type\\s+(?<name>${JS_ID})\\s*(?:<[^=]*>)?\\s*=`) },
      { kind: "function", body: "brace", exclude: KEYWORDS, re: new RegExp(`^\\s+(?:(?:public|private|protected|static|async|override|readonly|abstract)\\s+)*(?:get\\s+|set\\s+)?(?<name>${JS_ID})\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)\\s*(?::\\s*[^{;=]+)?\\{\\s*$`) },
    ],
    skipFile: (file) => file.endsWith(".d.ts"),
    visibility: ({ line }) =>
      /^\s*export\b/.test(line)
        ? "exported"
        : /\b(?:private)\b|^\s*#/.test(line)          ? "private"
          : /^\s/.test(line) && !/^\s*(?:const|let|var|function|async|class|interface|type)\b/.test(line)
            ? "unknown"
            : "private",
  },
  {
    id: "python",
    exts: ["py"],
    comment: "hash",
    rows: [
      { kind: "function", body: "indent", re: /^\s*(?:async\s+)?def\s+(?<name>[A-Za-z_]\w*)\s*\(/ },
      { kind: "class", body: "indent", re: /^\s*(?<kind>class)\s+(?<name>[A-Za-z_]\w*)\s*[(:]/ },
    ],
    skipName: (name) => /^__\w+__$/.test(name),
    visibility: ({ name }) => (name.startsWith("_") ? "private" : "exported"),
  },
  {
    id: "go",
    exts: ["go"],
    comment: "slash",
    rows: [
      { kind: "function", body: "brace", re: /^func\s+(?:\((?<recv>[^)]*)\)\s*)?(?<name>[A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\(/ },
      { kind: "interface", body: "brace", re: /^\s*type\s+(?<name>[A-Za-z_]\w*)\s+(?:\[[^\]]*\]\s+)?(?<kind>interface)\b/ },
      { kind: "class", body: "brace", re: /^\s*type\s+(?<name>[A-Za-z_]\w*)\s+(?:\[[^\]]*\]\s+)?(?<kind>struct)\b/ },
      { kind: "type-alias", body: "none", re: /^\s*type\s+(?<name>[A-Za-z_]\w*)\s+(?:=\s*)?(?!struct\b|interface\b)[^\s(]/ },
    ],
    skipName: (name) => name === "init",
    visibility: ({ name }) => (/^\p{Lu}/u.test(name) ? "exported" : "private"),
  },
  {
    id: "rust",
    exts: ["rs"],
    comment: "slash",
    rows: [
      { kind: "function", body: "brace", re: new RegExp(`^\\s*${RUST_VIS}(?:const\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:extern\\s+"[^"]*"\\s+)?fn\\s+(?<name>[A-Za-z_]\\w*)`) },
      { kind: "class", body: "brace", re: new RegExp(`^\\s*${RUST_VIS}(?<kind>struct|enum)\\s+(?<name>[A-Za-z_]\\w*)`) },
      { kind: "interface", body: "brace", re: new RegExp(`^\\s*${RUST_VIS}(?:unsafe\\s+)?(?<kind>trait)\\s+(?<name>[A-Za-z_]\\w*)`) },
      { kind: "type-alias", body: "none", re: new RegExp(`^\\s*${RUST_VIS}type\\s+(?<name>[A-Za-z_]\\w*)(?:<[^=]*>)?\\s*=`) },
    ],
    visibility: ({ line }) =>
      /^\s*pub\s/.test(line) ? "exported" : "private",
  },
  {
    id: "java",
    exts: ["java"],
    comment: "slash",
    rows: [
      { kind: "class", body: "brace", re: new RegExp(`^\\s*${JAVA_MODS}(?<kind>class|interface|enum|record)\\s+(?<name>[A-Za-z_$][\\w$]*)`) },
      {
        kind: "function",
        body: "brace",
        exclude: KEYWORDS,
        re: new RegExp(`^\\s+${JAVA_MODS}(?:(?:synchronized|native|default)\\s+)*(?:<[^>]+>\\s+)?(?<type>[\\w$][\\w$<>\\[\\],.? ]*?)\\s+(?<name>[A-Za-z_$][\\w$]*)\\s*\\([^)]*\\)\\s*(?:throws\\s+[\\w.,\\s]+)?\\s*(?:\\{\\s*|;\\s*)$`),
        typeExclude: KEYWORDS,
      },
    ],
    visibility: ({ line }) =>
      /\bprivate\b/.test(line) ? "private" : /\b(?:public|protected)\b/.test(line) ? "exported" : "unknown",
  },
  {
    id: "kotlin",
    exts: ["kt", "kts"],
    comment: "slash",
    rows: [
      { kind: "function", body: "brace", re: /^\s*(?:(?:public|private|protected|internal|open|abstract|override|suspend|inline|operator|infix|tailrec|external)\s+)*fun\s+(?:<[^>]+>\s+)?(?:[\w.<>?]+\.)?(?<name>[A-Za-z_]\w*)\s*\(/ },
      { kind: "class", body: "brace", re: /^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|enum|annotation|inner|value)\s+)*(?<kind>class|interface|object)\s+(?<name>[A-Za-z_]\w*)/ },
      { kind: "type-alias", body: "none", re: /^\s*(?:(?:public|private|internal)\s+)?typealias\s+(?<name>[A-Za-z_]\w*)/ },
    ],
    visibility: ({ line }) => (/\b(?:private|internal)\b/.test(line) ? "private" : "exported"),
  },
  {
    id: "c-cpp",
    exts: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh"],
    comment: "slash",
    prototypes: true,
    rows: [
      {
        kind: "function",
        body: "brace",
        exclude: KEYWORDS,
        re: /^(?!\s*(?:return|else|if|for|while|switch|case|typedef|using|template|namespace|extern)\b)[A-Za-z_][\w:<>,*&\s]*?[\s*&](?:[\w:]*::)?~?(?<name>[A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?(?:\{\s*)?$/,
      },
      { kind: "class", body: "brace", re: /^\s*(?:typedef\s+)?(?<kind>class|struct|union|enum(?:\s+class)?)\s+(?:[A-Z_]+\s+)?(?<name>[A-Za-z_]\w*)\s*(?:final\s*)?(?::[^{;]*)?\{?\s*$/ },
      { kind: "type-alias", body: "none", re: /^\s*using\s+(?<name>[A-Za-z_]\w*)\s*=/ },
    ],
    visibility: ({ line, file }) =>
      /^\s*static\b/.test(line) ? "private" : /\.(?:h|hpp|hh)$/.test(file) ? "exported" : "unknown",
  },
  {
    id: "julia",
    exts: ["jl"],
    comment: "hash",
    identSuffix: "!",
    rows: [
      { kind: "function", body: "end", re: /^\s*function\s+(?<name>[A-Za-z_]\w*!?)\s*[({]/ },
      { kind: "function", body: "none", re: /^(?<name>[A-Za-z_]\w*!?)\s*(?:\{[^}]*\})?\([^)]*\)\s*(?:::\s*\S+\s*)?=(?!=)/ },
      { kind: "class", body: "end", re: /^\s*(?:mutable\s+)?(?<kind>struct)\s+(?<name>[A-Za-z_]\w*)/ },
      { kind: "interface", body: "none", re: /^\s*abstract\s+type\s+(?<name>[A-Za-z_]\w*)/ },
    ],
    visibility: ({ name, exportedNames }) => (exportedNames.has(name) ? "exported" : "unknown"),
  },
];

const LANGUAGE_OF = new Map(
  LANGUAGES.flatMap((language) => language.exts.map((ext) => [ext, language]))
);
const EXTRA_SOURCE_EXTENSIONS = `scala cs swift rb php lua ex exs erl hs ml dart zig`.split(/\s+/);

const COMMENT_PATTERNS = {
  slash: /^\s*(\/\/|\/\*|\*)/,
  hash: /^\s*(#|"""|''')/,
  other: /^\s*(\/\/|\/\*|\*|#|--|;|%)/,
};
const isCommentLine = (line, language) =>
  COMMENT_PATTERNS[language?.comment ?? "other"].test(line);

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
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      // A placeholder entry records an excluded tree for `excludedDirs`.
      SKIP_DIRS.has(entry.name) ? names.push(`${path}/.excluded`) : names.push(...walk(root, path));
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
    if (arg.startsWith("--") && valueFlags.includes(arg.slice(2))) {
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

function repoRoot() {
  const cwd = process.cwd();
  const top = tryExec("git", ["rev-parse", "--show-toplevel"], cwd);
  return { cwd, top: top === null ? null : resolve(top.trim()) };
}

function makeSource(file, lines) {
  const language = LANGUAGE_OF.get(extOf(file)) ?? null;
  return {
    lines,
    language,
    test: isTestFile(file),
    code: lines.map((line) => (isCommentLine(line, language) ? "" : line)),
  };
}

/**
 * The tree: repo-relative paths (git's view when available, so ignore files
 * apply), the source files loaded once, and the small docs and config files
 * that may name a symbol. A symlink is never followed. A link to a listed file
 * inside the tree is ignored, because the target is scanned as itself. Any
 * other source file that cannot be read goes in `skipped`: it may hold a use.
 */
function loadTree(extraExtensions) {
  const { cwd, top } = repoRoot();
  const root = top ?? cwd;
  const listed =
    top === null
      ? null
      : tryExec("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
  const all = listed === null ? walk(root) : listed.split("\0").filter(Boolean);
  const excludedDirs = new Set();
  // Files that git ignores are not scanned. They may hold a use, so they are
  // reported like the excluded trees.
  const ignored =
    top === null
      ? null
      : tryExec("git", ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], root);
  for (const name of ignored?.split("\0").filter(Boolean) ?? []) {
    const parts = name.replace(/\/$/, "").split("/");
    const quiet = parts.some((part) => QUIET_DIRS.has(part) || SKIP_DIRS.has(part));
    const source = name.endsWith("/") || LANGUAGE_OF.has(extOf(name)) || EXTRA_SOURCE_EXTENSIONS.includes(extOf(name));
    quiet || !source || excludedDirs.add(name.replace(/\/$/, ""));
  }
  for (const name of all) {
    const parts = name.split("/");
    const at = parts.findIndex((part) => SKIP_DIRS.has(part));
    at !== -1 && !QUIET_DIRS.has(parts[at]) && excludedDirs.add(parts.slice(0, at + 1).join("/"));
  }
  const paths = all.filter((name) => !name.split("/").some((part) => SKIP_DIRS.has(part))).sort();
  const pathSet = new Set(paths);
  const extensions = new Set([
    ...LANGUAGE_OF.keys(),
    ...EXTRA_SOURCE_EXTENSIONS,
    ...extraExtensions.map((ext) => ext.replace(/^\./, "")),
  ]);
  const rootReal = realpathSync(root);
  const sources = new Map();
  const texts = new Map();
  const skipped = [];

  const read = (file, limit) => {
    const stat = lstatSync(join(root, file));
    if (stat.isSymbolicLink()) {
      const target = realpathSync(join(root, file));
      pathSet.has(toPosix(relative(rootReal, target))) || skipped.push(file);
      return null;
    }
    if (!stat.isFile() || stat.size > limit) {
      stat.isFile() && skipped.push(file);
      return null;
    }
    const text = readFileSync(join(root, file), "utf8");
    return text.includes("\0") ? null : text.split(/\r?\n/);
  };

  for (const file of paths) {
    const ext = extOf(file);
    const name = basename(file);
    const isSource = extensions.has(ext);
    const isText =
      !isSource &&
      (DOC_EXTENSIONS.has(ext) || CONFIG_EXTENSIONS.has(ext) || name === "Makefile" || name === "Dockerfile") &&
      !/(^|\/)(package-lock\.json|[^/]*\.lock|pnpm-lock\.yaml)$|\.min\./.test(file);
    if (!isSource && !isText) {
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
      const lines = read(file, isSource ? MAX_FILE_BYTES : MAX_TEXT_BYTES);
      if (lines === null) {
        continue;
      }
      if (isSource) {
        sources.set(file, makeSource(file, lines));
      } else {
        texts.set(file, { lines, doc: DOC_EXTENSIONS.has(ext) });
      }
    } catch {
      existsSync(join(root, file)) && isSource && skipped.push(file);
    }
  }
  return { root, paths, sources, texts, extensions, skipped, excludedDirs: [...excludedDirs].sort() };
}

/** What a run could not see, repeated in every command's output. */
const meta = (tree) => ({ skippedFiles: tree.skipped, excludedDirs: tree.excludedDirs });

function scopeFilter(root, scopeArgs) {
  const scopes = scopeArgs.map((scope) => {
    const rel = toPosix(relative(root, resolve(process.cwd(), scope)));
    (rel === ".." || rel.startsWith("../")) && fail(`scope ${scope} is outside ${root}`);
    return rel.replace(/\/+$/, "");
  });
  return (file) =>
    scopes.length === 0 || scopes.some((s) => s === "" || file === s || file.startsWith(`${s}/`));
}

const wordPattern = (name) => new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`);

function tokenizer(language) {
  const extra = escapeRegExp(language?.identChars ?? "");
  const suffix = language?.identSuffix ? `${escapeRegExp(language.identSuffix)}?` : "";
  return new RegExp(`[\\p{L}_${extra}][\\p{L}\\p{N}_${extra}]*${suffix}`, "gu");
}

// --- declarations --------------------------------------------------------

const KIND_OF_KEYWORD = {
  interface: "interface", trait: "interface", class: "class", struct: "class",
  enum: "class", record: "class", object: "class", union: "class",
};

function kindFromGroup(word) {
  return KIND_OF_KEYWORD[word.split(/\s+/)[0]] ?? null;
}

/** The nearest earlier line that is indented less than `index`. */
function enclosingLine(lines, index) {
  const indent = indentOf(lines[index]);
  if (indent === 0) {
    return null;
  }
  for (let i = index - 1; i >= 0 && index - i < 400; i -= 1) {
    if (lines[i].trim() !== "" && indentOf(lines[i]) < indent) {
      return lines[i].trim().slice(0, 100);
    }
  }
  return null;
}

const stripStrings = (text) =>
  text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""').replace(/\/\/.*$/, "");

/**
 * Last line of the declaration that starts at `index`, and for brace bodies
 * the position of the brace that opens the body.
 */
function bodyEnd(lines, index, body) {
  const done = (end, open = null, closeCol = Infinity) => ({ end, open, closeCol });
  const indent = indentOf(lines[index]);
  const limit = Math.min(lines.length, index + MAX_BODY_LINES);
  if (body === "none") {
    return done(index);
  }
  if (body === "indent") {
    let signature = index;
    while (signature < limit - 1 && signature - index < 20 && !/:\s*(#.*)?$/.test(lines[signature])) {
      signature += 1;
    }
    let end = signature;
    for (let k = signature + 1; k < limit; k += 1) {
      if (lines[k].trim() === "") {
        continue;
      }
      if (indentOf(lines[k]) <= indent) {
        break;
      }
      end = k;
    }
    return done(end);
  }
  if (body === "end") {
    for (let k = index + 1; k < limit; k += 1) {
      if (indentOf(lines[k]) === indent && /^\s*end\b/.test(lines[k])) {
        return done(k);
      }
    }
    return done(index);
  }
  let depth = 0;
  let parens = 0;
  let opened = false;
  let open = null;
  for (let j = index; j < limit; j += 1) {
    const line = lines[j];
    if (j > index && !opened && line.trim() !== "" && indentOf(line) <= indent && !/^\s*[)\]{}:=]|^\s*->/.test(line)) {
      return done(j - 1);
    }
    const text = stripStrings(line);
    for (let c = 0; c < text.length; c += 1) {
      const ch = text[c];
      if (ch === "(") {
        parens += 1;
      } else if (ch === ")") {
        parens -= 1;
      } else if (ch === "{" && parens <= 0) {
        depth += 1;
        opened || (open = { line: j, col: c });
        opened = true;
      } else if (ch === "}" && parens <= 0) {
        depth -= 1;
        // A return type such as `: { a: number } {` closes once before the body opens.
        if (opened && depth <= 0 && !/\{\s*$/.test(text.slice(c + 1))) {
          return done(j, open, c);
        }
        depth <= 0 && (opened = false);
      }
    }
    if (!opened && /;\s*$/.test(text)) {
      return done(j);
    }
  }
  return done(index);
}

/** Statement lines inside a declaration, without its signature or closers. */
function bodyStatements(lines, index, { end, open }, language) {
  let inner;
  if (open !== null) {
    const text = lines.slice(open.line, end + 1).join("\n");
    const close = text.lastIndexOf("}");
    inner = text.slice(open.col + 1, close < 0 ? undefined : close);
  } else if (end === index) {
    const expression = /(?:=>|\)\s*(?::\s*[^=]+)?=)\s*(.+?);?\s*$/.exec(lines[index]);
    inner = expression === null ? "" : expression[1];
  } else {
    inner = lines.slice(index + 1, end + 1).join("\n");
  }
  return inner
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !isCommentLine(line, language) && !/^[)\]}]+;?,?$|^end$/.test(line));
}

function forwardsTo(statements, name) {
  if (statements.length !== 1) {
    return false;
  }
  const call = /^(?:(?:return|await|yield)\s+)*([A-Za-z_$][\w$.:>-]*)\s*\(.*\)\s*;?$/.exec(statements[0]);
  return call !== null && call[1].split(/[.:>-]+/).pop() !== name;
}

/** Declarations of every file, found by the language table. */
function findDeclarations(tree, inScope, options) {
  const custom = options.decl.map((source) => {
    try {
      return { kind: "function", body: "brace", re: new RegExp(source) };
    } catch {
      return fail(`invalid --decl regex ${source}`);
    }
  });
  const found = [];
  for (const [file, source] of tree.sources) {
    const { lines, code, language, test } = source;
    if (test || language?.skipFile?.(file)) {
      continue;
    }
    const rows = [
      ...(language?.rows ?? []).map((row, i) => ({ row, form: `${language.id}/${i}` })),
      ...custom.map((row, i) => ({ row, form: `custom/${i}` })),
    ];
    if (rows.length === 0) {
      continue;
    }
    // The `d` flag gives the position of the name group.
    const compiled = rows.map(({ row, form }) => ({ row, form, re: new RegExp(row.re.source, `${row.re.flags.replace("d", "")}d`) }));
    code.forEach((line, index) => {
      if (line === "" || line.length > MAX_DECLARATION_LINE) {
        return;
      }
      for (const { row, form, re } of compiled) {
        const match = re.exec(line);
        const name = match?.groups?.name;
        if (name === undefined || SKIP_NAMES.has(name) || row.exclude?.has(name) || language?.skipName?.(name)) {
          continue;
        }
        if (row.typeExclude && match.groups.type.split(/\s+/).some((word) => row.typeExclude.has(word))) {
          continue;
        }
        const enclosing = enclosingLine(lines, index);
        let kind = (match.groups.kind && kindFromGroup(match.groups.kind)) || row.kind;
        if (kind === "function" && (match.groups.recv !== undefined || /\b(?:class|interface|impl|trait|struct|object|enum|record)\b/.test(enclosing ?? ""))) {
          kind = "method";
        }
        const { end, open, closeCol } = bodyEnd(lines, index, row.body);
        const [nameStart] = match.indices.groups.name;
        found.push({
          file, index, name, kind, language, form, enclosing, end, open, closeCol, col: nameStart, inScope: inScope(file),
        });
        return;
      }
    });
  }
  return found;
}

// --- reference index -----------------------------------------------------

const IMPORT_START =
  /^\s*(?:(?:pub(?:\([^)]*\))?\s+)?use\b|import\b|from\s+[\w.]+\s+import\b|using\b|#\s*include\b|export\s+(?:type\s+)?(?=[{*]))/;
const REEXPORT_START = /^\s*(?:pub(?:\([^)]*\))?\s+use\b|export\s+(?:type\s+)?(?=[{*]))/;
const PROTOTYPE = /^\s*(?!(?:return|else|throw|delete|new|goto|case|do|co_return|co_yield)\b)(?:[A-Za-z_][\w:<>,*&]*\s+)+[*&]?(?:[\w:]*::)?[A-Za-z_]\w*\s*\([^=]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?(?:=\s*0\s*)?;\s*$/;

/**
 * Every occurrence of a name in `wanted`, as {file, line, col, test, shape}.
 * Shape: code, quoted, import, reexport, prototype. A multi-line import list
 * is an import, so a name listed there is not a use. Julia `export` and
 * `public` lines also fill `exportedNames`.
 */
function indexTokens(tree, wanted) {
  const hits = new Map();
  const exportedNames = new Set();
  const add = (name, hit) => {
    hits.has(name) || hits.set(name, []);
    hits.get(name).push(hit);
  };
  for (const [file, { code, language, test }] of tree.sources) {
    const token = tokenizer(language);
    let block = null;
    code.forEach((line, index) => {
      if (line === "") {
        return;
      }
      let shape = "code";
      if (block !== null) {
        shape = block;
        /[})]/.test(line) && (block = null);
      } else if (IMPORT_START.test(line)) {
        shape = REEXPORT_START.test(line) ? "reexport" : "import";
        /[{(]\s*$/.test(line) && (block = shape);
      } else if (language?.id === "julia" && /^\s*(?:export|public)\s/.test(line)) {
        shape = "reexport";
        for (const [name] of line.matchAll(token)) {
          exportedNames.add(name);
        }
      } else if (language?.prototypes && line.length <= MAX_DECLARATION_LINE && PROTOTYPE.test(line)) {
        shape = "prototype";
      }
      for (const match of line.matchAll(token)) {
        if (!wanted.has(match[0])) {
          continue;
        }
        const before = line[match.index - 1];
        const after = line[match.index + match[0].length];
        const quoted = shape === "code" && (before === '"' || before === "'" || before === "`") && after === before;
        add(match[0], { file, line: index, col: match.index, test, shape: quoted ? "quoted" : shape });
      }
    });
  }
  return { hits, exportedNames };
}

function implementerPattern(name) {
  const n = `(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`;
  return new RegExp(
    [
      `\\b(?:class|interface)\\b[^{;=]*\\b(?:implements|extends|inherits)\\b[^{;]*${n}`,
      `\\bimpl(?:<[^>]*>)?\\s+(?:[\\w:]+::)?${n}(?:<[^>]*>)?\\s+for\\b`,
      `\\bclass\\s+\\w+(?:<[^>]*>)?(?:\\([^)]*\\))?\\s*:\\s*[^{=]*${n}`,
      `\\bclass\\s+\\w+\\s*\\([^)]*${n}[^)]*\\)\\s*:`,
      `\\b(?:class|struct)\\s+\\w+\\s*(?:final\\s*)?:\\s*[^{;]*${n}`,
      `\\bstruct\\s+\\w+(?:\\{[^}]*\\})?\\s*<:\\s*${n}`,
      `\\babstract\\s+type\\s+\\w+\\s*<:\\s*${n}`,
    ].join("|")
  );
}

const LOOP_WORDS = /\b(?:for|while|foreach|loop|each|map|forEach|filter|reduce|flatMap|lambda)\b|=>|(?:\(|,|=)\s*function\b/;

/** Whether an ancestor of the line looks like a loop or a callback. */
function insideLoopOrCallback(lines, index) {
  if (LOOP_WORDS.test(lines[index].replace(/^\s+/, ""))) {
    return true;
  }
  let indent = indentOf(lines[index]);
  for (let i = index - 1; i >= 0 && index - i < 200 && indent > 0; i -= 1) {
    if (lines[i].trim() !== "" && indentOf(lines[i]) < indent) {
      indent = indentOf(lines[i]);
      if (LOOP_WORDS.test(lines[i])) {
        return true;
      }
    }
  }
  return false;
}

const hasDocComment = (lines, index) => {
  const above = lines[index - 1]?.trim() ?? "";
  return /^(\/\*\*|\*\/|\/\/\/|\/\/|#|"""|\*)/.test(above);
};

const isDecoratedLine = (lines, index) =>
  /^\s*(?:@\w|#\[|\[\w+[\](])/.test(lines[index - 1] ?? "");

const textLines = (tree, names) => {
  const mentions = new Map();
  for (const [file, { lines, doc }] of tree.texts) {
    lines.forEach((line, index) => {
      for (const [word] of line.matchAll(/[\p{L}_][\p{L}\p{N}_]*/gu)) {
        if (names.has(word)) {
          mentions.has(word) || mentions.set(word, []);
          mentions.get(word).push({ file, line: index + 1, text: line.trim().slice(0, 160), doc });
        }
      }
    });
  }
  return mentions;
};

// --- candidates ----------------------------------------------------------

/**
 * Declarations with one production use, or interfaces with one implementer.
 * A name declared more than once shares its uses between the declarations, so
 * it is listed as ambiguous and not flagged.
 */
function flagCandidates(tree, byName, hits, options) {
  const ambiguous = [];
  const flagged = [];
  // Production use count of every name that has one declaration.
  const counts = new Map();
  for (const [name, group] of byName) {
    if (group.length > 1) {
      group.some((d) => d.inScope) &&
        ambiguous.push({ name, declarations: group.map((d) => `${d.file}:${d.index + 1}`) });
      continue;
    }
    const [declaration] = group;
    if (!declaration.inScope || (options.kind.length > 0 && !options.kind.includes(declaration.kind))) {
      continue;
    }
    const { file, index, end, kind } = declaration;
    const source = tree.sources.get(file);
    const all = hits.get(name) ?? [];
    const own = (hit) => hit.file === file && hit.line === index && hit.col === declaration.col;
    const inBody = (hit) =>
      hit.file === file &&
      hit.line >= index &&
      hit.line <= end &&
      (hit.line !== index || hit.col > declaration.col) &&
      (hit.line !== end || hit.col <= declaration.closeCol);
    const others = all.filter((hit) => !own(hit));
    const selfReferences = others.filter((hit) => hit.shape === "code" && inBody(hit)).length;
    const outside = others.filter((hit) => !inBody(hit));
    const production = outside.filter((hit) => hit.shape === "code" && !hit.test);
    counts.set(name, production.length);
    const testUses = outside.filter((hit) => hit.shape === "code" && hit.test);
    const quoted = outside.filter((hit) => hit.shape === "quoted");
    const reexports = outside.filter((hit) => hit.shape === "reexport");
    const imports = outside.filter((hit) => hit.shape === "import" || hit.shape === "reexport");

    let implementers = [];
    if (kind === "interface") {
      const pattern = implementerPattern(name);
      implementers = production.filter((hit) => pattern.test(tree.sources.get(hit.file).code[hit.line]));
    }
    const checks = [];
    production.length === 1 && checks.push("single-use");
    kind === "interface" && implementers.length === 1 && checks.push("single-impl");
    checks.length > 0 && flagged.push({
      declaration, source, production, testUses, quoted, reexports, imports, implementers, selfReferences, checks,
    });
  }

  return { flagged, ambiguous, counts };
}

const clip = (text) => text.trim().slice(0, 160);

/**
 * The gate ids a hint suggests. The model reads the code and decides each
 * gate.
 */
function gateHintsOf({ visibility, hints, testFiles, site, bodyLines, documented }) {
  const ids = [];
  visibility === "exported" && ids.push("public-api");
  hints.dynamicHint && ids.push("dynamic");
  testFiles.length > 0 && ids.push("has-own-tests");
  (site?.loopOrCallbackHint || site?.usedAsValue || hints.genericHint) && ids.push("multi-site");
  hints.overrideHint && ids.push("override-or-interface-contract");
  hints.recursiveHint && ids.push("recursive");
  (documented || (bodyLines ?? 0) >= NAMED_INTENT_LINES) && ids.push("named-intent");
  return ids;
}

function describeCandidate(tree, entry, mention, exportedNames) {
  const { declaration, production, testUses, quoted, reexports, imports, implementers, selfReferences, checks } = entry;
  const { file, index, end, open, kind, name, language, enclosing, form } = declaration;
  const source = tree.sources.get(file);
  const statements = bodyStatements(source.lines, index, { end, open }, language);
  const [use] = production;
  const useLines = use === undefined ? null : tree.sources.get(use.file).lines;
  const lineText = source.lines[index];
  const visibility = language?.visibility?.({ line: lineText, name, kind, file, exportedNames }) ?? "unknown";
  const described = {
    name,
    kind,
    checks,
    file,
    line: index + 1,
    language: language?.id ?? "custom",
    form,
    visibility: reexports.length > 0 ? "exported" : visibility,
    enclosing,
    bodyLines: kind === "function" || kind === "method" ? statements.length : null,
    forwards: kind === "function" || kind === "method" ? forwardsTo(statements, name) : false,
    documented: hasDocComment(source.lines, index),
    uses: { production: production.length, test: testUses.length, quoted: quoted.length, selfReferences },
    site: use === undefined ? null : {
      file: use.file,
      line: use.line + 1,
      text: clip(useLines[use.line]),
      enclosing: enclosingLine(useLines, use.line),
      loopOrCallbackHint: insideLoopOrCallback(useLines, use.line),
      usedAsValue:
        (kind === "function" || kind === "method") &&
        !/^\s*(?:[(<!]|\.\()/.test(useLines[use.line].slice(use.col + name.length)),
    },
    implementers: implementers.map((hit) => ({
      file: hit.file, line: hit.line + 1, text: clip(tree.sources.get(hit.file).lines[hit.line]),
    })),
    testFiles: [...new Set(testUses.map((hit) => hit.file))],
    importedIn: [...new Set(imports.map((hit) => hit.file))],
    reexported: reexports.length > 0,
    hints: {
      genericHint: /<[^>]*>|\[\w+\s|\{\w+\}|\bwhere\b/.test(lineText.replace(/=>/g, "")),
      dynamicHint: quoted.length > 0 || isDecoratedLine(source.lines, index) || mention.some((m) => !m.doc),
      overrideHint:
        /\boverride\b/.test(lineText) ||
        /^\s*@(?:Override|override|abstractmethod)\b/.test(source.lines[index - 1] ?? "") ||
        /\bimpl\b[^{]*\bfor\b/.test(enclosing ?? ""),
      recursiveHint: selfReferences > 0,
    },
    mentions: mention.slice(0, 5),
  };
  return { ...described, gateHints: gateHintsOf(described) };
}

/** Candidates with no gate hint first, then the smallest bodies. */
const byTriage = (a, b) =>
  a.gateHints.length - b.gateHints.length ||
  (a.bodyLines ?? 0) - (b.bodyLines ?? 0) ||
  a.file.localeCompare(b.file) ||
  a.line - b.line;

const groupByName = (declarations) => {
  const byName = new Map();
  for (const declaration of declarations) {
    byName.has(declaration.name) || byName.set(declaration.name, []);
    byName.get(declaration.name).push(declaration);
  }
  return byName;
};

// --- diff scope ----------------------------------------------------------

/** The base ref: the one named, else the first default branch that exists. */
function resolveBase(root, named) {
  const refs = named === undefined ? ["origin/main", "origin/master", "main", "master"] : [named];
  for (const ref of refs) {
    if (tryExec("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root) !== null) {
      const mergeBase = tryExec("git", ["merge-base", ref, "HEAD"], root)?.trim();
      mergeBase || fail(`no merge base of ${ref} and HEAD`);
      return { ref, mergeBase };
    }
  }
  return fail(`no base ref found (tried ${refs.join(", ")}); pass --base`);
}

/** Files changed since the merge base, with the working tree when asked. */
function changedFiles(root, mergeBase, workingTree) {
  const args = ["diff", "--name-status", "-z", "--find-renames", mergeBase, ...(workingTree ? [] : ["HEAD"])];
  const out = tryExec("git", args, root);
  out === null && fail("git diff failed");
  const parts = out.split("\0").filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const letter = parts[i++][0];
    if (letter === "R" || letter === "C") {
      files.push({ status: letter, oldPath: parts[i++], path: parts[i++] });
    } else {
      files.push({ status: letter, oldPath: null, path: parts[i++] });
    }
  }
  if (workingTree) {
    const untracked = tryExec("git", ["ls-files", "-z", "--others", "--exclude-standard"], root);
    for (const path of untracked?.split("\0").filter(Boolean) ?? []) {
      files.push({ status: "A", oldPath: null, path });
    }
  }
  return files;
}

function diffInfo(options) {
  const { top } = repoRoot();
  top === null && fail("a diff scope needs a git repository");
  const { ref, mergeBase } = resolveBase(top, options.base[0]);
  const workingTree = options["working-tree"] === true;
  return { root: top, base: ref, mergeBase, workingTree, files: changedFiles(top, mergeBase, workingTree) };
}

/** The changed files as scope paths, for `--scope` and for the report. */
function diffScope(args) {
  const info = diffInfo(parseOptions(args, ["base"], ["working-tree"]));
  return {
    mode: "diff",
    base: info.base,
    mergeBase: info.mergeBase,
    workingTree: info.workingTree,
    files: info.files,
    paths: info.files.filter((f) => f.status !== "D").map((f) => f.path),
  };
}

/**
 * The tree as it stood at `ref`: each file in `files`, a change from `ref` to
 * the tree, is swapped for its version at `ref`. An added file is removed and
 * a renamed file is read under its old path. A file that cannot be read at
 * `ref` keeps the version the tree has.
 */
function restoreSnapshot(tree, files, ref) {
  const sources = new Map(tree.sources);
  const restore = (path) => {
    const text = tryExec("git", ["show", `${ref}:${path}`], tree.root);
    text === null || text.includes("\0") || !tree.extensions.has(extOf(path)) ||
      sources.set(path, makeSource(path, text.split(/\r?\n/)));
  };
  for (const { status, path, oldPath } of files) {
    if (status === "A" || status === "C") {
      sources.delete(path);
    } else if (status === "R") {
      sources.delete(path);
      restore(oldPath);
    } else {
      restore(path);
    }
  }
  return { ...tree, sources };
}

/**
 * Production use counts of every single-declaration name at the merge base,
 * counted over the whole tree.
 */
function usesAtBase(tree, info, options) {
  const baseTree = restoreSnapshot(tree, info.files, info.mergeBase);
  const byName = groupByName(findDeclarations(baseTree, () => true, { decl: options.decl }));
  const { hits } = indexTokens(baseTree, new Set(byName.keys()));
  return flagCandidates(baseTree, byName, hits, { kind: [] }).counts;
}

/**
 * Why a declaration is in the diff scope: it is in a changed file, or its
 * production use count fell to one. Null when the change does not touch it.
 */
function diffReason({ declaration, checks }, touched, baseCounts) {
  const reasons = [];
  touched.has(declaration.file) && reasons.push("declared-in-changed-file");
  const before = baseCounts.get(declaration.name) ?? null;
  before !== null && before > 1 && checks.includes("single-use") && reasons.push("use-count-fell-to-one");
  return reasons.length === 0 ? null : { reasons, usesAtBase: before };
}

function candidates(args) {
  const options = parseOptions(
    args,
    ["scope", "ext", "kind", "decl", "limit", "base"],
    ["clean", "diff", "working-tree"]
  );
  const limit = options.limit.length > 0 ? Number(options.limit[0]) : 500;
  (Number.isInteger(limit) && limit > 0) || fail("--limit needs a positive integer");
  let tree = loadTree(options.ext);
  let diff = null;
  if (options.diff === true) {
    const info = diffInfo(options);
    // Without --working-tree the review covers committed content only.
    info.workingTree || (tree = restoreSnapshot(tree, changedFiles(info.root, "HEAD", true), "HEAD"));
    diff = { info, touched: new Set(info.files.filter((f) => f.status !== "D").map((f) => f.path)) };
  }
  const declarations = findDeclarations(tree, scopeFilter(tree.root, options.scope), options);
  const byName = groupByName(declarations);
  const { hits, exportedNames } = indexTokens(tree, new Set(byName.keys()));
  const { flagged, ambiguous } = flagCandidates(tree, byName, hits, options);
  diff === null || (diff.baseCounts = usesAtBase(tree, diff.info, options));
  const selected = flagged
    .map((entry) => ({ entry, why: diff === null ? null : diffReason(entry, diff.touched, diff.baseCounts) }))
    .filter(({ why }) => diff === null || why !== null);
  const mentions = textLines(tree, new Set(selected.map(({ entry }) => entry.declaration.name)));
  const described = selected
    .map(({ entry, why }) => ({
      ...describeCandidate(tree, entry, mentions.get(entry.declaration.name) ?? [], exportedNames),
      ...(why === null ? {} : { diff: why }),
    }))
    .filter((c) => options.clean !== true || c.gateHints.length === 0)
    .sort(byTriage);
  return {
    scope: {
      mode: diff !== null ? "diff" : options.scope.length > 0 ? "paths" : "repo",
      ...(diff === null ? {} : {
        base: diff.info.base,
        mergeBase: diff.info.mergeBase,
        workingTree: diff.info.workingTree,
        changedFiles: diff.info.files.length,
      }),
      paths: options.scope,
    },
    candidates: described.slice(0, limit),
    total: described.length,
    truncated: Math.max(0, described.length - limit),
    ambiguous: ambiguous.slice(0, 50),
    ambiguousCount: ambiguous.length,
    declarationsScanned: declarations.length,
    evidenceSource: "text",
    ...meta(tree),
  };
}

// --- refs ----------------------------------------------------------------

function refs(args) {
  const options = parseOptions(args, ["scope", "ext"], []);
  const [name] = options._;
  name === undefined && fail("refs needs a name");
  const tree = loadTree(options.ext);
  const inScope = scopeFilter(tree.root, options.scope);
  const word = wordPattern(name);
  const escaped = escapeRegExp(name);
  const access = new RegExp(`(\\.|->|::)\\s*${escaped}(?![\\w$])`);
  const quoted = new RegExp(`["'\`]${escaped}["'\`]`);
  const hits = [];
  for (const [file, { code, test }] of tree.sources) {
    if (!inScope(file)) {
      continue;
    }
    code.forEach((line, index) => {
      word.test(line) && hits.push({
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

// --- forms ---------------------------------------------------------------

function forms() {
  return {
    languages: LANGUAGES.map((language) => ({
      id: language.id,
      extensions: language.exts,
      rows: language.rows.map((row, i) => ({
        form: `${language.id}/${i}`, kind: row.kind, body: row.body, regex: row.re.source,
      })),
    })),
    sourceOnly: EXTRA_SOURCE_EXTENSIONS,
  };
}

// --- verdict -------------------------------------------------------------

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
  const tomlName = () => /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
  if (manifest === "package.json") {
    try {
      const json = JSON.parse(text);
      info.name = typeof json.name === "string" ? json.name : null;
      info.private = json.private === true;
    } catch {
      // Keep the defaults.
    }
  } else if (manifest === "Cargo.toml") {
    info.name = tomlName();
    info.private = /^\s*publish\s*=\s*false\b/m.test(text);
  } else if (manifest === "pyproject.toml") {
    info.name = tomlName();
    info.private = /Private\s*::\s*Do Not Upload/.test(text);
  } else if (manifest === "go.mod") {
    info.name = /^module\s+(\S+)/m.exec(text)?.[1] ?? null;
  } else if (manifest === "pom.xml") {
    info.name = /<artifactId>([^<]+)<\/artifactId>/.exec(text)?.[1] ?? null;
  } else if (manifest === "Project.toml") {
    info.name = tomlName();
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
 * Whether a symbol leaves its package. A "package" is the directory of the
 * nearest manifest. A text match in another package makes it
 * `exported-with-hits`; a private package, or the user's flag, makes it
 * `internal-only`; otherwise gh decides or the verdict is `unknown`. Only
 * `internal-only` clears a proposal.
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

// --- report --------------------------------------------------------------

const isText = (value) => typeof value === "string" && value.trim() !== "";

function validateFinding(finding, index) {
  const where = `findings[${index}]`;
  const problems = [];
  const need = (ok, message) => ok || problems.push(`${where}: ${message}`);
  need(typeof finding === "object" && finding !== null, "must be an object");
  if (problems.length > 0) {
    return problems;
  }
  for (const key of ["id", "file", "symbol", "proposal", "evidence", "judgmentReason", "consumerVerdict"]) {
    need(isText(finding[key]), `${key} must be a non-empty string`);
  }
  need(CHECKS.has(finding.check), `check must be one of ${[...CHECKS].join(", ")}`);
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
  need(ALL_VERDICTS.has(finding.consumerVerdict), `consumerVerdict must be one of ${[...ALL_VERDICTS].join(", ")}`);
  const gates = finding.gates ?? [];
  need(Array.isArray(gates) && gates.every((g) => REFUSAL_IDS.has(g)), `gates must list ids from ${[...REFUSAL_IDS].join(", ")}`);
  if (finding.judgment === "dropped") {
    return problems;
  }
  if (finding.refused === true) {
    need(REFUSAL_IDS.has(finding.reason), `a refused finding needs a reason id from ${[...REFUSAL_IDS].join(", ")}`);
    need(finding.proposal === "none", 'a refused finding has proposal "none"');
    need(finding.worthALook !== true || isText(finding.confirm), "worthALook needs confirm, what to confirm");
    return problems;
  }
  need(finding.proposal !== "none", "a reported finding needs a concrete proposal");
  need(
    CLEARED_VERDICTS.has(finding.consumerVerdict),
    `consumerVerdict ${finding.consumerVerdict} is a refusal (public-api), not a reported finding`
  );
  if (Array.isArray(gates) && gates.length > 0) {
    need(finding.judgment === "downgraded", "a finding with gates has judgment downgraded");
    need(finding.severity === "low", "a finding with gates has severity low");
  }
  need(finding.judgment !== "downgraded" || (Array.isArray(gates) && gates.length > 0), "judgment downgraded needs gates");
  need(
    !Array.isArray(gates) || !gates.includes("has-own-tests") ||
      (Array.isArray(finding.testsNamed) && finding.testsNamed.length > 0 && finding.testsNamed.every(isText)),
    "gate has-own-tests needs testsNamed, a list of the tests"
  );
  need(finding.severity === "low" || isText(finding.raiseReason), "severity above low needs raiseReason");
  return problems;
}

/**
 * The only file this script writes. It must be outside the repository and not
 * a symlink, and it replaces only an earlier findings file, so a mistyped path
 * cannot overwrite source code.
 */
function writeFindings(path, document) {
  const absolute = resolve(process.cwd(), path);
  let existing = null;
  try {
    existing = lstatSync(absolute);
  } catch {
    // The file does not exist yet.
  }
  existing?.isSymbolicLink() && fail(`${path} is a symlink; choose another path`);
  let parent;
  try {
    parent = realpathSync(dirname(absolute));
  } catch {
    return fail(`directory of ${path} does not exist`);
  }
  const { cwd, top } = repoRoot();
  const rel = relative(realpathSync(top ?? cwd), join(parent, basename(absolute)));
  const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  outside || fail(`${path} is inside the repository; name a path outside it`);
  if (existing !== null) {
    existing.isFile() || fail(`${path} is not a regular file`);
    existing.nlink > 1 && fail(`${path} has other hard links, which can lead into the repository; choose another path`);
    let previous = null;
    try {
      previous = JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      // Not JSON: refused below.
    }
    previous?.tool === TOOL || fail(`${path} exists and is not a findings file; choose another path`);
  }
  writeFileSync(absolute, `${JSON.stringify(document, null, 2)}\n`);
}

const WIRE_TITLES = {
  "single-use": "Inline single-use",
  "single-impl": "Collapse single-implementation interface",
  forwarder: "Remove forwarder",
  reviewer: "Collapse abstraction",
};

/**
 * Findings in the review-lens wire format. A reported finding keeps its
 * severity (this skill has no blocker). A refusal appears only when the
 * reviewer marked it worth a look, as a low finding that says what to confirm.
 * `source` is the skill slug, so the finding's own source goes in `evidence`.
 */
function toWire(findings) {
  const wire = [];
  for (const f of findings.filter((x) => x.judgment !== "dropped")) {
    const sources = [f.evidenceSource].flat();
    const origin = `evidence source ${sources.join("+")}; finding source ${f.source}`;
    const base = { source: TOOL, path: f.file, line: f.line };
    if (!f.refused) {
      const gates = (f.gates ?? []).length > 0 ? ` Gates: ${f.gates.join(", ")}.` : "";
      wire.push({
        ...base,
        severity: f.severity,
        title: `${WIRE_TITLES[f.check]} ${f.symbol}`,
        body: `${f.evidence} ${f.judgmentReason}.${gates}`,
        suggested_fix: f.proposal,
        evidence: `${sources.includes("lsp") ? "Verified" : "Inferred"}: ${origin}. ${f.evidence}`,
      });
    } else if (f.worthALook === true) {
      wire.push({
        ...base,
        severity: "low",
        title: `Confirm before collapsing ${f.symbol} (${f.reason})`,
        body: `${f.evidence} Refused by gate ${f.reason}: ${f.judgmentReason}.`,
        suggested_fix: f.confirm,
        evidence: `Inferred: ${origin}. ${f.evidence}`,
      });
    }
  }
  return wire;
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
  const seen = new Set();
  for (const finding of findings) {
    const key = `${finding?.file}\0${finding?.symbol}\0${finding?.check}`;
    seen.has(key) && problems.push(`duplicate finding for ${finding?.file} ${finding?.symbol} (${finding?.check})`);
    seen.add(key);
  }
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
  const document = { tool: TOOL, counts, skippedFiles, excludedDirs, findings };
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
    .forEach((f) => lines.push(`refused (${f.reason}) ${f.file}:${f.line} ${f.symbol}: ${f.judgmentReason}`));
  skippedFiles.length > 0 && lines.push(`skipped files: ${skippedFiles.length}`);
  return {
    text: `${lines.join("\n")}\n`,
    reported: reported.length,
    wire: options.wire === true ? toWire(findings) : null,
  };
}

// --- main ----------------------------------------------------------------

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "-h" || command === "--help") {
    process.stdout.write(usage);
    return;
  }
  const json = { candidates, refs, verdict, forms, "diff-scope": diffScope };
  if (command === "report") {
    const { text, reported, wire } = report(args);
    if (wire === null) {
      process.stdout.write(text);
    } else {
      process.stdout.write(`${JSON.stringify(wire, null, 2)}\n`);
      process.stderr.write(`${wire.length > 0 ? "needs-attention" : "approve"}\n`);
    }
    process.exitCode = (wire === null ? reported : wire.length) > 0 ? 1 : 0;
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
