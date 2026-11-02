// Jest `setupFiles` entry: record the ORDER in which branch arms execute.
//
// Istanbul's counters are aggregates, so they say which arms ran but not along
// which path. The instrumented code increments through a property set,
// `cov().b[branchId][arm]++`, so wrapping each `b[branchId]` array in a Proxy
// yields the exact decision sequence, and istanbul's own `branchMap` still
// supplies the source locations. That is why this reuses istanbul rather than
// adding a second instrumentation pass.
//
// This must run before the module under test is imported, hence `setupFiles`
// rather than `setupFilesAfterEnv`.

const sourcePath = process.env.CONCOLIC_TRACE_SOURCE;

const decisions = [];
const store = {};

globalThis.__concolic__ = {
  decisions,
  reset() {
    decisions.length = 0;
  },
  take() {
    return decisions.splice(0, decisions.length);
  },
};

/** Wrap the `b` arrays so each increment appends to the trace. */
function instrument(path, data) {
  if (sourcePath !== undefined && path !== sourcePath) return data;
  for (const branchId of Object.keys(data.b)) {
    data.b[branchId] = new Proxy(data.b[branchId], {
      set(target, prop, value) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          decisions.push([branchId, Number(prop)]);
        }
        target[prop] = value;
        return true;
      },
    });
  }
  return data;
}

// Istanbul's preamble does `global.__coverage__[path] = coverageData` and then
// reads the value back, so a `set` trap here is enough to wrap every file.
globalThis.__coverage__ = new Proxy(store, {
  set(target, path, data) {
    target[path] =
      typeof path === "string" && data !== null && typeof data === "object"
        ? instrument(path, data)
        : data;
    return true;
  },
});
