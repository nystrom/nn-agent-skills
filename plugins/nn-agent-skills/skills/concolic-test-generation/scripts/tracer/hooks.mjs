// Jest `setupFilesAfterEnv` entry: split the decision stream into one path per
// test and write it out. Pairs with ./setup.mjs, which installs the recorder.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.CONCOLIC_TRACE_DIR;

if (dir !== undefined) {
  mkdirSync(dir, { recursive: true });
  // One line per test, appended: concurrent workers never interleave a write
  // this small, and the driver does not need the file to be valid JSON until it
  // reads it.
  const out = join(dir, `traces-${process.pid}.jsonl`);

  beforeEach(() => {
    globalThis.__concolic__.reset();
  });

  afterEach(() => {
    const state = expect.getState();
    appendFileSync(
      out,
      `${JSON.stringify({
        testPath: state.testPath,
        testName: state.currentTestName,
        decisions: globalThis.__concolic__.take(),
      })}\n`
    );
  });
}
