// Shared file-system and glob helpers. Language-neutral; Node 20+.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  ".next",
  ".turbo",
  ".claude",
]);
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export function toPosix(path) {
  return path.split(sep).join("/");
}

export function findRoot(explicit) {
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
export function walk(root, skipped) {
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

/** Reads a text file. Returns undefined and records a skip on symlink, size, or read error. */
export function readText(root, path, skipped) {
  try {
    const info = lstatSync(join(root, path));
    if (info.isSymbolicLink()) {
      skipped.push({ path, reason: "symlink" });
      return undefined;
    }
    if (info.size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: `larger than ${MAX_FILE_BYTES} bytes` });
      return undefined;
    }
    return readFileSync(join(root, path), "utf8");
  } catch (error) {
    skipped.push({ path, reason: `unreadable: ${error.code}` });
    return undefined;
  }
}

export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    text.charCodeAt(i) === 10 && (line += 1);
  }
  return line;
}

/** Glob to RegExp: `*` within a segment, `**` across segments, `{a,b}` alternatives. */
export function globToRegExp(pattern) {
  let out = "";
  const text = pattern.replace(/^\.\//, "");
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "*" && text[i + 1] === "*") {
      const slash = text[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "{") {
      out += "(?:";
    } else if (c === "}") {
      out += ")";
    } else if (c === ",") {
      out += /\{[^}]*$/.test(text.slice(0, i)) ? "|" : ",";
    } else {
      out += /[.+^$()|[\]\\?]/.test(c) ? `\\${c}` : c;
    }
  }
  return new RegExp(`^${out}$`);
}

export function matcher(globs) {
  const regexps = globs.map(globToRegExp);
  return (path) => regexps.some((re) => re.test(path));
}

export function assertScannable(root) {
  (existsSync(root) && statSync(root).isDirectory()) || die(`root is not a directory: ${root}`);
}

/** The scripts never write inside the repo under review. */
export function assertOutsideRepo(out, root) {
  const realRoot = realpathSync(root);
  let probe = resolve(out);
  const tail = [];
  while (!existsSync(probe)) {
    tail.unshift(basename(probe));
    probe = dirname(probe);
  }
  const real = join(realpathSync(probe), ...tail);
  (real === realRoot || real.startsWith(`${realRoot}${sep}`)) &&
    die(`output path is inside the repository under review: ${out}`);
}
