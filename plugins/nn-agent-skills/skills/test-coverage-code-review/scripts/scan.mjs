#!/usr/bin/env node
//
// Table-driven lead generator for test cases that run and cannot fail. It reads
// text, with no parser and no dependency, so it works for any language that has
// a row in languages.mjs. Two stages are mechanical:
//   A  a case with no assertion pattern in its body
//   B  an assertion that holds for every input
// A third stage (a case that asserts without reaching code the repo owns) needs
// symbol resolution and belongs to the reviewer; see ../SKILL.md.
//
// The script reads the repository and writes nothing except the file named by
// --out. Exit codes: 0 no findings reported, 1 findings reported, 2 could not
// run.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GENERIC_ASSERT, LANGUAGES } from "./languages.mjs";

const USAGE = `usage: scan.mjs [--root <dir>] [--scope <path>]... [--exempt <path>]...
                [--diff <base>] [--working-tree] [--format json|wire]
                [--languages <id,id>] [--table <file.json>] [--out <file>]
       scan.mjs --list-languages

Reads test files and reports leads. Writes nothing to the repository.

  --root <dir>         Repository root. Default: git top level, else the cwd.
  --scope <path>       Scan only this file or directory. Repeatable. With
                       --diff, only candidates inside these paths.
  --diff <base>        Report candidates only in test files that the change
                       touches or that sit in a directory it touches
                       (git diff --name-only <base>...HEAD). The whole repo is
                       still read for the counts.
  --working-tree       With --diff, also include uncommitted and untracked files.
  --format <f>         json (default): the findings document. wire: a JSON
                       array of review-lens findings, one per reported
                       finding; with --out, stdout gets the headline only.
  --exempt <path>      Refuse every case in this file. Repeatable.
  --languages <ids>    Scan only these language ids, comma separated.
  --table <file.json>  JSON array of language rows (see languages.mjs). A row
                       with a known id replaces the built-in row.
  --out <file>         Write the findings JSON here and print a ranked summary.
                       Without it, the JSON goes to stdout.
  --list-languages     Print the language ids and whether a fixture covers each.
  -h, --help           This text.
`;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", "vendor", "target",
  "__pycache__", "site-packages", "venv", "Pods",
]);
const SEVERITY_ORDER = ["high", "medium", "question", "low"];
const NOT_CALLS = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "def", "fn",
  "match", "sizeof", "elif", "with", "assert", "in", "not", "and", "or",
]);

function fail(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    root: null, scopes: [], exempt: [], out: null,
    languages: null, table: null, list: false,
    diff: null, workingTree: false, format: "json",
  };
  const value = (i, flag) => argv[i] ?? fail(`${flag} needs a value\n${USAGE}`);
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--root": opts.root = resolve(value(++i, "--root")); break;
      case "--scope": opts.scopes.push(resolve(value(++i, "--scope"))); break;
      case "--exempt": opts.exempt.push(resolve(value(++i, "--exempt"))); break;
      case "--out": opts.out = resolve(value(++i, "--out")); break;
      case "--languages": opts.languages = value(++i, "--languages").split(","); break;
      case "--table": opts.table = resolve(value(++i, "--table")); break;
      case "--list-languages": opts.list = true; break;
      case "--diff": opts.diff = value(++i, "--diff"); break;
      case "--working-tree": opts.workingTree = true; break;
      case "--format":
        opts.format = value(++i, "--format");
        if (!["json", "wire"].includes(opts.format)) {
          fail(`--format must be json or wire\n${USAGE}`);
        }
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default: fail(`unexpected argument ${argv[i]}\n${USAGE}`);
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

/** Compile the pattern strings of one language row. */
function compile(row) {
  const re = (s, flags = "gm") => new RegExp(s, flags);
  return {
    ...row,
    filesRe: re(row.files, ""),
    headRe: re(row.head, ""),
    needAttrRe: row.needAttr ? re(row.needAttr, "") : null,
    skipRe: row.skip ? re(row.skip, "") : null,
    skipBlockRe: row.skipBlock ? re(row.skipBlock, "") : null,
    snapshotRe: row.snapshot ? re(row.snapshot) : null,
    assertRes: [re(GENERIC_ASSERT, "gim"), ...(row.assert ?? []).map((s) => re(s))],
    attrAssertsRe: row.attrAsserts ? re(row.attrAsserts, "") : null,
    funcDeclRes: (row.funcDecl ?? []).map((s) => re(s, "")),
    taut: (row.tautology ?? []).map((t) => ({ ...t, headRe: re(t.head) })),
    trivialRes: (row.trivial ?? []).map((s) => re(s)),
  };
}

function loadLanguages(opts) {
  let rows = [...LANGUAGES];
  if (opts.table !== null) {
    let extra;
    try {
      extra = JSON.parse(readFileSync(opts.table, "utf8"));
    } catch (error) {
      fail(`cannot read --table ${opts.table}: ${error.message}`);
    }
    if (!Array.isArray(extra)) {
      fail("--table must hold a JSON array of language rows");
    }
    for (const row of extra) {
      // No fixture covers a row from a file, whatever the file claims.
      rows = [...rows.filter((r) => r.id !== row.id), { ...row, verified: false }];
    }
  }
  if (opts.languages !== null) {
    rows = rows.filter((r) => opts.languages.includes(r.id));
  }
  try {
    return rows.map(compile);
  } catch (error) {
    return fail(`bad language row: ${error.message}`);
  }
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
    } else if (entry.isFile()) {
      out.push(toRel(root, full));
    }
  }
}

function discover(root, scopes, skipped) {
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

/**
 * Replace comments and string contents with spaces, keeping every offset and
 * newline. All structure matching (braces, calls, assertions) runs on the
 * masked text, so code inside a string or comment is never read as code.
 */
function maskNoise(text, lang) {
  const out = text.split("");
  const n = text.length;
  const lineComments = lang.comment?.line ?? [];
  const block = lang.comment?.block ?? null;
  const quotes = lang.strings ?? ['"'];
  const triples = lang.triple ?? [];
  const multiline = lang.multiline ?? [];
  const blank = (a, b) => {
    for (let k = a; k < b; k += 1) {
      if (out[k] !== "\n") {
        out[k] = " ";
      }
    }
  };
  let i = 0;
  while (i < n) {
    if (block !== null && text.startsWith(block[0], i)) {
      let depth = 1;
      let end = i + block[0].length;
      while (end < n && depth > 0) {
        if (lang.nestedBlock && text.startsWith(block[0], end)) {
          depth += 1;
          end += block[0].length;
        } else if (text.startsWith(block[1], end)) {
          depth -= 1;
          end += block[1].length;
        } else {
          end += 1;
        }
      }
      blank(i, end);
      i = end;
      continue;
    }
    if (lineComments.some((c) => text.startsWith(c, i))) {
      const e = text.indexOf("\n", i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
      continue;
    }
    const triple = triples.find((q) => text.startsWith(q, i));
    if (triple !== undefined) {
      const e = text.indexOf(triple, i + 3);
      blank(i + 3, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    const q = text[i];
    if (quotes.includes(q)) {
      if (q === "'" && lang.charLiteral) {
        const m = /^'(?:\\.[^'\n]*|[^\\'\n])'/.exec(text.slice(i, i + 12));
        if (m === null) {
          i += 1;
          continue;
        }
        blank(i + 1, i + m[0].length - 1);
        i += m[0].length;
        continue;
      }
      let j = i + 1;
      let from = i + 1;
      while (j < n && text[j] !== q) {
        if (text[j] === "\\") {
          j += 1;
        } else if (text[j] === "\n" && !multiline.includes(q)) {
          break;
        } else if (lang.interpolate && q === "`" && text.startsWith("${", j)) {
          // Code inside `${...}` runs, so it stays visible.
          let depth = 0;
          let k = j + 1;
          for (; k < n; k += 1) {
            depth += text[k] === "{" ? 1 : text[k] === "}" ? -1 : 0;
            if (depth === 0) {
              break;
            }
          }
          blank(from, j + 2);
          from = k;
          j = k;
        }
        j += 1;
      }
      blank(from, Math.min(j, n));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * The last line of the block that starts on `start`, and whether it closed.
 * `lines` are masked lines.
 */
function extent(lines, start, mode) {
  const last = lines.length - 1;
  if (mode === "indent") {
    const indent = (s) => s.length - s.trimStart().length;
    const base = indent(lines[start]);
    // A signature can span lines; the body starts after the line that closes it.
    let sig = start;
    let depth = 0;
    for (let k = start; k <= last; k += 1) {
      for (const c of lines[k]) {
        depth += "([{".includes(c) ? 1 : ")]}".includes(c) ? -1 : 0;
      }
      sig = k;
      if (depth <= 0) {
        break;
      }
    }
    let end = sig;
    for (let k = sig + 1; k <= last; k += 1) {
      if (lines[k].trim() === "") {
        continue;
      }
      if (indent(lines[k]) <= base) {
        break;
      }
      end = k;
    }
    return { end, closed: true };
  }
  if (mode === "end") {
    const token = /\b(end|begin|function|if|for|while|let|do|struct|macro|module|quote|try)\b|[[({\])}]/g;
    let depth = 0;
    let brackets = 0;
    let opened = false;
    for (let k = start; k <= last; k += 1) {
      for (const m of lines[k].matchAll(token)) {
        const t = m[0];
        if ("[({".includes(t)) {
          brackets += 1;
        } else if ("])}".includes(t)) {
          brackets = Math.max(0, brackets - 1);
        } else if (brackets === 0 && t === "end") {
          depth -= 1;
        } else if (brackets === 0) {
          depth += 1;
          opened = true;
        }
        if (opened && depth <= 0) {
          return { end: k, closed: true };
        }
      }
      if (!opened && k === start) {
        return { end: start, closed: true };
      }
    }
    return { end: last, closed: false };
  }
  if (mode === "parens") {
    let depth = 0;
    let opened = false;
    for (let k = start; k <= last; k += 1) {
      const line = lines[k];
      for (let c = 0; c < line.length; c += 1) {
        if (line[c] === "(") {
          depth += 1;
          opened = true;
        } else if (line[c] === ")") {
          depth -= 1;
          if (opened && depth === 0) {
            // A curried call such as it.each(rows)("name", fn) continues.
            if (/^\s*\(/.test(line.slice(c + 1))) {
              continue;
            }
            return { end: k, closed: true };
          }
        }
      }
    }
    return { end: last, closed: !opened };
  }
  // braces: the first `{` outside parentheses within three lines, unless a `;`
  // ends the statement. A `{` inside the parameter list is a default value or a
  // destructuring pattern, not the body.
  let depth = 0;
  let parens = 0;
  let opened = false;
  for (let k = start; k <= last; k += 1) {
    if (!opened && k > start + 3) {
      return { end: start, closed: true };
    }
    for (const c of lines[k]) {
      if (c === "(") {
        parens += 1;
      } else if (c === ")") {
        parens = Math.max(0, parens - 1);
      } else if (parens > 0) {
        continue;
      } else if (c === ";" && !opened) {
        return { end: start, closed: true };
      } else if (c === "{") {
        depth += 1;
        opened = true;
      } else if (c === "}" && opened) {
        depth -= 1;
        if (depth === 0) {
          return { end: k, closed: true };
        }
      }
    }
  }
  return { end: opened ? last : start, closed: !opened };
}

function* allMatches(re, text) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    yield m;
    if (m[0] === "") {
      re.lastIndex += 1;
    }
  }
}

const anyMatch = (res, text) => res.some((re) => allMatches(re, text).next().done === false);

/** Balanced text from the opener at `open`, using masked text for depth. */
function readBalanced(masked, orig, open) {
  const pair = { "(": ")", "[": "]", "{": "}" }[masked[open]];
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === masked[open]) {
      depth += 1;
    } else if (masked[i] === pair) {
      depth -= 1;
      if (depth === 0) {
        return { text: orig.slice(open + 1, i), masked: masked.slice(open + 1, i), end: i };
      }
    }
  }
  return null;
}

/** Split masked text at top-level occurrences of `sep`, returning offsets. */
function splitTop(masked, sep) {
  const cuts = [];
  let depth = 0;
  for (let i = 0; i < masked.length; i += 1) {
    const c = masked[i];
    if ("([{".includes(c)) {
      depth += 1;
    } else if (")]}".includes(c)) {
      depth -= 1;
    } else if (depth === 0 && masked.startsWith(sep, i)) {
      const before = masked[i - 1];
      const after = masked[i + sep.length];
      if (sep === "==" && ("=!<>".includes(before ?? " ") || after === "=")) {
        continue;
      }
      cuts.push(i);
      i += sep.length - 1;
    }
  }
  const parts = [];
  let from = 0;
  for (const cut of cuts) {
    parts.push([from, cut]);
    from = cut + sep.length;
  }
  parts.push([from, masked.length]);
  return parts;
}

const normalize = (s) => s.replace(/\s+/g, " ").trim();
const LITERAL = /^(?:-?\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?|"[^"]*"|'[^']*'|true|false|True|False|null|None|nil|nothing)$/;

function literalValue(text) {
  const t = text.trim();
  if (!LITERAL.test(t)) {
    return { ok: false };
  }
  if (/^-?\d/.test(t)) {
    // Integers compare exactly. `1.0` equals `1`; other decimals compare as
    // written, so two distinct literals never read as equal.
    const plain = t.replace(/_/g, "");
    const whole = /^(-?\d+)(?:\.0+)?$/.exec(plain);
    return { ok: true, value: `num:${whole === null ? plain : BigInt(whole[1])}` };
  }
  if (/^["']/.test(t)) {
    return { ok: true, value: `str:${t.slice(1, -1)}` };
  }
  return { ok: true, value: `word:${t}` };
}

const MAY_VARY = /[\w\])]\s*\(|\+\+|--|\bawait\b|\bnew\b|:=/;

/** Tautology findings inside one case body. `orig` and `masked` align. */
function tautologies(lang, orig, masked) {
  const found = [];
  const verdict = (a, b, offset) => {
    const left = normalize(a);
    const right = normalize(b);
    if (left === "" || right === "") {
      return;
    }
    const la = literalValue(left);
    const lb = literalValue(right);
    if (left === right) {
      const varies = MAY_VARY.test(left);
      // Equality need not be reflexive (NaN, an overloaded operator), so a
      // repeated expression is a lead, not a proof.
      found.push({
        offset,
        severity: "medium",
        reason: varies
          ? "both sides are the same expression and evaluating it can differ between runs, so the assertion checks that it is stable"
          : "both sides are the same expression; it holds unless equality is not reflexive (NaN, an overloaded operator) or a getter changes between reads",
        proposal: varies
          ? "compare two independently constructed values, or assert the form the case title claims"
          : "assert the subject against the value the case is about, which is a different expression than the one on the left",
        text: `${left} == ${right}`.slice(0, 160),
      });
    } else if (la.ok && lb.ok && Object.is(la.value, lb.value)) {
      found.push({
        offset,
        severity: "high",
        reason: "both sides are equal literals",
        proposal: "assert the value the code under test produces",
        text: `${left} == ${right}`.slice(0, 160),
      });
    }
  };
  for (const t of lang.taut) {
    for (const m of allMatches(t.headRe, masked)) {
      const headEnd = m.index + m[0].length;
      if (t.kind === "chain") {
        const a = readBalanced(masked, orig, headEnd - 1);
        if (a === null) {
          continue;
        }
        const rest = new RegExp(String.raw`^\s*\.\s*(not\s*\.\s*)?(?:${t.matchers})\s*\(`).exec(
          masked.slice(a.end + 1));
        if (rest === null || rest[1] !== undefined) {
          continue;
        }
        const b = readBalanced(masked, orig, a.end + 1 + rest[0].length - 1);
        if (b !== null) {
          verdict(a.text, b.text, m.index);
        }
      } else if (t.kind === "args") {
        const args = readBalanced(masked, orig, headEnd - 1);
        if (args === null) {
          continue;
        }
        const parts = splitTop(args.masked, ",").map(([x, y]) => args.text.slice(x, y));
        // JUnit 4 puts an optional message first; with three arguments and a
        // string first, shift the pair.
        const shift = t.messageFirst && parts.length >= 3 && /^\s*"/.test(parts[0]) ? 1 : 0;
        const [i, j] = t.pair.map((p) => p + shift);
        if (parts[i] !== undefined && parts[j] !== undefined) {
          verdict(parts[i], parts[j], m.index);
        }
      } else if (t.kind === "infix") {
        let content;
        if (t.paren) {
          content = readBalanced(masked, orig, headEnd - 1);
        } else {
          const eol = masked.indexOf("\n", headEnd);
          const stop = eol < 0 ? masked.length : eol;
          content = { text: orig.slice(headEnd, stop), masked: masked.slice(headEnd, stop) };
        }
        if (content === null) {
          continue;
        }
        const [first] = splitTop(content.masked, ",");
        const expr = { text: content.text.slice(first[0], first[1]), masked: content.masked.slice(first[0], first[1]) };
        const sides = splitTop(expr.masked, t.op);
        if (sides.length === 2) {
          verdict(expr.text.slice(...sides[0]), expr.text.slice(...sides[1]), m.index);
        }
      }
    }
  }
  return found;
}

const lastSegment = (name) => name.split(/\.|::|->/).pop();

/** Names called in a body. */
function callsIn(masked) {
  const re = /(?<![\w.])([A-Za-z_@][\w]*(?:(?:\.|::|->)[A-Za-z_]\w*)*)\s*!?\s*\(/g;
  const names = [];
  for (const m of masked.matchAll(re)) {
    if (!NOT_CALLS.has(m[1])) {
      names.push(m[1]);
    }
  }
  return names;
}

/** Cases, helpers, and tautologies in one file. */
function scanFile(rel, text, lang, exempt) {
  const masked = maskNoise(text, lang);
  const olines = text.split("\n");
  const mlines = masked.split("\n");
  const starts = [];
  let off = 0;
  for (const line of olines) {
    starts.push(off);
    off += line.length + 1;
  }
  const slice = (a, b) => ({
    orig: text.slice(starts[a], starts[b] + olines[b].length),
    masked: masked.slice(starts[a], starts[b] + olines[b].length),
  });
  const warnings = [];

  const skipRanges = [];
  if (lang.skipBlockRe !== null) {
    mlines.forEach((line, i) => {
      if (lang.skipBlockRe.test(line)) {
        skipRanges.push([i, extent(mlines, i, lang.mode).end]);
      }
    });
  }

  const helpers = new Map();
  mlines.forEach((line, i) => {
    for (const re of lang.funcDeclRes) {
      const m = re.exec(line);
      if (m !== null) {
        const name = m.slice(1).find((g) => g !== undefined);
        if (name !== undefined && !helpers.has(name)) {
          const { end } = extent(mlines, i, lang.funcMode ?? lang.mode);
          // The declaration is not a call, so it is blanked.
          const text = slice(i, end).masked;
          helpers.set(
            name,
            text.slice(0, m.index) + " ".repeat(m[0].length) + text.slice(m.index + m[0].length),
          );
        }
      }
    }
  });
  const asserting = new Set();
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [name, body] of helpers) {
      const callsAsserting = callsIn(body).some((c) => asserting.has(lastSegment(c)));
      if (anyMatch(lang.assertRes, body) || callsAsserting) {
        asserting.add(name);
      }
    }
  }

  const cases = [];
  mlines.forEach((mline, i) => {
    const m = lang.headRe.exec(olines[i]);
    if (m === null) {
      return;
    }
    const at = m.index + m[0].length - m[0].trimStart().length;
    if (mline[at] !== olines[i][at]) {
      return;
    }
    const attrs = [];
    for (let k = i - 1; k >= 0 && /^(?:@|#\[)/.test(mlines[k].trim()); k -= 1) {
      attrs.unshift(mlines[k]);
    }
    const attrText = `${attrs.join("\n")}\n${mline}`;
    if (lang.needAttrRe !== null && !lang.needAttrRe.test(attrText)) {
      return;
    }
    const { end, closed } = extent(mlines, i, lang.mode);
    if (!closed) {
      warnings.push({ file: rel, reason: `block starting at line ${i + 1} does not close` });
      return;
    }
    const body = slice(i, end);
    // The case name is not an assertion, whatever it says (`fn check_it`).
    body.masked =
      body.masked.slice(0, m.index) +
      " ".repeat(m[0].length) +
      body.masked.slice(m.index + m[0].length);
    const title = lang.title.map((g) => m[g]).find((g) => g !== undefined)?.trim() ?? "<unnamed>";
    const skipped =
      skipRanges.some(([a, b]) => i > a && i <= b) ||
      (lang.skipRe !== null && (lang.skipRe.test(attrText) || lang.skipRe.test(body.masked)));
    cases.push({ title, line: i + 1, endLine: end + 1, attrText, body, skipped });
  });
  // A case that holds other cases (a nested test group) is a container; its
  // own body is not where the assertions live.
  for (const c of cases) {
    c.container = cases.some((o) => o !== c && o.line > c.line && o.line <= c.endLine);
  }

  const findings = [];
  const refusals = [];
  for (const c of cases) {
    const base = (stage, line) => ({
      id: `utp-${stage}-${rel.replace(/[^A-Za-z0-9]/g, "-")}-${line}`,
      source: "script",
      evidence_source: "text",
      language: lang.id,
      stage,
      file: rel,
      line,
      case: c.title,
    });
    const refuse = (reason, evidence) => {
      refusals.push({
        ...base("A", c.line),
        severity: "low",
        evidence,
        proposal: "none",
        refused: true,
        reason,
      });
    };
    if (c.skipped) {
      refuse("skipped, disabled, or todo: does not run", "");
      continue;
    }
    if (lang.snapshotRe !== null && anyMatch([lang.snapshotRe], c.body.masked)) {
      refuse("snapshot-backed: the stored file is the assertion", "");
      continue;
    }
    const attrAsserts = lang.attrAssertsRe !== null && lang.attrAssertsRe.test(c.attrText);
    const asserts = attrAsserts || anyMatch(lang.assertRes, c.body.masked);
    const calls = callsIn(c.body.masked);
    const viaHelper = [...new Set(calls.map(lastSegment).filter((n) => asserting.has(n)))];

    if (!asserts && viaHelper.length === 0) {
      if (c.container) {
        refuse("the case holds nested cases; each nested case is judged on its own", "");
      } else if (exempt.has(rel)) {
        refuse("exempt: the caller passed this file with --exempt", "");
      } else {
        const unknown = [...new Set(calls)].filter(
          (n) => !helpers.has(lastSegment(n)));
        findings.push({
          ...base("A", c.line),
          severity: unknown.length > 0 ? "question" : "medium",
          signal: `the case "${c.title}" has no assertion pattern in its body`,
          evidence: unknown.length > 0
            ? `no assertion pattern; it calls ${unknown.slice(0, 8).join(", ")}, which the scan does not resolve and which may assert`
            : "no assertion pattern and no call the scan cannot place; the case can only fail by throwing",
          proposal:
            "resolve the calls (language server or reading); if none asserts and the case is not a deliberate does-not-throw check, restore the assertion the title implies or delete the case",
          refused: false,
        });
      }
    } else if (!asserts) {
      refuse("the case asserts through a helper this file declares", `${viaHelper.join(", ")} asserts`);
    }
    const trivial = lang.trivialRes.some((re) => anyMatch([re], c.body.masked));
    const taut = tautologies(lang, c.body.orig, c.body.masked);
    for (const t of taut) {
      const line = c.line + c.body.masked.slice(0, t.offset).split("\n").length - 1;
      const f = {
        ...base("B", line),
        signal: t.reason,
        evidence: `\`${t.text}\` in "${c.title}"`,
      };
      if (exempt.has(rel)) {
        refusals.push({
          ...f,
          reason: "exempt: the caller passed this file with --exempt",
          severity: "low",
          proposal: "none",
          refused: true,
        });
      } else {
        findings.push({ ...f, severity: t.severity, proposal: t.proposal, refused: false });
      }
    }
    if (trivial && taut.length === 0 && exempt.has(rel)) {
      refuse("exempt: the caller passed this file with --exempt", "a constant assertion");
    } else if (trivial && taut.length === 0) {
      findings.push({
        ...base("B", c.line),
        severity: "high",
        signal: "a constant assertion that always passes",
        evidence: `the case "${c.title}" asserts a constant true`,
        proposal: "assert the value the code under test produces",
        refused: false,
      });
    }
  }
  return { findings, refusals, warnings, cases: cases.length };
}

/** The proposed change: what to change, where, and the check that verifies it. */
function withProposal({ proposal, ...f }) {
  return {
    ...f,
    change: proposal,
    where: `${f.file}:${f.line} (case "${f.case}")`,
    verify:
      "run the changed case; then change the code under test so the behavior the case names is wrong and confirm the case fails",
  };
}

/** Paths the change touches, relative to the repo root. */
function changedPaths(root, base, workingTree) {
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split("\n")
      .filter((line) => line !== "");
  try {
    if (!workingTree) {
      return git(["diff", "--name-only", `${base}...HEAD`]);
    }
    // The net change from the merge base to the working tree. A committed
    // change that an uncommitted edit reverses is not in it.
    const mergeBase = git(["merge-base", base, "HEAD"])[0];
    return [
      ...new Set([
        ...git(["diff", "--name-only", mergeBase]),
        ...git(["ls-files", "--others", "--exclude-standard"]),
      ]),
    ];
  } catch (error) {
    return fail(`cannot read the diff against ${base}: ${String(error.stderr ?? error.message).trim()}`);
  }
}

/**
 * Candidates are the test files the change touches and the test files that
 * sit next to a touched file. Callers and other tests of the same code are
 * outside this set; finding them is evidence work for the reviewer.
 */
function candidateFilter(root, opts) {
  if (opts.diff === null) {
    return { test: () => true, changed: null };
  }
  // A deleted path still marks its directory: the tests next to it are affected.
  const changed = changedPaths(root, opts.diff, opts.workingTree);
  const dirs = new Set(changed.map((p) => posixDir(p)));
  const files = new Set(changed);
  return { test: (rel) => files.has(rel) || dirs.has(posixDir(rel)), changed };
}

const posixDir = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");

function run(root, opts, languages) {
  const skipped = [];
  const all = discover(root, opts.scopes, skipped);
  const filter = candidateFilter(root, opts);
  // The count covers the whole repo even when --scope narrows the scan.
  const everything = opts.scopes.length === 0 ? all : discover(root, [], []);
  const repoTestFiles = everything.filter((rel) => languages.some((l) => l.filesRe.test(rel))).length;
  const exempt = new Set(opts.exempt.map((p) => toRel(root, p)));
  const raw = [];
  const warnings = [];
  const perLanguage = {};
  let files = 0;
  let cases = 0;
  for (const rel of all) {
    const lang = languages.find((l) => l.filesRe.test(rel));
    if (lang === undefined) {
      continue;
    }
    if (!filter.test(rel)) {
      continue;
    }
    files += 1;
    const full = join(root, rel);
    let text;
    try {
      if (statSync(full).size > MAX_FILE_BYTES) {
        skipped.push({ file: rel, reason: "larger than 2 MiB" });
        continue;
      }
      text = readFileSync(full, "utf8");
    } catch (error) {
      skipped.push({ file: rel, reason: `unreadable: ${error.code ?? error.message}` });
      continue;
    }
    const result = scanFile(rel, text, lang, exempt);
    cases += result.cases;
    warnings.push(...result.warnings);
    perLanguage[lang.id] ??= { files: 0, cases: 0, verified: lang.verified === true };
    perLanguage[lang.id].files += 1;
    perLanguage[lang.id].cases += result.cases;
    raw.push(
      ...result.findings.map(withProposal),
      ...result.refusals.map(({ proposal, ...r }) => ({ ...r, refused: true, severity: "low" })),
    );
  }
  if (repoTestFiles === 0) {
    fail("no test files matched a language row; check --scope, --languages, or add a row with --table");
  }
  // A change with no candidate test file is a clean result. Candidate files
  // with no recognized case are not: the row may not fit them.
  if (cases === 0 && files > 0) {
    fail(`no test cases recognized in ${files} test files; the language row may not match this repo's test style`);
  }
  const rank = (f) => SEVERITY_ORDER.indexOf(f.severity);
  const sorted = [...raw].sort(
    (a, b) =>
      Number(Boolean(a.refused)) - Number(Boolean(b.refused)) ||
      rank(a) - rank(b) ||
      ((a.file ?? "") < (b.file ?? "") ? -1 : (a.file ?? "") > (b.file ?? "") ? 1 : (a.line ?? 0) - (b.line ?? 0)),
  );
  const refusedByReason = {};
  for (const f of raw.filter((x) => x.refused)) {
    refusedByReason[f.reason] = (refusedByReason[f.reason] ?? 0) + 1;
  }
  return {
    tool: "test-coverage-code-review",
    root,
    scope: {
      mode: opts.diff !== null ? "diff" : opts.scopes.length > 0 ? "paths" : "repo",
      base: opts.diff,
      working_tree: opts.workingTree,
      paths: opts.scopes.map((s) => toRel(root, s)),
      changed_paths: filter.changed?.length ?? null,
      candidate_test_files: files,
      repo_test_files: repoTestFiles,
    },
    generated_at: new Date().toISOString(),
    languages: perLanguage,
    counts: {
      test_files: files,
      cases,
      candidates: raw.length,
      refused: raw.filter((f) => f.refused).length,
      reported: raw.filter((f) => !f.refused).length,
      refused_by_reason: refusedByReason,
    },
    skipped_files: [...skipped, ...warnings],
    findings: sorted,
  };
}

// A clearly useless test the change introduces is `medium` in this lens. The
// reviewer raises one to `high` when it is the only test claiming to cover a
// core behavior.
const WIRE_SEVERITY = { high: "medium", medium: "medium", question: "low", low: "low" };

/** The review-lens wire format: one object per reported finding. */
function toWire(doc) {
  return doc.findings
    .filter((f) => !f.refused)
    .map((f) => ({
      source: "test-coverage-code-review",
      path: f.file,
      line: f.line,
      severity: WIRE_SEVERITY[f.severity],
      title: f.stage === "A" ? `No assertion in case "${f.case}"` : `Assertion that holds for any input in case "${f.case}"`,
      body: `[origin: ${f.source}; evidence source: ${f.evidence_source}; check ${f.stage}] ${f.signal}. ${f.evidence}`,
      suggested_fix: `${f.change} Verify: ${f.verify}`,
      evidence: `Inferred: ${f.evidence_source} scan of ${f.file}; confirm by resolving the calls with the language server or by reading the code.`,
    }));
}

const headline = (doc) =>
  doc.findings.some((f) => !f.refused && (f.severity === "high" || f.severity === "medium"))
    ? "needs-attention"
    : "approve";

function summary(doc) {
  const lines = [
    `scope: ${doc.scope.mode}${doc.scope.base ? ` against ${doc.scope.base}` : ""}; ${doc.scope.candidate_test_files} of ${doc.scope.repo_test_files} test files are candidates`,
    `test-coverage-code-review: ${doc.counts.test_files} test files, ${doc.counts.cases} cases, ${doc.counts.candidates} candidates, ${doc.counts.refused} refused, ${doc.counts.reported} reported`,
  ];
  for (const [id, info] of Object.entries(doc.languages)) {
    lines.push(`language ${id}: ${info.files} files, ${info.cases} cases${info.verified ? "" : " (no fixture covers this row)"}`);
  }
  for (const f of doc.findings.filter((x) => !x.refused)) {
    lines.push(`${f.severity} [${f.source}/${f.evidence_source}] ${f.file}:${f.line}  ${f.signal}`);
    lines.push(`    change: ${f.change}`);
    lines.push(`    verify: ${f.verify}`);
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
  const languages = loadLanguages(opts);
  if (opts.list) {
    for (const l of languages) {
      process.stdout.write(`${l.id}\t${l.verified === true ? "fixture-tested" : "guidance only"}\t${l.name}\n`);
    }
    return 0;
  }
  const root = findRoot(opts.root);
  if (opts.out !== null) {
    // The scan never writes inside the repository it reads.
    let existing = dirname(opts.out);
    while (!existsSync(existing)) {
      existing = dirname(existing);
    }
    // A link at the path (even a dangling one) could lead into the repository.
    let isLink = false;
    try {
      isLink = lstatSync(opts.out).isSymbolicLink();
    } catch {
      /* no file yet */
    }
    if (isLink) {
      fail(`--out ${opts.out} is a symbolic link; name a regular path outside the repository`);
    }
    const target = join(realpathSync(existing), relative(existing, opts.out));
    const roots = new Set([realpathSync(root)]);
    try {
      roots.add(realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()));
    } catch {
      /* not a git checkout */
    }
    for (const repo of roots) {
      const inside = toRel(repo, target);
      if (!inside.startsWith("..") && !isAbsolute(inside)) {
        fail(`--out ${opts.out} is inside the repository; name a path outside it`);
      }
    }
    mkdirSync(dirname(opts.out), { recursive: true });
  }
  const doc = run(root, opts, languages);
  const wire = opts.format === "wire";
  const json = `${JSON.stringify(wire ? toWire(doc) : doc, null, 2)}\n`;
  if (opts.out === null) {
    process.stdout.write(json);
  } else {
    writeFileSync(opts.out, json);
    process.stdout.write(wire ? `${headline(doc)}\n` : summary(doc));
  }
  return doc.counts.reported > 0 ? 1 : 0;
}

// An uncaught throw would exit 1, which means "findings reported".
try {
  process.exitCode = main();
} catch (error) {
  fail(error.stack ?? String(error));
}
