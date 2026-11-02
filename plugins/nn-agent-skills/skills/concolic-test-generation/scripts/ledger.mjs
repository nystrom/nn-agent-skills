// Remember which paths were given up on, so repeated runs do not burn retries
// on the same defensive `throw`.
//
// The ledger lives in the target repository, not beside this script: a plugin's
// directory is a shared cache that an update replaces.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function load(path) {
  if (!existsSync(path)) return { arms: {} };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function save(path, ledger) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

/**
 * Hash the whole source file.
 *
 * A path is a sequence of istanbul branch ids, and those are numbered per file,
 * so an edit anywhere can renumber every decision in the path. Nothing narrower
 * than the file is a safe validity check for a stored record.
 */
export function sourceHash(source) {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

/** Whether a previous run already retired this path, unchanged since. */
export function isRetired(ledger, key, hash) {
  const record = ledger.arms[key];
  if (record === undefined) return false;
  if (record.sourceHash !== hash) return false;
  return (
    record.status === "gaveup" ||
    record.status === "infeasible" ||
    record.status === "unreachable"
  );
}

export function record(ledger, key, { status, reason, hash, attempts }) {
  const previous = ledger.arms[key];
  ledger.arms[key] = {
    status,
    reason,
    sourceHash: hash,
    attempts:
      (previous?.sourceHash === hash ? (previous.attempts ?? 0) : 0) + attempts,
    updated: new Date().toISOString(),
  };
}
