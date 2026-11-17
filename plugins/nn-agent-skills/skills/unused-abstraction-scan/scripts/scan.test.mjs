// Run with: node --test plugins/nn-agent-skills/skills/unused-abstraction-scan/scripts/
//
// Each test builds a small TypeScript repo in a temp dir and runs the CLI in
// it. A refusal and a finding differ only in `refused`, so every test checks
// that field and the reason, not only that something was printed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "scan.mjs");

const files = {
  "package.json": JSON.stringify({ name: "fx", private: true }),
  ".eslintrc.json": JSON.stringify({
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  }),
  "src/options.ts": `export interface RunOptions {
  /** This is not implemented, so setting it has no effect. */
  immediate?: boolean;
  verbose?: boolean;
}

export interface LiveOptions {
  /** This has no effect. */
  fast?: boolean;
}

export interface Empty {}

export interface Marker {}

export interface Req {}

export interface Unused {
  a?: number;
  b?: string;
}
`,
  "src/run.ts": `import type {
  RunOptions,
  LiveOptions,
  Empty,
  Req,
  Unused,
} from "./options";

export function go(opts: RunOptions) {
  return opts.verbose;
}

export function live(o: LiveOptions) {
  return o.fast;
}

export function run(x: number, _options?: Unused) {
  return x;
}

export function e(x: number, _options?: Empty) {
  return x;
}

export function h(opts: Req) {
  return opts;
}
`,
};

function makeRepo(extra = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unused-abstraction-")));
  for (const [path, text] of Object.entries({ ...files, ...extra })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function scan(dir, args = [], env = {}) {
  const run = spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  let document = null;
  try {
    document = JSON.parse(run.stdout);
  } catch {
    // Summary output or an error.
  }
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, document };
}

const bySymbol = (document, symbol) =>
  document.findings.find((finding) => finding.symbol === symbol);

test("reports internal unused indirection and refuses the rest", () => {
  const { status, document } = scan(makeRepo());
  assert.equal(status, 1);

  const inert = bySymbol(document, "RunOptions.immediate");
  assert.equal(inert.refused, false);
  assert.match(inert.proposal, /^delete immediate; no test file names it/);
  assert.match(inert.evidence, /consumer verdict for RunOptions: internal-only/);

  const live = bySymbol(document, "LiveOptions.fast");
  assert.equal(live.refused, true);
  assert.match(live.reason, /production code reads \.fast/);

  const empty = bySymbol(document, "Empty");
  assert.equal(empty.refused, false);
  assert.equal(empty.check, "empty-options");

  assert.equal(bySymbol(document, "Marker"), undefined);

  const required = bySymbol(document, "Req");
  assert.equal(required.refused, true);
  assert.match(required.reason, /other than as an optional parameter at src\/run\.ts/);

  const params = document.findings.filter((f) => f.check === "unread-param");
  const unused = params.find((f) => /Unused/.test(f.signal));
  assert.equal(unused.refused, false);
  assert.match(unused.proposal, /drop the parameter, and Unused with it/);
  const emptyParam = params.find((f) => /Empty/.test(f.signal));
  assert.equal(emptyParam.refused, true);
  assert.match(emptyParam.reason, /declares no fields/);
});

test("a published package is refused offline with verdict unknown", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const { status, document } = scan(dir, ["--offline"]);
  assert.equal(status, 0);
  assert.equal(document.counts.reported, 0);
  const inert = bySymbol(document, "RunOptions.immediate");
  assert.equal(inert.refused, true);
  assert.match(inert.evidence, /RunOptions: unknown \(--offline\)/);
});

test("--assume-unpublished clears a published package", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const { document } = scan(dir, ["--assume-unpublished"]);
  const inert = bySymbol(document, "RunOptions.immediate");
  assert.equal(inert.refused, false);
  assert.match(inert.evidence, /assumed by --assume-unpublished/);
});

test("a reference from another package refuses the deletion", () => {
  const dir = makeRepo({
    "other/package.json": JSON.stringify({ name: "other", private: true }),
    "other/use.ts": 'import type { RunOptions } from "../src/options";\n',
  });
  const { document } = scan(dir);
  const inert = bySymbol(document, "RunOptions.immediate");
  assert.equal(inert.refused, true);
  assert.match(inert.evidence, /exported-with-hits \(named in another package at other\/use\.ts:1\)/);
});

test("gh search hits in another repository give exported-with-hits", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const bin = join(dir, "fake-bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
if [ "$1" = repo ]; then echo me/fx; exit 0; fi
echo '[{"repository":{"nameWithOwner":"other/app"},"path":"a.ts"}]'
`
  );
  chmodSync(join(bin, "gh"), 0o755);
  const { document } = scan(dir, [], { PATH: `${bin}:${process.env.PATH}` });
  const inert = bySymbol(document, "RunOptions.immediate");
  assert.equal(inert.refused, true);
  assert.match(inert.evidence, /exported-with-hits \(1 hits in other repositories, first other\/app:a\.ts\)/);
});

test("a failing gh gives unknown", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ name: "fx" }) });
  const bin = join(dir, "fake-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "gh"), 0o755);
  const { document } = scan(dir, [], { PATH: `${bin}:${process.env.PATH}` });
  assert.match(bySymbol(document, "RunOptions.immediate").evidence, /RunOptions: unknown/);
});

test("a destructuring read makes a field live", () => {
  const dir = makeRepo({
    "src/more.ts": `import type { RunOptions } from "./options";

export function more({ immediate }: RunOptions) {
  return immediate;
}
`,
  });
  const { document } = scan(dir);
  assert.equal(bySymbol(document, "RunOptions.immediate").refused, true);
});

test("a merged interface declaration refuses the deletion", () => {
  const dir = makeRepo({
    "src/merge.ts": "export interface RunOptions {\n  extra?: string;\n}\n",
  });
  const { document } = scan(dir);
  const inert = bySymbol(document, "RunOptions.immediate");
  assert.equal(inert.refused, true);
  assert.match(inert.reason, /declared more than once/);
});

test("a design comment that names the target is quoted into the finding", () => {
  const dir = makeRepo({
    "src/DESIGN.md": "RunOptions is the bag the runner takes.\n",
  });
  const { document } = scan(dir);
  assert.match(
    bySymbol(document, "RunOptions.immediate").evidence,
    /src\/DESIGN\.md argues for this shape: "RunOptions is the bag the runner takes\."/
  );
});

test("test files that name the field are listed in the proposal", () => {
  const dir = makeRepo({
    "src/run.test.ts": "const x = { immediate: true };\n",
  });
  const { document } = scan(dir);
  assert.match(
    bySymbol(document, "RunOptions.immediate").proposal,
    /src\/run\.test\.ts:1/
  );
});

test("a symlink to a file outside the tree refuses every proposal", () => {
  const outside = makeRepo();
  const dir = makeRepo();
  writeFileSync(join(outside, "leak.ts"), "export const v = x.immediate;\n");
  symlinkSync(join(outside, "leak.ts"), join(dir, "src/leak.ts"));
  const { status, document } = scan(dir);
  assert.equal(status, 0);
  assert.deepEqual(document.skippedFiles, ["src/leak.ts"]);
  const inert = bySymbol(document, "RunOptions.immediate");
  assert.equal(inert.refused, true);
  assert.match(inert.reason, /1 source files were not scanned/);
});

test("a symlink to a file inside the tree is ignored", () => {
  const dir = makeRepo();
  symlinkSync(join(dir, "src/run.ts"), join(dir, "src/alias.ts"));
  const { document } = scan(dir);
  assert.deepEqual(document.skippedFiles, []);
  assert.equal(bySymbol(document, "RunOptions.immediate").refused, false);
});

test("a symlink to an unlisted file inside the tree is skipped", () => {
  const dir = makeRepo({ "node_modules/pkg/x.ts": "export const x = 1;\n" });
  symlinkSync(join(dir, "node_modules/pkg/x.ts"), join(dir, "src/alias.ts"));
  assert.deepEqual(scan(dir).document.skippedFiles, ["src/alias.ts"]);
});

test("an ignored parameter that the file uses as a value is refused", () => {
  const dir = makeRepo({
    "src/value.ts": `import type { Unused } from "./options";

export function v(_options?: Unused) {
  return _options;
}
`,
  });
  const param = scan(dir).document.findings.find(
    (f) => f.check === "unread-param" && f.file === "src/value.ts"
  );
  assert.equal(param.refused, true);
  assert.match(param.reason, /_options is used as a value/);
});

test("an oversized source file refuses every proposal", () => {
  const dir = makeRepo({ "src/big.ts": `// ${"x".repeat(2 * 1024 * 1024)}\n` });
  const { document } = scan(dir);
  assert.deepEqual(document.skippedFiles, ["src/big.ts"]);
  assert.equal(document.counts.reported, 0);
});

test("a read split across lines or nested in destructuring is a read", () => {
  const dir = makeRepo({
    "src/split.ts": `import type { RunOptions } from "./options";

export function a(o: RunOptions) {
  return o.
    immediate;
}
`,
  });
  assert.equal(bySymbol(scan(dir).document, "RunOptions.immediate").refused, true);

  const nested = makeRepo({
    "src/nested.ts": `export function b({ inner: { immediate } }: { inner: Opts }) {
  return immediate;
}
`,
  });
  assert.equal(bySymbol(scan(nested).document, "RunOptions.immediate").refused, true);
});

test("a field of a nested object type has no owner", () => {
  const dir = makeRepo({
    "src/nested-type.ts": `export interface Outer {
  inner: {
    /** This has no effect. */
    deep?: boolean;
  };
}
`,
  });
  assert.equal(bySymbol(scan(dir).document, "Outer.deep"), undefined);
});

test("a type that is also used outside ignored parameters is refused", () => {
  const dir = makeRepo({
    "src/also.ts": `import type { Unused } from "./options";

export function k(u: Unused) {
  return u;
}
`,
  });
  const param = scan(dir).document.findings.find(
    (f) => f.check === "unread-param" && /Unused/.test(f.signal)
  );
  assert.equal(param.refused, true);
  assert.match(param.reason, /Unused is also used at src\/also\.ts:3/);
});

test("a local variable named like an ignored options bag is not a parameter", () => {
  const dir = makeRepo({
    "src/local.ts": `import type { Unused } from "./options";

export function m() {
  const _options: Unused = {};
  return _options;
}
`,
  });
  const params = scan(dir).document.findings.filter(
    (f) => f.check === "unread-param" && f.file === "src/local.ts"
  );
  assert.deepEqual(params, []);
});

test("an unreadable README does not abort the scan", () => {
  const dir = makeRepo();
  mkdirSync(join(dir, "src/README.md"));
  const { status, document } = scan(dir);
  assert.equal(status, 1);
  assert.equal(bySymbol(document, "RunOptions.immediate").refused, false);
});

test("a failed output write exits 2", () => {
  const dir = makeRepo();
  assert.equal(scan(dir, ["--out", "no/such/dir/out.json"]).status, 2);
});

test("--scope limits declarations and keeps readers global", () => {
  const dir = makeRepo({ "lib/x.ts": "export interface Gone {}\nexport function f(a: Gone) { return a; }\n" });
  const { document } = scan(dir, ["--scope", "lib"]);
  assert.deepEqual(
    document.findings.map((f) => f.symbol),
    ["Gone"]
  );
});

test("--ignore-pattern overrides the discovered pattern", () => {
  const dir = makeRepo();
  const { document } = scan(dir, ["--ignore-pattern", "^unused_"]);
  assert.equal(document.findings.filter((f) => f.check === "unread-param").length, 0);
});

test("an eslint pattern is read from the repo config", () => {
  const dir = makeRepo({
    ".eslintrc.json": JSON.stringify({
      rules: { x: ["error", { argsIgnorePattern: "^ignored" }] },
    }),
  });
  const { document } = scan(dir);
  assert.equal(document.ignorePattern.pattern, "^ignored");
  assert.equal(document.findings.filter((f) => f.check === "unread-param").length, 0);
});

test("an empty directory with no tsconfig reports nothing", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unused-abstraction-")));
  const { status, document } = scan(dir);
  assert.equal(status, 0);
  assert.deepEqual(document.counts, { candidates: 0, refused: 0, reported: 0 });
});

test("--out writes the JSON file and prints a ranked summary", () => {
  const dir = makeRepo();
  const { status, stdout } = scan(dir, ["--out", "findings.json"]);
  assert.equal(status, 1);
  assert.ok(existsSync(join(dir, "findings.json")));
  const written = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8"));
  assert.equal(written.tool, "unused-abstraction-scan");
  assert.match(stdout, /^candidates \d+, reported \d+, refused \d+\n1\. \[medium\] src\/options\.ts:3 RunOptions\.immediate/);
});

test("bad arguments exit 2", () => {
  const dir = makeRepo();
  assert.equal(scan(dir, ["--bogus"]).status, 2);
  assert.equal(scan(dir, ["--scope"]).status, 2);
  assert.equal(scan(dir, ["--scope", "../elsewhere"]).status, 2);
  assert.equal(scan(dir, ["--ignore-pattern", "("]).status, 2);
});
