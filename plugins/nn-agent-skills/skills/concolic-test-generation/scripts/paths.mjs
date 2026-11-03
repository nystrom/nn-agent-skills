// The execution tree: paths the suite takes, and the paths one decision away
// from them.
//
// A path is the ordered sequence of branch decisions a single test makes
// through the module under test. Flipping the k-th decision of a known path,
// keeping the first k-1 unchanged, names a new path that is one step off a
// feasible prefix: the same move a concolic engine makes when it negates the
// last conjunct of a path condition and re-solves. Here an LLM plays the part
// of the solver.
//
// Exhaustive path coverage is infinite once loops are involved, so exploration
// is bounded by depth and by how many times one branch may repeat in a prefix.

/** A decision is `[branchId, arm]`. This is its wire form. */
function decisionKey([branchId, arm]) {
  return `${branchId}:${arm}`;
}

function pathKey(decisions) {
  return decisions.map(decisionKey).join(",");
}

export function hasPrefix(decisions, prefix) {
  if (decisions.length < prefix.length) return false;
  return prefix.every(
    (d, i) => decisions[i][0] === d[0] && decisions[i][1] === d[1]
  );
}

/** How many leading decisions two paths share. Used to pick the nearest seed. */
export function commonPrefixLength(a, b) {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    a[n][0] === b[n][0] &&
    a[n][1] === b[n][1]
  ) {
    n++;
  }
  return n;
}

/**
 * Every path one flipped decision away from `trace`.
 *
 * `maxVisits` stops treating a branch as a flip point once it has already
 * appeared that many times in the prefix. In a loop that keeps the candidate
 * count proportional to the branches in the module rather than to the iteration
 * count. `maxDepth` is the hard bound on prefix length.
 */
function divergences(trace, branchMap, { maxDepth, maxVisits }) {
  const out = [];
  const limit = Math.min(trace.length, maxDepth);
  for (let k = 0; k < limit; k++) {
    const [branchId, arm] = trace[k];
    const meta = branchMap[branchId];
    if (meta === undefined) continue;

    const prefix = trace.slice(0, k);
    const visits = prefix.filter((d) => d[0] === branchId).length;
    if (visits >= maxVisits) continue;

    for (let alt = 0; alt < meta.locations.length; alt++) {
      if (alt === arm) continue;
      out.push({
        prefix: [...prefix, [branchId, alt]],
        branchId,
        arm: alt,
        depth: k,
        loc: meta.loc,
        armLoc: meta.locations[alt],
        type: meta.type,
      });
    }
  }
  return out;
}

/**
 * The frontier: divergences from every known path that no known path already
 * realizes, de-duplicated, shortest first.
 *
 * Shortest-first spreads exploration across the tree instead of driving one
 * deep spine, which matters when each step costs an LLM call rather than a
 * solver query.
 */
export function frontier(traces, branchMap, bounds) {
  const known = traces.map((t) => t.decisions);
  const seen = new Set();
  const out = [];
  for (const trace of known) {
    for (const candidate of divergences(trace, branchMap, bounds)) {
      const key = pathKey(candidate.prefix);
      if (seen.has(key)) continue;
      seen.add(key);
      if (known.some((k) => hasPrefix(k, candidate.prefix))) continue;
      out.push({ ...candidate, key });
    }
  }
  out.sort(
    (a, b) =>
      a.prefix.length - b.prefix.length ||
      a.loc.start.line - b.loc.start.line ||
      a.arm - b.arm
  );
  return out;
}

/**
 * The known test whose path shares the most with `prefix`.
 *
 * Ties break toward the shorter path. At depth 0 every trace shares nothing, so
 * without a tie-break the first test of the first file alphabetically would seed
 * every shallow target; the shortest path is the one doing least besides the
 * decision in question, which makes it the easiest to adapt.
 */
export function nearestTrace(traces, prefix) {
  let best = null;
  let bestShared = 0;
  for (const trace of traces) {
    const shared = commonPrefixLength(trace.decisions, prefix);
    const better =
      best === null ||
      shared > bestShared ||
      (shared === bestShared && trace.decisions.length < best.decisions.length);
    if (better) {
      best = trace;
      bestShared = shared;
    }
  }
  return best === null ? null : { trace: best, shared: bestShared };
}

/** Distinct paths, for reporting. */
export function distinctPaths(traces) {
  return new Set(traces.map((t) => pathKey(t.decisions))).size;
}
