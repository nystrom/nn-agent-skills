// Run with: node --test plugins/nn-agent-skills/skills/concolic-test-generation/scripts/
//
// These cover the search itself, which has no other check: a wrong frontier
// still produces plausible output while exploring the wrong tree.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commonPrefixLength,
  frontier,
  hasPrefix,
  nearestTrace,
} from "./paths.mjs";

/** Two two-armed branches, `0` and `1`. */
const branchMap = {
  0: {
    type: "if",
    loc: { start: { line: 2, column: 2 } },
    locations: [{}, {}],
  },
  1: {
    type: "if",
    loc: { start: { line: 3, column: 4 } },
    locations: [{}, {}],
  },
};
const bounds = { maxDepth: 12, maxVisits: 2 };

const trace = (decisions) => ({ decisions });

test("hasPrefix compares decisions pairwise, not by identity", () => {
  assert.equal(
    hasPrefix(
      [
        ["0", 1],
        ["1", 0],
      ],
      [["0", 1]]
    ),
    true
  );
  assert.equal(
    hasPrefix(
      [["0", 1]],
      [
        ["0", 1],
        ["1", 0],
      ]
    ),
    false
  );
  assert.equal(hasPrefix([["0", 1]], [["0", 0]]), false);
});

test("commonPrefixLength stops at the first difference", () => {
  assert.equal(
    commonPrefixLength(
      [
        ["0", 1],
        ["1", 0],
      ],
      [
        ["0", 1],
        ["1", 1],
      ]
    ),
    1
  );
  assert.equal(commonPrefixLength([], [["0", 0]]), 0);
});

test("a single path yields one flip per decision", () => {
  const front = frontier(
    [
      trace([
        ["0", 0],
        ["1", 0],
      ]),
    ],
    branchMap,
    bounds
  );
  assert.deepEqual(
    front.map((f) => f.prefix),
    [
      [["0", 1]],
      [
        ["0", 0],
        ["1", 1],
      ],
    ]
  );
});

test("a flip already realized by another known path is not offered", () => {
  const front = frontier(
    [
      trace([
        ["0", 0],
        ["1", 0],
      ]),
      trace([["0", 1]]),
    ],
    branchMap,
    bounds
  );
  assert.deepEqual(
    front.map((f) => f.prefix),
    [
      [
        ["0", 0],
        ["1", 1],
      ],
    ]
  );
});

test("the same divergence reached from two paths is offered once", () => {
  const front = frontier(
    [
      trace([
        ["0", 0],
        ["1", 0],
      ]),
      trace([
        ["0", 0],
        ["1", 0],
      ]),
    ],
    branchMap,
    bounds
  );
  assert.equal(front.length, 2);
});

test("maxDepth bounds how deep a divergence may sit", () => {
  const front = frontier(
    [
      trace([
        ["0", 0],
        ["1", 0],
      ]),
    ],
    branchMap,
    {
      ...bounds,
      maxDepth: 1,
    }
  );
  assert.deepEqual(
    front.map((f) => f.prefix),
    [[["0", 1]]]
  );
});

test("maxVisits stops a repeated branch from being a flip point forever", () => {
  const looping = trace([
    ["0", 0],
    ["0", 0],
    ["0", 0],
    ["0", 0],
  ]);
  const front = frontier([looping], branchMap, { ...bounds, maxVisits: 2 });
  // Flips at index 0 and 1 only: by index 2 the branch has already been seen
  // twice in the prefix.
  assert.deepEqual(
    front.map((f) => f.prefix.length),
    [1, 2]
  );
});

test("the frontier is ordered shortest first", () => {
  const front = frontier(
    [
      trace([
        ["0", 0],
        ["1", 0],
      ]),
      trace([["1", 0]]),
    ],
    branchMap,
    bounds
  );
  const lengths = front.map((f) => f.prefix.length);
  assert.deepEqual(
    [...lengths].sort((a, b) => a - b),
    lengths
  );
});

test("the nearest trace is the one sharing the longest prefix", () => {
  const near = nearestTrace(
    [
      trace([["1", 0]]),
      trace([
        ["0", 0],
        ["1", 1],
      ]),
    ],
    [
      ["0", 0],
      ["1", 0],
    ]
  );
  assert.equal(near.shared, 1);
  assert.deepEqual(near.trace.decisions, [
    ["0", 0],
    ["1", 1],
  ]);
});

test("with nothing shared, the shortest path wins rather than the first", () => {
  const near = nearestTrace(
    [
      trace([
        ["1", 0],
        ["1", 0],
        ["1", 0],
      ]),
      trace([["1", 1]]),
    ],
    [["0", 0]]
  );
  assert.equal(near.shared, 0);
  assert.deepEqual(near.trace.decisions, [["1", 1]]);
});
