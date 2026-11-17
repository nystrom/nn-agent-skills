// Run with: node --test plugins/nn-agent-skills/skills/unhandled-case-scan/scripts/
//
// Runs scan.mjs against a small TypeScript project built in a temp dir. The
// project needs the `typescript` package; those tests skip when it cannot be
// resolved from this repository.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scan = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

let tsPackage;
try {
  tsPackage = dirname(
    createRequire(import.meta.url).resolve("typescript/package.json")
  );
} catch {
  tsPackage = undefined;
}
const needsTs = tsPackage === undefined
  ? { skip: "typescript is not resolvable from this repository" }
  : {};

const SOURCES = {
  "src/gaps.ts": `
export type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };
export type Tag = "a" | "b";

export function area(shape: Shape) {
  switch (shape.kind) {
    case "circle":
      return shape.r;
    case "square":
      return shape.s;
  }
}

export function annotated(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return shape.r;
    case "square":
      return shape.s;
  }
}

export function partial(shape: Shape) {
  switch (shape.kind) {
    case "circle":
      return shape.r;
  }
  return 0;
}

export function open(name: string) {
  switch (name) {
    case "x":
      return 1;
  }
}

export function closedAfter(tag: Tag) {
  switch (tag) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
  return assertNever(tag);
}

export function closedByDefault(tag: Tag) {
  switch (tag) {
    case "a":
      return 1;
    default: {
      const _x: never = tag;
      return _x;
    }
  }
}

export function viaHelper(tag: Tag) {
  switch (tag) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return assertNever(tag);
  }
}

export function assertNever(value: never): never {
  throw new Error("unreachable " + String(value));
}

export function swallow() {
  try {
    JSON.parse("{");
  } catch {}
}

export function explained() {
  try {
    JSON.parse("{");
  } catch {
    // The input is optional, so a parse failure means no value.
  }
}

export function promise(p: Promise<number>) {
  p.catch(() => {});
}
`,
  "src/gaps.test.ts": `
export function ignored(t: "a" | "b") {
  switch (t) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
}
`,
  "src/test/helper.ts": "try { throw 1; } catch {}\n",
};

function project(sources = SOURCES, { linkTs = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unhandled-case-")));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext" },
      include: ["src"],
    })
  );
  for (const [path, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  if (linkTs && tsPackage !== undefined) {
    mkdirSync(join(dir, "node_modules"));
    symlinkSync(tsPackage, join(dir, "node_modules", "typescript"));
  }
  return dir;
}

function run(cwd, ...args) {
  const env = { ...process.env };
  delete env.NODE_PATH;
  const result = spawnSync(process.execPath, [scan, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  let document;
  try {
    document = JSON.parse(result.stdout);
  } catch {
    document = undefined;
  }
  return { ...result, document };
}

const lineOf = (name) =>
  SOURCES["src/gaps.ts"].split("\n").findIndex((l) => l.includes(name)) + 1;

test("reports the unannotated finite-union switch and empty catches", needsTs, () => {
  const { status, document } = run(project());
  assert.equal(status, 1);
  const reported = document.findings.filter((f) => !f.refused);
  assert.deepEqual(
    reported.map((f) => [f.check, f.symbol ?? null]).sort(),
    [
      ["empty-catch", null],
      ["empty-catch", null],
      ["no-default", "area"],
    ]
  );
  const gap = reported.find((f) => f.check === "no-default");
  assert.equal(gap.severity, "medium");
  assert.equal(gap.line, lineOf("switch (shape.kind)"));
  assert.match(gap.proposal, /assertNever\(<narrowed value>\)/);
});

test("refuses each switch the type system already covers, with a reason", needsTs, () => {
  const { document } = run(project());
  const refused = Object.fromEntries(
    document.findings
      .filter((f) => f.refused && f.check === "no-default")
      .map((f) => [f.symbol, f.reason])
  );
  assert.match(refused.annotated, /already TS2366/);
  assert.match(refused.partial, /control continues past the switch/);
  assert.match(refused.open, /open domain/);
  assert.match(refused.closedAfter, /exhaustiveness check follows/);
  assert.equal(refused.closedByDefault, undefined);
  assert.equal(refused.viaHelper, undefined);
});

test("detects the exhaustiveness helper by signature", needsTs, () => {
  const { document } = run(project());
  assert.deepEqual(document.exhaustiveness_helpers, [
    { name: "assertNever", uses: 1 },
  ]);
});

test("proposes a never declaration when no helper exists", needsTs, () => {
  const { document } = run(
    project({
      "src/a.ts": `export function f(t: "a" | "b") {
  switch (t) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
}
`,
    })
  );
  assert.match(document.findings[0].proposal, /const _exhaustive: never/);
});

test("skips test files and test directories", needsTs, () => {
  const { document } = run(project());
  assert.ok(
    document.findings.every(
      (f) => f.file === "src/gaps.ts"
    )
  );
});

test("a comment-only catch is refused, an empty one is reported", needsTs, () => {
  const { document } = run(project());
  const catches = document.findings.filter((f) => f.check === "empty-catch");
  assert.deepEqual(
    catches.map((f) => [f.severity, f.refused]).sort(),
    [
      ["high", false],
      ["high", false],
      ["low", true],
    ]
  );
});

test("exits 0 on a clean project", needsTs, () => {
  const { status, document } = run(
    project({ "src/a.ts": "export const x = 1;\n" })
  );
  assert.equal(status, 0);
  assert.equal(document.counts.reported, 0);
});

test("exits 0 when only refused candidates exist", needsTs, () => {
  const { status, document } = run(
    project({
      "src/a.ts": `export function f(n: string) {
  switch (n) {
    case "a":
      return 1;
  }
}
`,
    })
  );
  assert.equal(status, 0);
  assert.equal(document.counts.refused, 1);
});

test("--scope narrows the scan and an unmatched scope exits 2", needsTs, () => {
  const dir = project({
    ...SOURCES,
    "src/other/b.ts": "export const y = 2;\n",
  });
  const inside = run(dir, "--scope", "src/other");
  assert.equal(inside.status, 0);
  assert.equal(inside.document.counts.candidates, 0);
  const missing = run(dir, "--scope", "nowhere");
  assert.equal(missing.status, 2);
  const outside = run(dir, "--scope", "..");
  assert.equal(outside.status, 2);
});

test("--out writes the document to a file", needsTs, () => {
  const dir = project();
  const out = join(dir, "findings.json");
  const result = run(dir, "--out", out);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /reported/);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).counts.reported, 3);
});

test("exits 2 when the project has no tsconfig.json", needsTs, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unhandled-case-")));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(tsPackage, join(dir, "node_modules", "typescript"));
  const { status, stderr } = run(dir);
  assert.equal(status, 2);
  assert.match(stderr, /no tsconfig\.json/);
});

test("an empty last clause is a partial dispatch", needsTs, () => {
  const { document } = run(
    project({
      "src/a.ts": `export function f(t: "a" | "b") {
  switch (t) {
    case "a":
      return 1;
    case "b":
  }
}
`,
    })
  );
  assert.equal(document.counts.reported, 0);
  assert.match(document.findings[0].reason, /control continues/);
});

test("a void callback does not guard the result", needsTs, () => {
  const { document } = run(
    project({
      "src/a.ts": `type T = "a" | "b";
declare function each(f: (t: T) => void): void;
declare function map(f: (t: T) => number): void;
each((t) => {
  switch (t) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
});
map((t) => {
  switch (t) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
});
`,
    })
  );
  const reasons = document.findings.map((f) => f.reason ?? "reported");
  assert.equal(reasons.length, 2);
  assert.ok(reasons.some((r) => /callback with a contextual/.test(r)));
  assert.ok(reasons.includes("reported"));
});

test("a catch method on a non-promise is not reported", needsTs, () => {
  const { document } = run(
    project({
      "src/a.ts": `declare const bag: { catch(f: () => void): void };
bag.catch(() => {});
`,
    })
  );
  assert.equal(document.counts.candidates, 0);
});

test("a config that fails to parse is skipped and named", needsTs, () => {
  const dir = project();
  mkdirSync(join(dir, "pkg"));
  writeFileSync(
    join(dir, "pkg", "tsconfig.json"),
    JSON.stringify({ extends: "./missing.json" })
  );
  const { document } = run(dir);
  assert.equal(document.skipped.length, 1);
  assert.match(document.skipped[0].reason, /config errors/);
});

test("--scope . accepts the repository root", needsTs, () => {
  assert.equal(run(project(), "--scope", ".").status, 1);
});

test("exits 2 and names the problem when typescript is not installed", () => {
  const { status, stderr } = run(project(SOURCES, { linkTs: false }));
  assert.equal(status, 2);
  assert.match(stderr, /cannot resolve the "typescript" package/);
});

test("exits 2 on an unknown option", needsTs, () => {
  const { status, stderr } = run(project(), "--bogus");
  assert.equal(status, 2);
  assert.match(stderr, /unexpected argument/);
});
