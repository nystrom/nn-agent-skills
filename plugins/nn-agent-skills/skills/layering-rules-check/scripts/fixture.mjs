// Test helper: builds a repo in a temp dir and removes it at exit.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const dirs = [];
process.on("exit", () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

export function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "layering-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
