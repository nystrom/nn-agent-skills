#!/usr/bin/env node
// Optional text-based import-edge extractor. Prefer edges from a language
// server (find-references, document symbols); use this when none is available.
// It reads import statements with one regex set per language and resolves each
// to a file in the repo when it can. Resolution is an approximation: see
// ../references/languages.md for what each language handler does and what the
// tests exercise.
//
// Output: JSON array of
//   {from, to, specifier, line, kind: "import" | "reexport", evidence_source: "text"}
// `to` is a root-relative POSIX path, or null when the target is outside the
// repo or could not be resolved.
//
// Exit codes: 0 ok, 2 could not run.

import { writeFileSync } from "node:fs";
import { basename, dirname, posix, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOutsideRepo, assertScannable, die, findRoot, lineOf, readText, walk } from "./lib.mjs";

const USAGE = `usage: edges.mjs [--root <dir>] [--out <file>]

  --root <dir>  Repository root. Default: git top level, else working directory.
  --out <file>  Write the JSON edge list here. Default: standard output.
`;

const C_STYLE = new Set(["ts", "js", "go", "rs", "java", "kt", "c", "cpp", "h"]);
const EXT_LANG = {
  ts: "ts", tsx: "ts", mts: "ts", cts: "ts",
  js: "js", jsx: "js", mjs: "js", cjs: "js",
  py: "py", go: "go", rs: "rs", java: "java", kt: "kt", kts: "kt",
  c: "c", h: "h", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", jl: "jl",
};

export function languageOf(path) {
  return EXT_LANG[path.slice(path.lastIndexOf(".") + 1)];
}

/** Blanks comments with spaces so offsets and line numbers stay valid. */
function blankComments(text, lang) {
  if (lang === "py" || lang === "jl") {
    return text.replace(/^[ \t]*#.*$/gm, (m) => " ".repeat(m.length));
  }
  if (!C_STYLE.has(lang)) {
    return text;
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^.*$/gm, (line) => {
      // A `//` starts a comment only outside a string: require an even quote
      // count before it, so "http://x" stays intact.
      for (let i = line.indexOf("//"); i !== -1; i = line.indexOf("//", i + 1)) {
        if ((line.slice(0, i).match(/["'`]/g) ?? []).length % 2 === 0) {
          return line.slice(0, i) + " ".repeat(line.length - i);
        }
      }
      return line;
    });
}

function matches(text, re, build) {
  return [...text.matchAll(re)].map((m) => ({ ...build(m), line: lineOf(text, m.index) }));
}

const EXTRACTORS = {
  ts(text) {
    const imp = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g;
    const re =
      /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*["']([^"'\n]+)["']/g;
    const reexports = matches(text, re, (m) => ({ specifier: m[1], kind: "reexport" }));
    const seen = new Set(reexports.map((e) => `${e.specifier}:${e.line}`));
    const imports = matches(text, imp, (m) => ({ specifier: m[2], kind: "import" })).filter(
      (e) => !seen.has(`${e.specifier}:${e.line}`)
    );
    return [...imports, ...reexports];
  },
  py(text) {
    return [
      ...matches(text, /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import\b([^\n]*)/gm, (m) => ({
        specifier: m[1],
        kind: "import",
        names: m[2]
          .replace(/[()]/g, " ")
          .split(",")
          .map((n) => n.trim().split(/\s+/)[0])
          .filter((n) => /^\w+$/.test(n)),
      })),
      ...matches(text, /^[ \t]*import[ \t]+([\w.]+)/gm, (m) => ({
        specifier: m[1],
        kind: "import",
      })),
    ];
  },
  go(text) {
    const block = [...text.matchAll(/\bimport\s*\(([\s\S]*?)\)/g)].flatMap((b) =>
      matches(b[1], /"([^"\n]+)"/g, (m) => ({ specifier: m[1], kind: "import" })).map((e) => ({
        ...e,
        line: lineOf(text, b.index) + e.line - 1,
      }))
    );
    return [
      ...block,
      ...matches(text, /^\s*import\s+(?:[\w.]+\s+)?"([^"\n]+)"/gm, (m) => ({
        specifier: m[1],
        kind: "import",
      })),
    ];
  },
  rs(text) {
    return [
      ...matches(text, /^[ \t]*(pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([\w:]+)/gm, (m) => ({
        specifier: m[2],
        kind: m[1] ? "reexport" : "import",
      })),
      ...matches(text, /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm, (m) => ({
        specifier: `mod::${m[1]}`,
        kind: "import",
      })),
    ];
  },
  java(text) {
    return matches(text, /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+?)(\.\*)?[ \t]*;?[ \t]*$/gm, (m) => ({
      specifier: m[1] + (m[2] ?? ""),
      kind: "import",
    }));
  },
  c(text) {
    return matches(text, /^[ \t]*#[ \t]*include[ \t]+"([^"\n]+)"/gm, (m) => ({
      specifier: m[1],
      kind: "import",
    }));
  },
  jl(text) {
    return [
      ...matches(text, /\binclude\(\s*"([^"\n]+)"\s*\)/g, (m) => ({
        specifier: m[1],
        kind: "import",
      })),
      ...matches(text, /^[ \t]*(?:using|import)[ \t]+\.+(\w+)/gm, (m) => ({
        specifier: `module::${m[1]}`,
        kind: "import",
      })),
    ];
  },
};
EXTRACTORS.js = EXTRACTORS.ts;
EXTRACTORS.kt = EXTRACTORS.java;
EXTRACTORS.h = EXTRACTORS.c;
EXTRACTORS.cpp = EXTRACTORS.c;

/** Index of every path suffix (at `/` boundaries) to the first file that has it. */
function suffixIndex(files) {
  const index = new Map();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 0; i < parts.length; i += 1) {
      const suffix = parts.slice(i).join("/");
      index.has(suffix) || index.set(suffix, file);
    }
  }
  return index;
}

const TS_EXTS = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function resolver(root, files, skipped) {
  const fileSet = new Set(files);
  const suffixes = suffixIndex(files);
  const firstIn = (dir, exts) =>
    files.find((f) => dirname(f) === dir && exts.some((e) => f.endsWith(e)));
  const goModule = (() => {
    const text = fileSet.has("go.mod") ? readText(root, "go.mod", skipped) : undefined;
    return /^module\s+(\S+)/m.exec(text ?? "")?.[1];
  })();
  const jlModules = new Map();
  for (const file of files.filter((f) => f.endsWith(".jl"))) {
    const text = readText(root, file, skipped) ?? "";
    for (const m of text.matchAll(/^[ \t]*(?:bare)?module[ \t]+(\w+)/gm)) {
      jlModules.has(m[1]) || jlModules.set(m[1], file);
    }
  }
  const crateRoot = (file) => {
    for (let dir = dirname(file); ; dir = dirname(dir)) {
      const base = dir === "." ? "" : `${dir}/`;
      if (fileSet.has(`${base}lib.rs`) || fileSet.has(`${base}main.rs`)) {
        return dir === "." ? "" : dir;
      }
      if (dir === "." || dir === "/") {
        return undefined;
      }
    }
  };
  const tsRelative = (file, spec) => {
    const base = posix.join(dirname(file), spec);
    const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
    for (const candidate of [base, stem]) {
      for (const ext of TS_EXTS) {
        for (const form of [`${candidate}${ext}`, `${candidate}/index${ext}`]) {
          if (fileSet.has(form) && form !== file) {
            return form;
          }
        }
      }
    }
    return undefined;
  };
  const dotted = (spec, exts) => {
    const parts = spec.replace(/\.\*$/, "").split(".");
    for (let n = parts.length; n >= 1; n -= 1) {
      const rel = parts.slice(0, n).join("/");
      for (const ext of exts) {
        for (const form of [`${rel}${ext}`, `${rel}/__init__${ext}`]) {
          if (suffixes.has(form)) {
            return suffixes.get(form);
          }
        }
      }
    }
    return undefined;
  };

  return (file, lang, spec) => {
    switch (lang) {
      case "ts":
      case "js":
        return spec.startsWith(".") ? tsRelative(file, spec) : undefined;
      case "py": {
        const lead = /^\.*/.exec(spec)[0].length;
        if (lead > 0) {
          let dir = dirname(file);
          for (let i = 1; i < lead; i += 1) {
            dir = dirname(dir);
          }
          const rest = spec.slice(lead).replace(/\./g, "/");
          const base = dir === "." ? "" : `${dir}/`;
          for (const form of [`${base}${rest}.py`, `${base}${rest}/__init__.py`]) {
            if (rest !== "" && fileSet.has(form)) {
              return form;
            }
          }
          return fileSet.has(`${base}__init__.py`) && rest === "" ? `${base}__init__.py` : undefined;
        }
        return dotted(spec, [".py"]);
      }
      case "go": {
        const path = goModule && spec.startsWith(goModule) ? spec.slice(goModule.length + 1) : spec;
        const parts = path.split("/");
        for (let n = parts.length; n >= 1; n -= 1) {
          const dir = parts.slice(parts.length - n).join("/");
          const hit = files.find(
            (f) => f.endsWith(".go") && !f.endsWith("_test.go") && (dirname(f) === dir || dirname(f).endsWith(`/${dir}`))
          );
          if (hit !== undefined) {
            return hit;
          }
        }
        return undefined;
      }
      case "rs": {
        const crate = crateRoot(file);
        if (crate === undefined) {
          return undefined;
        }
        let segments;
        let dir;
        if (spec.startsWith("mod::")) {
          dir = dirname(file);
          segments = [spec.slice(5)];
        } else if (spec.startsWith("crate::")) {
          dir = crate;
          segments = spec.slice(7).split("::");
        } else if (spec.startsWith("super::")) {
          dir = dirname(dirname(file));
          segments = spec.slice(7).split("::");
        } else {
          return undefined;
        }
        for (let n = segments.length; n >= 1; n -= 1) {
          const rel = segments.slice(0, n).join("/");
          const base = dir === "." || dir === "" ? "" : `${dir}/`;
          for (const form of [`${base}${rel}.rs`, `${base}${rel}/mod.rs`]) {
            if (fileSet.has(form)) {
              return form;
            }
          }
        }
        return undefined;
      }
      case "java":
      case "kt": {
        const hit = dotted(spec, [".java", ".kt"]);
        if (hit !== undefined || !spec.endsWith(".*")) {
          return hit;
        }
        const dir = spec.slice(0, -2).replace(/\./g, "/");
        return files.find((f) => /\.(java|kt)$/.test(f) && dirname(f).endsWith(dir));
      }
      case "c":
      case "h":
      case "cpp": {
        const local = posix.join(dirname(file), spec);
        return fileSet.has(local) ? local : suffixes.get(spec);
      }
      case "jl": {
        if (spec.startsWith("module::")) {
          return jlModules.get(spec.slice(8));
        }
        const local = posix.join(dirname(file), spec);
        return fileSet.has(local) ? local : undefined;
      }
      default:
        return undefined;
    }
  };
}

export function extractEdges(root, skipped = []) {
  const files = walk(root, skipped);
  const resolve = resolver(root, files, skipped);
  const edges = [];
  for (const file of files) {
    const lang = languageOf(file);
    if (lang === undefined) {
      continue;
    }
    const raw = readText(root, file, skipped);
    if (raw === undefined) {
      continue;
    }
    const text = blankComments(raw, lang);
    for (const { specifier, line, kind, names = [] } of EXTRACTORS[lang](text)) {
      // Python re-exports through names imported in a package __init__.
      const edgeKind = lang === "py" && basename(file) === "__init__.py" ? "reexport" : kind;
      const add = (spec, target) =>
        edges.push({
          from: file,
          to: target === undefined || target === file ? null : target,
          specifier: spec,
          line,
          kind: edgeKind,
          evidence_source: "text",
        });
      const to = resolve(file, lang, specifier);
      // "from pkg import name" can name a submodule, which is a separate edge.
      const submodules = names
        .map((name) => `${specifier}${specifier.endsWith(".") ? "" : "."}${name}`)
        .map((spec) => [spec, resolve(file, lang, spec)])
        .filter(([, target]) => target !== undefined && target !== to);
      (to !== undefined || submodules.length === 0) && add(specifier, to);
      submodules.forEach(([spec, target]) => add(spec, target));
    }
  }
  return { edges, files };
}

function main() {
  const argv = process.argv.slice(2);
  let root;
  let out;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root" && argv[i + 1] !== undefined) {
      root = resolvePath(argv[(i += 1)]);
    } else if (argv[i] === "--out" && argv[i + 1] !== undefined) {
      out = resolvePath(argv[(i += 1)]);
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      process.stdout.write(USAGE);
      return;
    } else {
      die(`edges.mjs: unexpected argument ${argv[i]}\n${USAGE}`);
    }
  }
  try {
    const repo = findRoot(root);
    assertScannable(repo);
    out !== undefined && assertOutsideRepo(out, repo);
    const { edges } = extractEdges(repo);
    const json = `${JSON.stringify(edges, null, 2)}\n`;
    out === undefined ? process.stdout.write(json) : writeFileSync(out, json);
  } catch (error) {
    die(`edges.mjs: ${error.message}`);
  }
}

process.argv[1] === fileURLToPath(import.meta.url) && main();
