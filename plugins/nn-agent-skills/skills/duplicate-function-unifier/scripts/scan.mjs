#!/usr/bin/env node
//
// Finds functions whose bodies are the same token sequence once comments and
// whitespace are removed, groups them, and reports each group with the
// evidence a merge needs. It never edits files and needs no packages.
//
// Function boundaries come from a text heuristic per language family (braces,
// indentation, or an `end` keyword). Language servers give better boundaries;
// the skill tells the reviewer to confirm each finding by reading the code.
//
// The comparison is exact. A similarity threshold also reports pairs that only
// resemble each other, and a merge proposal against those is a wrong proposal.
// The price is that renaming one local variable hides a pair.

import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const USAGE = `usage: scan.mjs [options]

Options:
  --root <dir>            Repository root. Default: git top level of the
                          current directory, else the current directory.
  --scope <path>          Keep groups with a member under this path (relative
                          to the root). A group that crosses the scope
                          boundary is kept. Repeatable.
  --diff-base <ref>       Diff scope: keep groups with a copy in a file added,
                          copied, modified, or renamed between the merge base
                          with <ref> and HEAD. The other copies, consumers, and
                          hosts are still searched in the whole tree. Combines
                          with --scope as an intersection.
  --include-working-tree  With --diff-base, also count uncommitted and
                          untracked files.
  --format <native|wire>  native: the findings document (default). wire: a
                          JSON array of review-lens findings, one per group.
  --min-lines <n>         Smallest body to compare, in logical lines. Default 2.
  --max-file-bytes <n>    Skip files larger than this. Default 1048576.
  --gh-owner <org>        Also search this GitHub owner for callers of exported
                          names with \`gh search code\`.
  --out <file>            Write the findings JSON here and print a ranked
                          summary. Without it, print the JSON.
  -h, --help              This text.

Exit codes: 0 no groups found, 1 groups found, 2 the scan could not run.
`;

const BRACE = "brace";
const INDENT = "indent";
const END = "end";

const C_STYLE = { line: ["//"], block: [["/*", "*/"]] };

/**
 * Per-language lexing and boundary rules. `verified` is true only for
 * languages that scan.test.mjs exercises; the others use the same family rule
 * and their results are leads.
 */
const LANGS = {
  js: {
    name: "JavaScript/TypeScript",
    exts: ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"],
    family: BRACE,
    ...C_STYLE,
    strs: ['"', "'", "`"],
    fn: ["function"],
    methods: true,
    arrows: true,
    regex: true,
    newlines: true,
    verified: true,
  },
  py: {
    name: "Python",
    exts: ["py"],
    family: INDENT,
    line: ["#"],
    block: [],
    strs: ['"', "'"],
    triple: ['"""', "'''"],
    fn: ["def"],
    newlines: true,
    verified: true,
  },
  go: {
    name: "Go",
    exts: ["go"],
    family: BRACE,
    ...C_STYLE,
    strs: ['"', "`"],
    rawBacktick: true,
    char: "'",
    fn: ["func"],
    receiver: true,
    newlines: true,
    verified: true,
  },
  rs: {
    name: "Rust",
    exts: ["rs"],
    family: BRACE,
    ...C_STYLE,
    nestBlock: true,
    strs: ['"'],
    char: "'",
    fn: ["fn"],
    newlines: false,
    verified: true,
  },
  java: {
    name: "Java",
    exts: ["java"],
    family: BRACE,
    ...C_STYLE,
    strs: ['"'],
    triple: ['"""'],
    char: "'",
    fn: [],
    methods: true,
    newlines: false,
    verified: true,
  },
  c: {
    name: "C",
    exts: ["c", "h"],
    family: BRACE,
    ...C_STYLE,
    strs: ['"'],
    char: "'",
    fn: [],
    methods: true,
    newlines: false,
    verified: true,
  },
  cpp: {
    name: "C++",
    exts: ["cc", "cpp", "cxx", "hpp", "hh"],
    family: BRACE,
    ...C_STYLE,
    strs: ['"'],
    char: "'",
    fn: [],
    methods: true,
    newlines: false,
    verified: false,
  },
  kt: {
    name: "Kotlin",
    exts: ["kt", "kts"],
    family: BRACE,
    ...C_STYLE,
    nestBlock: true,
    strs: ['"'],
    triple: ['"""'],
    char: "'",
    fn: ["fun"],
    newlines: true,
    verified: false,
  },
  cs: {
    name: "C#",
    exts: ["cs"],
    family: BRACE,
    ...C_STYLE,
    strs: ['"'],
    char: "'",
    fn: [],
    methods: true,
    newlines: false,
    verified: false,
  },
  jl: {
    name: "Julia",
    exts: ["jl"],
    family: END,
    line: ["#"],
    block: [["#=", "=#"]],
    nestBlock: true,
    strs: ['"'],
    triple: ['"""'],
    char: "'",
    bang: true,
    fn: ["function"],
    open: [
      "function",
      "if",
      "for",
      "while",
      "begin",
      "let",
      "try",
      "do",
      "struct",
      "module",
      "macro",
      "quote",
      "abstract",
      "primitive",
    ],
    newlines: true,
    verified: true,
  },
  rb: {
    name: "Ruby",
    exts: ["rb"],
    family: END,
    line: ["#"],
    block: [],
    strs: ['"', "'"],
    bang: true,
    fn: ["def"],
    open: [
      "def",
      "class",
      "module",
      "if",
      "unless",
      "while",
      "until",
      "case",
      "begin",
      "do",
      "for",
    ],
    modifiers: ["if", "unless", "while", "until"],
    newlines: true,
    verified: true,
  },
};

const LANG_BY_EXT = new Map(
  Object.entries(LANGS).flatMap(([id, lang]) =>
    lang.exts.map((ext) => [ext, id])
  )
);
// Source extensions this script does not read. They are reported so the
// reviewer reads those files for duplicates.
const UNSCANNED_EXT = new Set([
  "swift",
  "scala",
  "php",
  "lua",
  "ex",
  "exs",
  "hs",
  "ml",
  "zig",
  "dart",
  "r",
  "pl",
  "sh",
  "bash",
  "m",
  "mm",
  "clj",
  "erl",
  "f90",
  "vb",
  "sql",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".claude",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".turbo",
]);
const GENERATED_MARKER = /@generated|DO NOT EDIT|Code generated/i;
// A comment that says the copies are on purpose is a refusal, because the
// author already decided the question this tool would reopen.
const DELIBERATE_MARKER =
  /\b(?:intentional(?:ly)?|deliberate(?:ly)?)\b|keep in sync|do not (?:merge|unify|dedupe|deduplicate)|duplicated on purpose/i;
const CONTROL = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "match",
  "synchronized",
  "with",
  "return",
  "try",
  "using",
  "lock",
  "foreach",
  "else",
  "sizeof",
]);
const OPS = [
  "===",
  "!==",
  "...",
  "=>",
  "->",
  "::",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  ":=",
  "++",
  "--",
  "+=",
  "-=",
];
const CLOSERS = new Set(["}", ")", "]", ";", ",", "end"]);
const DOC_NAMES = new Set([
  "ARCHITECTURE.md",
  "DESIGN.md",
  "LAYERING.md",
  "LAYERS.md",
  "CONTRIBUTING.md",
]);
const LAYERING_CONFIG =
  /boundaries|no-restricted-imports|no-restricted-paths|dependency-cruiser|importlinter|import-linter|depguard|cargo-deny|archunit/i;
const LAYERING_CONFIG_FILES =
  /^(?:\.eslintrc(?:\..*)?|eslint\.config\.[cm]?[jt]s|\.golangci(?:\..*)?|pyproject\.toml|setup\.cfg|tox\.ini|deny\.toml|\.importlinter|\.dependency-cruiser\.[cm]?js)$/;
const MANIFEST_NAMES = new Set([
  "package.json",
  "Cargo.toml",
  "go.mod",
  "Project.toml",
  "pyproject.toml",
  "setup.py",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "CMakeLists.txt",
  "mix.exs",
  "Gemfile",
  "composer.json",
  "Package.swift",
]);

function die(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    root: undefined,
    scopes: [],
    minLines: 2,
    maxFileBytes: 1024 * 1024,
    ghOwner: undefined,
    out: undefined,
    diffBase: undefined,
    includeWorkingTree: false,
    format: "native",
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
      case "--min-lines":
        opts.minLines = needNumber(i, "--min-lines");
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
      case "--diff-base":
        opts.diffBase = needValue(i, "--diff-base");
        i += 1;
        break;
      case "--include-working-tree":
        opts.includeWorkingTree = true;
        break;
      case "--format":
        opts.format = needValue(i, "--format");
        ["native", "wire"].includes(opts.format) ||
          die(`--format must be native or wire\n${USAGE}`);
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

/** Every file git tracks or does not ignore (all files outside git), sorted. */
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

const extOf = (file) => file.slice(file.lastIndexOf(".") + 1).toLowerCase();

// ---------------------------------------------------------------- tokenizer

const IDENT = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const NUMBER = /\d[\w.]*/y;
const CHAR_LITERAL =
  /'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)|[^\\'\n])'/y;

function matchAt(regex, text, i) {
  regex.lastIndex = i;
  const m = regex.exec(text);
  return m === null ? null : m[0];
}

/**
 * End offset of a regex literal that starts at `i`, or -1 when the slash is a
 * division. A slash starts a regex after an operator or a few keywords.
 */
function regexEnd(text, i, toks) {
  const prev = [...toks].reverse().find((t) => t.k !== "com");
  const allowed =
    prev === undefined ||
    (prev.k === "op" && ![")", "]", "}"].includes(prev.t)) ||
    (prev.k === "id" &&
      ["return", "typeof", "case", "in", "of", "void"].includes(prev.t));
  if (!allowed) {
    return -1;
  }
  let inClass = false;
  for (let k = i + 1; k < text.length && text[k] !== "\n"; k += 1) {
    if (text[k] === "\\") {
      k += 1;
    } else if (text[k] === "[") {
      inClass = true;
    } else if (text[k] === "]") {
      inClass = false;
    } else if (text[k] === "/" && !inClass) {
      let end = k + 1;
      while (end < text.length && /[a-z]/i.test(text[end])) {
        end += 1;
      }
      return end;
    }
  }
  return -1;
}

/**
 * Tokens of a source text: identifiers, numbers, strings, operators, and
 * comments (kind "com"). Strings keep their full text, so comment markers
 * inside them do not matter. Each token records its line, its column, whether
 * it is first on its line, and whether a line break precedes it.
 */
function tokenize(text, lang) {
  const toks = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let lastCodeEnd = 0;
  let lastLine = 0;

  const advance = (to) => {
    for (let k = i; k < to; k += 1) {
      if (text.charCodeAt(k) === 10) {
        line += 1;
        lineStart = k + 1;
      }
    }
    i = to;
  };
  const emit = (k, start, end, startLine, startCol) => {
    const tok = {
      k,
      t: text.slice(start, end),
      s: start,
      e: end,
      line: startLine,
      col: startCol,
      first: lastLine !== startLine,
      nl: k !== "com" && text.slice(lastCodeEnd, start).includes("\n"),
    };
    toks.push(tok);
    if (k !== "com") {
      lastCodeEnd = end;
      lastLine = line;
    }
  };
  const findClose = (from, close, escapes) => {
    let k = from;
    while (k < n) {
      if (escapes && text[k] === "\\") {
        k += 2;
      } else if (text.startsWith(close, k)) {
        return k + close.length;
      } else {
        k += 1;
      }
    }
    return n;
  };

  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f") {
      advance(i + 1);
      continue;
    }
    const start = i;
    const startLine = line;
    const startCol = i - lineStart;

    const block = lang.block.find(([open]) => text.startsWith(open, i));
    if (block !== undefined) {
      const [open, close] = block;
      let depth = 1;
      let k = i + open.length;
      while (k < n && depth > 0) {
        if (lang.nestBlock && text.startsWith(open, k)) {
          depth += 1;
          k += open.length;
        } else if (text.startsWith(close, k)) {
          depth -= 1;
          k += close.length;
        } else {
          k += 1;
        }
      }
      advance(k);
      emit("com", start, k, startLine, startCol);
      continue;
    }
    if (lang.line.some((p) => text.startsWith(p, i))) {
      let k = text.indexOf("\n", i);
      k = k === -1 ? n : k;
      advance(k);
      emit("com", start, k, startLine, startCol);
      continue;
    }
    if (c === "/" && lang.regex) {
      const end = regexEnd(text, i, toks);
      if (end !== -1) {
        advance(end);
        emit("str", start, end, startLine, startCol);
        continue;
      }
    }
    const triple = (lang.triple ?? []).find((q) => text.startsWith(q, i));
    if (triple !== undefined) {
      const end = findClose(i + 3, triple, true);
      advance(end);
      emit("str", start, end, startLine, startCol);
      continue;
    }
    if (lang.char === c) {
      const lit = matchAt(CHAR_LITERAL, text, i);
      if (lit !== null) {
        advance(i + lit.length);
        emit("str", start, i, startLine, startCol);
      } else {
        advance(i + 1);
        emit("op", start, i, startLine, startCol);
      }
      continue;
    }
    if (lang.strs.includes(c)) {
      const raw = lang.rawBacktick && c === "`";
      let k = i + 1;
      const multiline = c === "`";
      while (k < n) {
        if (!raw && text[k] === "\\") {
          k += 2;
        } else if (text[k] === c) {
          k += 1;
          break;
        } else if (text[k] === "\n" && !multiline) {
          break;
        } else {
          k += 1;
        }
      }
      k = Math.min(k, n);
      advance(k);
      emit("str", start, k, startLine, startCol);
      continue;
    }
    const num = /\d/.test(c) ? matchAt(NUMBER, text, i) : null;
    if (num !== null) {
      advance(i + num.length);
      emit("num", start, i, startLine, startCol);
      continue;
    }
    const id = matchAt(IDENT, text, i);
    if (id !== null) {
      let end = i + id.length;
      if (lang.bang && (text[end] === "?" || text[end] === "!") && text[end + 1] !== "=") {
        end += 1;
      }
      advance(end);
      emit("id", start, end, startLine, startCol);
      continue;
    }
    const op = OPS.find((o) => text.startsWith(o, i));
    advance(i + (op === undefined ? 1 : op.length));
    emit("op", start, i, startLine, startCol);
  }
  return toks;
}

// ------------------------------------------------------- function boundaries

const OPEN_FOR = { "(": ")", "[": "]", "{": "}" };
const CLOSE_SET = new Set([")", "]", "}"]);

/**
 * Pairs every bracket with its partner (both directions) and the bracket depth
 * before each token. Returns null if the brackets do not balance, because a
 * lexer error (for example an unterminated string) is the usual cause and the
 * boundaries would be wrong.
 */
function pairBrackets(code) {
  const match = new Array(code.length).fill(-1);
  const depth = new Array(code.length).fill(0);
  const stack = [];
  for (let i = 0; i < code.length; i += 1) {
    const t = code[i].t;
    depth[i] = stack.length;
    if (code[i].k !== "op") {
      continue;
    }
    if (OPEN_FOR[t] !== undefined) {
      stack.push(i);
    } else if (CLOSE_SET.has(t)) {
      const open = stack.pop();
      if (open === undefined || OPEN_FOR[code[open].t] !== t) {
        return null;
      }
      match[open] = i;
      match[i] = open;
      depth[i] = stack.length;
    }
  }
  return stack.length === 0 ? { match, depth } : null;
}

const isOp = (tok, text) => tok !== undefined && tok.k === "op" && tok.t === text;
const isId = (tok) => tok !== undefined && tok.k === "id";

/** Index of the first token of the header line, stopping at a boundary. */
function headerStart(code, k) {
  let h = k;
  while (
    h > 0 &&
    !code[h].first &&
    !(code[h - 1].k === "op" && [";", "{", "}"].includes(code[h - 1].t))
  ) {
    h -= 1;
  }
  return h;
}

/** Skips a balanced `<...>` or `[...]` after a name; returns the next index. */
function skipGenerics(code, match, j, lang) {
  if (isOp(code[j], "<")) {
    let depth = 0;
    for (let k = j; k < code.length && k < j + 60; k += 1) {
      const t = code[k].t;
      if (code[k].k === "op" && (t === ";" || t === "{" || t === "(")) {
        return j;
      }
      t === "<" && code[k].k === "op" && (depth += 1);
      t === ">" && code[k].k === "op" && (depth -= 1);
      if (depth === 0) {
        return k + 1;
      }
    }
    return j;
  }
  if (lang.receiver && isOp(code[j], "[")) {
    return match[j] + 1;
  }
  return j;
}

/** Brace-family boundaries: function keyword, method-shaped, and arrow forms. */
function braceUnits(code, match, lang) {
  const units = [];
  const seen = new Set();
  const add = (nameIdx, openIdx, hs) => {
    if (seen.has(nameIdx) || match[openIdx] === -1) {
      return;
    }
    seen.add(nameIdx);
    units.push({
      nameIdx,
      hs: headerStart(code, hs),
      bodyFrom: openIdx + 1,
      bodyTo: match[openIdx],
      sigTo: openIdx,
    });
  };

  const findOpenAfterParams = (from, allowParens) => {
    for (let k = from; k < code.length && k < from + 80; k += 1) {
      const tok = code[k];
      if (tok.k !== "op") {
        continue;
      }
      if (tok.t === "{") {
        return k;
      }
      if (tok.t === ";" || tok.t === "}" || tok.t === "=" || tok.t === "=>") {
        return -1;
      }
      if (!allowParens && (tok.t === "(" || tok.t === ")")) {
        return -1;
      }
    }
    return -1;
  };

  for (let i = 0; i < code.length; i += 1) {
    const tok = code[i];
    if (tok.k !== "id") {
      if (lang.arrows && isOp(tok, "=>") && isOp(code[i + 1], "{")) {
        let k = i - 1;
        let name = -1;
        for (; k >= 0 && k > i - 40; k -= 1) {
          const t = code[k];
          if (t.k === "op" && CLOSE_SET.has(t.t)) {
            k = match[k];
            continue;
          }
          if (t.k === "op" && (t.t === ";" || t.t === "{" || t.t === "}" || t.t === "(" || t.t === "[" || t.t === ",")) {
            break;
          }
          if (isOp(t, "=")) {
            name = isId(code[k - 1]) ? k - 1 : -1;
            break;
          }
        }
        name !== -1 && add(name, i + 1, name);
      }
      continue;
    }
    if (lang.fn.includes(tok.t)) {
      let j = i + 1;
      lang.receiver && isOp(code[j], "(") && (j = match[j] + 1);
      isOp(code[j], "*") && (j += 1);
      let name = -1;
      if (isId(code[j])) {
        name = j;
        j += 1;
      } else if (
        lang.arrows &&
        isOp(code[j], "(") &&
        isOp(code[i - 1], "=") &&
        isId(code[i - 2])
      ) {
        name = i - 2;
      }
      if (name === -1) {
        continue;
      }
      j = skipGenerics(code, match, j, lang);
      if (!isOp(code[j], "(")) {
        continue;
      }
      const open = findOpenAfterParams(match[j] + 1, true);
      open !== -1 && add(name, open, i);
      continue;
    }
    if (CONTROL.has(tok.t) && isOp(code[i + 1], "(")) {
      i = match[i + 1];
      continue;
    }
    if (
      lang.methods &&
      isOp(code[i + 1], "(") &&
      !CONTROL.has(tok.t) &&
      !["async", "await", "function", "typeof", "new", "delete"].includes(tok.t) &&
      !isOp(code[i - 1], ".") &&
      !(isId(code[i - 1]) && code[i - 1].t === "new")
    ) {
      const open = findOpenAfterParams(match[i + 1] + 1, false);
      open !== -1 && add(i, open, i);
    }
  }
  return units;
}

/** Python-style boundaries: the body is the lines indented past the `def`. */
function indentUnits(code, match, depth, lang) {
  const units = [];
  for (let i = 0; i < code.length; i += 1) {
    if (!(isId(code[i]) && lang.fn.includes(code[i].t))) {
      continue;
    }
    const defTok = code[i - 1]?.t === "async" && code[i - 1].first ? code[i - 1] : code[i];
    if (!defTok.first && defTok === code[i]) {
      continue;
    }
    const nameIdx = i + 1;
    if (!isId(code[nameIdx]) || !isOp(code[nameIdx + 1], "(")) {
      continue;
    }
    let colon = -1;
    for (let k = match[nameIdx + 1] + 1; k < code.length; k += 1) {
      if (isOp(code[k], ":") && depth[k] === 0) {
        colon = k;
        break;
      }
      if (code[k].first && code[k].col <= defTok.col) {
        break;
      }
    }
    if (colon === -1) {
      continue;
    }
    let end = colon + 1;
    while (
      end < code.length &&
      !(code[end].first && depth[end] === 0 && code[end].col <= defTok.col)
    ) {
      end += 1;
    }
    if (end === colon + 1) {
      continue;
    }
    units.push({
      nameIdx,
      hs: i - (defTok === code[i] ? 0 : 1),
      bodyFrom: colon + 1,
      bodyTo: end,
      sigTo: colon + 1,
      indent: true,
      baseCol: code.slice(colon + 1, end).find((t) => t.first)?.col ?? defTok.col + 4,
    });
  }
  return units;
}

/** `end`-keyword boundaries (Julia, Ruby): count block openers to the `end`. */
function endUnits(code, match, depth, lang) {
  const units = [];
  const lineFirst = new Map();
  for (const tok of code) {
    tok.first && lineFirst.set(tok.line, tok.t);
  }
  const opens = new Set(lang.open);
  const modifiers = new Set(lang.modifiers ?? []);
  for (let i = 0; i < code.length; i += 1) {
    if (!(isId(code[i]) && lang.fn.includes(code[i].t) && code[i].first)) {
      continue;
    }
    // Header: the name is the last identifier before the parameter list.
    let k = i + 1;
    let nameIdx = -1;
    while (k < code.length && !code[k].nl && !(isOp(code[k], "(") || isOp(code[k], "{"))) {
      isId(code[k]) && (nameIdx = k);
      k += 1;
    }
    if (nameIdx === -1) {
      continue;
    }
    let headEnd = k;
    if (isOp(code[k], "(")) {
      headEnd = match[k] + 1;
    }
    while (headEnd < code.length && !code[headEnd].nl) {
      if (isOp(code[headEnd], "=")) {
        headEnd = -1;
        break;
      }
      headEnd += 1;
    }
    if (headEnd === -1 || headEnd >= code.length) {
      continue;
    }
    let count = 1;
    let close = -1;
    for (let m = headEnd; m < code.length; m += 1) {
      const tok = code[m];
      if (tok.k !== "id" || depth[m] > 0) {
        continue;
      }
      if (tok.t === "end") {
        count -= 1;
        if (count === 0) {
          close = m;
          break;
        }
      } else if (opens.has(tok.t)) {
        // A modifier form (`x if y`) follows an expression; a block opener
        // starts a line or follows an operator such as `=`.
        const prev = code[m - 1];
        const expressionPosition =
          prev !== undefined &&
          prev.k === "op" &&
          ![")", "]", "}"].includes(prev.t);
        if (modifiers.has(tok.t) && !tok.first && !expressionPosition) {
          continue;
        }
        if (tok.t === "do" && ["while", "until", "for"].includes(lineFirst.get(tok.line))) {
          continue;
        }
        count += 1;
      }
    }
    if (close === -1) {
      continue;
    }
    units.push({
      nameIdx,
      hs: i,
      bodyFrom: headEnd,
      bodyTo: close,
      sigTo: headEnd,
    });
  }
  return units;
}

// ------------------------------------------------------------------ per file

/** Visibility by language convention: "exported", "internal", or "unknown". */
function visibilityOf(langId, unit, source) {
  const head = unit.header;
  const name = unit.name;
  switch (langId) {
    case "js": {
      if (head.includes("export")) {
        return "exported";
      }
      const escaped = name.replace(/\$/g, "\\$");
      return /\bmodule\.exports\b|\bexports[.[]/.test(source) ||
        new RegExp(`\\bexport\\s*\\{[^}]*\\b${escaped}\\b`).test(source) ||
        new RegExp(`\\bexport\\s+default\\s+${escaped}\\b`).test(source)
        ? "exported"
        : unit.kind === "method"
          ? "unknown"
          : "internal";
    }
    case "go":
      return /^\p{Lu}/u.test(name) ? "exported" : "internal";
    case "rs":
      // A function in a trait or impl block takes its visibility from the
      // block, which this script does not read.
      return head.includes("pub")
        ? "exported"
        : unit.col > 0
          ? "unknown"
          : "internal";
    case "py":
    case "jl":
    case "rb":
      return name.startsWith("_") ? "internal" : "exported";
    case "java":
    case "kt":
    case "cs":
      return head.includes("private") ? "internal" : "exported";
    case "c":
    case "cpp":
      return head.includes("static") ? "internal" : "exported";
    default:
      return "unknown";
  }
}

function unitsOf(root, rel, langId, opts) {
  const lang = LANGS[langId];
  const abs = join(root, rel);
  if (lstatSync(abs).size > opts.maxFileBytes) {
    return { units: [], skipped: `${rel}: larger than ${opts.maxFileBytes} bytes` };
  }
  const source = readFileSync(abs, "utf8");
  if (GENERATED_MARKER.test(source.slice(0, 512))) {
    return { units: [], skipped: undefined };
  }
  const all = tokenize(source, lang);
  const code = all.filter((t) => t.k !== "com");
  const comments = all.filter((t) => t.k === "com");
  const paired = pairBrackets(code);
  if (paired === null) {
    return { units: [], skipped: `${rel}: brackets do not balance, not compared` };
  }
  const { match, depth } = paired;
  const raw =
    lang.family === BRACE
      ? braceUnits(code, match, lang)
      : lang.family === INDENT
        ? indentUnits(code, match, depth, lang)
        : endUnits(code, match, depth, lang);

  const render = (list, baseCol) =>
    list
      .map((t) => {
        const mark = !lang.newlines
          ? ""
          : baseCol !== undefined && t.first
            ? `\n${t.col - baseCol}`
            : t.nl
              ? "\n"
              : "";
        return mark + t.t;
      })
      .join(" ");

  const found = [];
  for (const u of raw) {
    const body = code.slice(u.bodyFrom, u.bodyTo);
    const lines = new Set(
      body.filter((t) => !(t.k === "op" && CLOSERS.has(t.t)) && t.t !== "end").map((t) => t.line)
    ).size;
    if (lines < opts.minLines) {
      continue;
    }
    const first = code[u.hs];
    const last = code[Math.max(u.bodyTo - (u.indent ? 1 : 0), u.bodyFrom - 1)] ?? first;
    const prevEnd = u.hs > 0 ? code[u.hs - 1].e : 0;
    const bodyEnd = u.indent ? code[u.bodyTo - 1].e : (code[u.bodyTo]?.e ?? last.e);
    const header = code.slice(u.hs, u.sigTo).map((t) => t.t);
    const name = code[u.nameIdx].t;
    const unit = {
      file: rel,
      lang: langId,
      line: first.line,
      col: first.col,
      name,
      kind:
        lang.family === BRACE && !lang.fn.includes(code[u.hs].t) && !header.includes("=>") && !header.includes("function")
          ? "method"
          : "function",
      header,
      lines,
      start: first.s,
      end: bodyEnd,
      signature: render(code.slice(u.hs, u.sigTo)),
      body: render(body, u.indent ? u.baseCol : undefined),
      deliberate: comments.some(
        (c) => c.s >= prevEnd && c.e <= bodyEnd && DELIBERATE_MARKER.test(c.t)
      ),
    };
    found.push(unit);
  }
  for (const u of found) {
    const nested = found.some(
      (o) => o !== u && o.start <= u.start && o.end >= u.end && (o.start < u.start || o.end > u.end)
    );
    u.visibility = nested ? "internal" : visibilityOf(langId, u, source);
  }
  return { units: found, skipped: undefined };
}

// ----------------------------------------------------------------- packages

const unquote = (s) => s.replace(/^["']|["']$/g, "");

function sectionKeys(text, sections) {
  const keys = new Set();
  let current = "";
  for (const line of text.split("\n")) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header !== null) {
      current = header[1].trim();
      const sub = /^(dev-dependencies|dependencies|build-dependencies)\.(.+)$/.exec(current);
      sub !== null && sections.includes(sub[1]) && keys.add(sub[2].trim());
      continue;
    }
    const key = /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(line);
    key !== null && sections.includes(current) && keys.add(key[1]);
  }
  return keys;
}

function readManifest(root, dir, names) {
  const read = (n) => {
    try {
      return readFileSync(join(root, dir, n), "utf8");
    } catch {
      return undefined;
    }
  };
  const fallback = { name: dir === "." ? "(root)" : dir, deps: new Set(), devDeps: new Set(), depsKnown: false };
  const primary = names.find((n) =>
    ["package.json", "Cargo.toml", "go.mod", "Project.toml", "pyproject.toml"].includes(n)
  );
  if (primary !== undefined && read(primary) === undefined) {
    return fallback;
  }
  if (names.includes("package.json")) {
    try {
      const json = JSON.parse(read("package.json"));
      return {
        name: json.name ?? fallback.name,
        deps: new Set([...Object.keys(json.dependencies ?? {}), ...Object.keys(json.peerDependencies ?? {})]),
        devDeps: new Set(Object.keys(json.devDependencies ?? {})),
        depsKnown: true,
      };
    } catch {
      return fallback;
    }
  }
  if (names.includes("Cargo.toml")) {
    const text = read("Cargo.toml") ?? "";
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(text.split(/^\[dependencies/m)[0]);
    return {
      name: name?.[1] ?? fallback.name,
      deps: sectionKeys(text, ["dependencies", "build-dependencies"]),
      devDeps: sectionKeys(text, ["dev-dependencies"]),
      depsKnown: true,
    };
  }
  if (names.includes("go.mod")) {
    const text = read("go.mod") ?? "";
    const deps = new Set();
    for (const m of text.matchAll(/^\s*(?:require\s+)?([^\s()]+)\s+v[\w.+-]+/gm)) {
      deps.add(m[1]);
    }
    return {
      name: /^module\s+(\S+)/m.exec(text)?.[1] ?? fallback.name,
      deps,
      devDeps: new Set(),
      depsKnown: true,
    };
  }
  if (names.includes("Project.toml")) {
    const text = read("Project.toml") ?? "";
    return {
      name: unquote(/^\s*name\s*=\s*(\S+)/m.exec(text)?.[1] ?? fallback.name),
      deps: sectionKeys(text, ["deps"]),
      devDeps: new Set(),
      depsKnown: true,
    };
  }
  if (names.includes("pyproject.toml")) {
    const text = read("pyproject.toml") ?? "";
    const norm = (s) => s.toLowerCase().replace(/_/g, "-");
    const list = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text)?.[1] ?? "";
    return {
      name: norm(unquote(/^\s*name\s*=\s*(\S+)/m.exec(text)?.[1] ?? fallback.name)),
      deps: new Set([...list.matchAll(/["']([A-Za-z0-9_.-]+)/g)].map((m) => norm(m[1]))),
      devDeps: new Set(),
      depsKnown: true,
    };
  }
  return fallback;
}

function makePackageResolver(root, files) {
  const byDir = new Map();
  for (const f of files) {
    const base = f.slice(f.lastIndexOf("/") + 1);
    if (MANIFEST_NAMES.has(base) || /\.csproj$/.test(base)) {
      const dir = dirname(f);
      byDir.set(dir, [...(byDir.get(dir) ?? []), base]);
    }
  }
  const cache = new Map();
  return (file) => {
    let dir = dirname(file);
    for (;;) {
      if (byDir.has(dir)) {
        cache.has(dir) || cache.set(dir, { dir, ...readManifest(root, dir, byDir.get(dir)) });
        return cache.get(dir);
      }
      if (dir === ".") {
        return { dir: ".", name: "(no manifest)", deps: new Set(), devDeps: new Set(), depsKnown: false };
      }
      dir = dirname(dir);
    }
  };
}

const isTestFile = (file) =>
  /(?:^|\/)(?:__tests__|tests?|spec)\/|(?:\.|_)(?:test|spec)\.[a-z]+$|(?:^|\/)test_[^/]*\.py$|_test\.[a-z]+$|Tests?\.(?:java|kt|cs)$|(?:^|\/)src\/test\//.test(file);

/**
 * Where a shared function could live. Inside one package it always can.
 * Across packages the host has to be one the others already depend on, since a
 * new package edge is a different decision from removing a duplicate. A dev
 * dependency counts only when every member is a test file. A manifest format
 * this script does not read gives no answer, and the group is refused.
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
  const unread = entries.filter((p) => !p.depsKnown);
  if (unread.length > 0) {
    return {
      ok: false,
      why: `dependencies of ${unread.map((p) => p.name).join(", ")} are not readable from its manifest, so no host is verified`,
    };
  }
  const testsOnly = members.every((m) => isTestFile(m.file));
  const depends = (other, candidate) =>
    other.deps.has(candidate.name) || (testsOnly && other.devDeps.has(candidate.name));
  const host = entries.find((c) => entries.every((o) => o === c || depends(o, c)));
  if (host === undefined) {
    return {
      ok: false,
      why: `${entries.map((p) => p.name).join(" and ")} declare no dependency on each other`,
    };
  }
  return { ok: true, host: host.name, why: `${host.name}, which the others already depend on` };
}

// ------------------------------------------------------------- conventions

function discoverConventions(root, files) {
  const base = (f) => f.slice(f.lastIndexOf("/") + 1);
  const readText = (f) => {
    try {
      return readFileSync(join(root, f), "utf8");
    } catch {
      return "";
    }
  };
  const layeringConfigs = [
    ...files.filter((f) => LAYERING_CONFIG_FILES.test(base(f)) && LAYERING_CONFIG.test(readText(f))),
    ...files.filter((f) => /^(?:layers?\.[a-z]+|\.dependency-cruiser\.[cm]?js|\.importlinter)$/.test(base(f))),
  ];
  return {
    manifests: files.filter((f) => MANIFEST_NAMES.has(base(f)) || /\.csproj$/.test(base(f))).slice(0, 100),
    workspaces: files.filter((f) => ["go.work", "pnpm-workspace.yaml", "lerna.json"].includes(base(f))),
    layeringConfigs: [...new Set(layeringConfigs)],
  };
}

function docsNear(fileSet, member) {
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

// --------------------------------------------------------------- consumers

/**
 * Callers of the names in a group that are not internal. In-repo search is
 * `git grep -ow --untracked`, which matches by spelling only, so a same-named
 * symbol elsewhere gives hits that are not callers. In a member's own file, a
 * hit counts only when the name occurs more often than the file declares it.
 * External search needs `--gh-owner` and an authenticated `gh`. Anything that
 * could not be searched reports `unknown`.
 */
function consumers(root, group, opts) {
  const names = [...new Set(group.filter((m) => m.visibility !== "internal").map((m) => m.name))];
  if (names.length === 0) {
    return { verdict: "internal-only", detail: "no member is exported" };
  }
  const details = [];
  let unknown = group.some((m) => m.visibility === "unknown");
  unknown && details.push("visibility of a member is not known from its language rules");
  let hits = false;
  for (const name of names) {
    if (!/^[\p{L}_$][\p{L}\p{N}_$]*[!?]?$/u.test(name)) {
      details.push(`${name}: not a plain identifier, not searched`);
      unknown = true;
      continue;
    }
    try {
      const out = gitOutput(root, ["grep", "-ow", "-F", "--untracked", "-e", name]);
      const counts = new Map();
      for (const line of out.split("\n").filter((l) => l.length > 0)) {
        const file = line.slice(0, line.indexOf(":"));
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
      const others = [...counts]
        .filter(([file, count]) => count > group.filter((m) => m.file === file && m.name === name).length)
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
        ["search", "code", name, "--owner", opts.ghOwner, "--limit", "5", "--json", "path"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 }
      );
      const results = JSON.parse(out);
      results.length > 0 && (hits = true);
      details.push(`${name}: gh search in ${opts.ghOwner} found ${results.length} hit(s)`);
    } catch {
      details.push(`${name}: gh search unavailable or failed`);
      unknown = true;
    }
  }
  return {
    verdict: unknown ? "unknown" : hits ? "exported-with-hits" : "exported-no-hits",
    detail: details.join("; "),
  };
}

const WIRE_SOURCE = "duplicate-function-unifier";
const WIRE_REFUSAL_LIMIT = 5;
// Refusals that ask a person to confirm something. A group refused because a
// larger group covers it, or because it is a dispatch family, needs no look.
const WORTH_A_LOOK = /^(?:consumer check is unknown|no home for|a comment on a member)/;

/**
 * One review-lens finding per group, anchored at the copy inside the scope.
 * The script's severities map as they are (`medium`, `low`); a reviewer can
 * raise one. A refusal worth a look becomes a `low` finding that says what to
 * confirm, capped so refusals do not crowd out findings.
 */
function toWire(findings) {
  const wire = [];
  let refusals = 0;
  for (const f of findings) {
    if (f.refused && (!WORTH_A_LOOK.test(f.reason) || refusals >= WIRE_REFUSAL_LIMIT)) {
      continue;
    }
    f.refused && (refusals += 1);
    const others = f.copies
      .filter((c) => !(c.path === f.file && c.line === f.line))
      .map((c) => `${c.path}:${c.line} ${c.name}`);
    const names = [...new Set(f.copies.map((c) => c.name))].join(", ");
    wire.push({
      source: WIRE_SOURCE,
      path: f.file,
      line: f.line,
      severity: f.severity,
      title: f.refused
        ? `Possible duplicate of ${names}: confirm before merging`
        : `Duplicate function ${names}: ${f.members} copies`,
      body: `${f.signal}. Other copies: ${others.join(", ")}. ${f.evidence}. Found by: source script, evidence text.`,
      suggested_fix: f.refused ? `Confirm before merging: ${f.reason}` : f.proposal,
      evidence: f.refused
        ? "Inferred: the script refused this group (text); read the copies and decide whether the refusal holds."
        : "Verified: the bodies are token-identical (text). Inferred: a merge is safe; confirm by reading each copy and its callers (read) or with language server references (lsp).",
    });
  }
  return wire;
}

/**
 * Files the change set adds, copies, modifies, or renames: the three-dot diff
 * against the base, plus (when asked) uncommitted and untracked files.
 */
function changedFiles(root, opts) {
  const names = (args) =>
    gitOutput(root, args)
      .split("\0")
      .filter((f) => f.length > 0);
  try {
    const base = gitOutput(root, ["merge-base", opts.diffBase, "HEAD"]).trim();
    // The working-tree diff is already net against the merge base, so it
    // replaces the committed diff; a file restored to its base is not changed.
    const files = new Set(
      names([
        "diff",
        "--relative",
        "--name-only",
        "--diff-filter=ACMR",
        "-z",
        ...(opts.includeWorkingTree ? [base] : [`${opts.diffBase}...HEAD`]),
      ])
    );
    if (opts.includeWorkingTree) {
      for (const f of names(["ls-files", "--others", "--exclude-standard", "-z"])) {
        files.add(f);
      }
    }
    return files;
  } catch {
    return die(`cannot diff against ${opts.diffBase}: is it a git ref in this repository?`);
  }
}

/** Whether every member of `group` nests inside a member of `outer`. */
function nestedIn(group, outer) {
  return group.every((member) =>
    outer.some((o) => o.file === member.file && o.start <= member.start && o.end >= member.end)
  );
}

const compact = (items) => [...new Set(items)].sort();

// -------------------------------------------------------------------- main

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = findRoot(opts.root);
  try {
    statSync(root).isDirectory() || die(`root is not a directory: ${root}`);
  } catch {
    die(`root does not exist: ${root}`);
  }
  const files = listFiles(root);
  const fileSet = new Set(files);
  const skipped = [];
  const languages = {};
  const unscanned = {};
  const all = [];
  for (const rel of files) {
    const ext = extOf(rel);
    const langId = LANG_BY_EXT.get(ext);
    if (langId === undefined) {
      UNSCANNED_EXT.has(ext) && (unscanned[ext] = (unscanned[ext] ?? 0) + 1);
      continue;
    }
    if (/\.d\.[cm]?ts$/.test(rel)) {
      continue;
    }
    languages[langId] ??= { name: LANGS[langId].name, files: 0, verified: LANGS[langId].verified };
    languages[langId].files += 1;
    try {
      const result = unitsOf(root, rel, langId, opts);
      result.skipped !== undefined && skipped.push(result.skipped);
      all.push(...result.units);
    } catch (error) {
      skipped.push(`${rel}: ${error.message}`);
    }
  }
  const scanned = Object.values(languages).reduce((n, l) => n + l.files, 0);

  // Bodies compare only within one language, because the same text in two
  // languages is not the same function.
  const byBody = new Map();
  for (const unit of all) {
    const key = `${unit.lang}\u0000${unit.body}`;
    const group = byBody.get(key);
    group === undefined ? byBody.set(key, [unit]) : group.push(unit);
  }
  const groups = [...byBody.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line))
    .sort((a, b) => a[0].file.localeCompare(b[0].file) || a[0].line - b[0].line);

  // Scopes are resolved against the root so `.`, `./x`, and absolute paths
  // work. A scope outside the root matches nothing.
  const scopes = opts.scopes.map((s) => relative(root, resolve(root, s)));
  const inPaths = (path) =>
    scopes.length === 0 || scopes.some((s) => s === "" || path === s || path.startsWith(`${s}/`));
  // Diff scope narrows which groups are candidates. Evidence for a candidate
  // (the other copies, consumers, hosts) always comes from the whole tree.
  const diffFiles = opts.diffBase === undefined ? undefined : changedFiles(root, opts);
  const inScope = (path) => inPaths(path) && (diffFiles === undefined || diffFiles.has(path));
  const packageOf = makePackageResolver(root, files);
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
        j !== index && own[j] === null && other[0].body.length > group[0].body.length && nestedIn(group, other)
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
    entry === undefined ? representatives.set(key, { index, folded: 0 }) : (entry.folded += 1);
  }

  const findings = [];
  for (const [index, group] of groups.entries()) {
    if (!group.some((m) => inScope(m.file))) {
      continue;
    }
    const names = compact(group.map((m) => m.name));
    const home = homes[index];
    const representative = representatives.get(fileKey(group));
    const lines = group[0].lines;
    const where = group.map((m) => `${m.file}:${m.line} ${m.name}`).join(", ");
    const docs = compact(group.flatMap((m) => docsNear(fileSet, m)));
    const allTests = group.every((m) => isTestFile(m.file));
    const mixesTests = !allTests && group.some((m) => isTestFile(m.file));
    const unverified = !LANGS[group[0].lang].verified;

    let refusal = own[index] ?? nesting[index];
    if (refusal === null && representative.index !== index) {
      refusal = `folded into ${idOf(representative.index)}, which covers the same files and is one review decision with this one`;
    }
    const consumer =
      refusal === null
        ? consumers(root, group, opts)
        : { verdict: "not-gathered", detail: "group refused before the consumer search" };
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

    // The finding is anchored at a copy inside the scope, so a diff review
    // points at the code the change touched.
    const anchor = group.find((m) => inScope(m.file));
    findings.push({
      id: idOf(index),
      source: "script",
      evidence_source: ["text"],
      file: anchor.file,
      line: anchor.line,
      copies: group.map((m) => ({ path: m.file, line: m.line, name: m.name })),
      ...(names.length === 1 ? { symbol: names[0] } : {}),
      language: LANGS[group[0].lang].name,
      severity:
        refusal !== null
          ? "low"
          : (representative?.folded ?? 0) > 0 || group.length > 2 || lines >= 6
            ? "medium"
            : "low",
      members: group.length,
      signal: `${group.length} functions share one body, ${lines} logical lines, identical after comments and whitespace are removed: ${where}`,
      evidence: [
        representative?.index === index && representative.folded > 0
          ? `${representative.folded} further group(s) over the same files fold into this one`
          : null,
        `a shared function can live in ${home.ok ? home.why : "no package"}`,
        `consumers: ${consumer.verdict} (${consumer.detail})`,
        mixesTests ? "the group mixes test files and production files" : null,
        docs.length > 0 ? `docs near the members: ${docs.join(", ")}` : null,
        unverified ? `${LANGS[group[0].lang].name} boundaries are not exercised by this script's tests; confirm by reading` : null,
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
    scope_mode:
      opts.diffBase !== undefined ? "diff" : scopes.length > 0 ? "paths" : "repo",
    scope: [
      opts.diffBase !== undefined
        ? `files changed since ${opts.diffBase}${opts.includeWorkingTree ? " plus the working tree" : ""}`
        : null,
      scopes.length > 0 ? opts.scopes.join(", ") : null,
    ]
      .filter((s) => s !== null)
      .join("; ") || "whole repository",
    generated_at: new Date().toISOString(),
    files_scanned: scanned,
    languages,
    unscanned,
    skipped,
    conventions: discoverConventions(root, files),
    counts: {
      candidates: findings.length,
      refused: findings.length - reported,
      reported,
    },
    findings,
  };

  const wire = opts.format === "wire" ? toWire(findings) : undefined;
  const headline = findings.some((f) => !f.refused) ? "needs-attention" : "approve";
  const json = `${JSON.stringify(wire ?? document, null, 2)}\n`;
  if (opts.out === undefined) {
    process.stdout.write(json);
    wire !== undefined && process.stderr.write(`${headline}\n`);
  } else {
    try {
      writeFileSync(opts.out, json);
    } catch (error) {
      die(`cannot write ${opts.out}: ${error.message}`);
    }
    if (wire !== undefined) {
      process.stdout.write(`${headline}\n${wire.length} finding(s) written to ${opts.out}\n`);
      process.exitCode = findings.length > 0 ? 1 : 0;
      return;
    }
    const rank = { medium: 0, low: 1 };
    const lines = [
      `duplicate-function-unifier: ${reported} reported, ${document.counts.refused} refused, ${scanned} source files scanned`,
      ...findings
        .filter((f) => !f.refused)
        .sort((a, b) => rank[a.severity] - rank[b.severity] || b.members - a.members)
        .map((f) => `  [${f.severity}] ${f.id} ${f.file}:${f.line}`),
      ...(Object.keys(unscanned).length > 0
        ? [`not scanned, read these yourself: ${Object.entries(unscanned).map(([e, n]) => `${e} (${n})`).join(", ")}`]
        : []),
      `findings written to ${opts.out}`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  // exitCode rather than exit() so a large write is not cut off on a pipe.
  process.exitCode = findings.length > 0 ? 1 : 0;
}

main();
