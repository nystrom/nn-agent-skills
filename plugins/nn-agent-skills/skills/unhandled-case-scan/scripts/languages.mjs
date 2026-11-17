// Per-language data for candidates.mjs. Each entry is a pattern table, not
// analysis. A pattern that matches is a candidate for the model to verify.
//
// dispatch   Opens a dispatch over a finite set (switch, match, when).
// block      How to find the end of the dispatch: "brace" or "indent".
// mode       "no-default": a dispatch without a catch-all arm is the candidate.
//            "wildcard": the compiler checks exhaustiveness, so a catch-all arm
//            that hides new cases is the candidate.
// catchAll   Matches the catch-all arm inside the dispatch body.
// markers    Calls or constructs that close a dispatch, counted for the report.
// closeWith  Advice used when no marker is found in the repository.
// empty      Handlers that swallow a failure: [{ pattern, severity, signal }].
// commented  Handlers that swallow a failure and carry a comment.
//
// Every pattern needs the `g` flag.

const swallow = (pattern, severity, signal) => ({ pattern, severity, signal });

const BRACE_EMPTY = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
const BRACE_COMMENTED =
  /\bcatch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*\n\s*|\/\*(?:(?!\*\/)[\s\S])*\*\/\s*)+\}/g;

export const LANGUAGES = [
  {
    name: "typescript-javascript",
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    dispatch: /\bswitch\s*\(/g,
    block: "brace",
    mode: "no-default",
    catchAll: /\bdefault\s*:/,
    markers: [/\bassert(?:Never|Unreachable)\w*\s*\(/g, /:\s*never\b/g],
    closeWith:
      "add a default clause with `const _exhaustive: never = <narrowed value>`",
    empty: [
      swallow(BRACE_EMPTY, "high", "catch block is empty"),
      swallow(
        /\.catch\(\s*(?:\(\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)/g,
        "high",
        "promise catch handler is empty"
      ),
    ],
    commented: [BRACE_COMMENTED],
  },
  {
    name: "python",
    extensions: [".py"],
    dispatch: /^[ \t]*match\s+[^\n]+:[ \t]*$/gm,
    block: "indent",
    mode: "no-default",
    catchAll: /^\s*case\s+_\s*:/m,
    markers: [/\bassert_never\s*\(/g],
    closeWith: "add `case _:` that calls `assert_never(<value>)`",
    empty: [
      swallow(
        /\bexcept\b[^:\n]*:[ \t]*\n[ \t]*(?:pass|\.\.\.)[ \t]*(?:\n|$)/g,
        "high",
        "except block only passes"
      ),
      swallow(
        /\bexcept\b[^:\n]*:[ \t]*pass[ \t]*(?:\n|$)/g,
        "high",
        "except block only passes"
      ),
    ],
    commented: [
      /\bexcept\b[^:\n]*:[ \t]*\n(?:[ \t]*#[^\n]*\n)+[ \t]*pass\b/g,
      /\bexcept\b[^:\n]*:[ \t]*\n[ \t]*pass[ \t]*#/g,
      /\bexcept\b[^:\n]*:[ \t]*pass[ \t]*#/g,
    ],
  },
  {
    name: "go",
    extensions: [".go"],
    dispatch: /\bswitch\b[^\n{]*\{/g,
    block: "brace",
    mode: "no-default",
    catchAll: /\bdefault\s*:/,
    markers: [],
    closeWith:
      "enable an exhaustiveness linter that fails the build (for example the `exhaustive` analyzer) and add a `default:` that panics for run time",
    empty: [
      swallow(/\bif\s+err\s*!=\s*nil\s*\{\s*\}/g, "high", "error check is empty"),
      swallow(
        /^[ \t]*_\s*=\s*\w*[eE]rr\w*[ \t]*$/gm,
        "medium",
        "error value is discarded"
      ),
    ],
    commented: [],
  },
  {
    name: "c-cpp",
    extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"],
    dispatch: /\bswitch\s*\(/g,
    block: "brace",
    mode: "no-default",
    catchAll: /\bdefault\s*:/,
    markers: [],
    closeWith:
      "make a new enumerator fail the build: -Werror=switch for a switch with no `default:`, or -Werror=switch-enum when a `default:` that aborts is present",
    empty: [swallow(BRACE_EMPTY, "high", "catch block is empty")],
    commented: [BRACE_COMMENTED],
  },
  {
    name: "java",
    extensions: [".java"],
    dispatch: /\bswitch\s*\(/g,
    block: "brace",
    mode: "no-default",
    catchAll: /\bdefault\s*(?::|->)/,
    markers: [],
    closeWith:
      "use an exhaustive switch over a sealed type or enum, or add a default that throws",
    empty: [swallow(BRACE_EMPTY, "high", "catch block is empty")],
    commented: [BRACE_COMMENTED],
  },
  {
    name: "rust",
    extensions: [".rs"],
    dispatch: /\bmatch\s+[^{;\n]+\{/g,
    block: "brace",
    mode: "wildcard",
    catchAll: /(?:^|[\s,{])_\s*=>/,
    markers: [/\bunreachable!\s*\(/g],
    closeWith: "list the remaining variants so the compiler names a new one",
    empty: [
      swallow(/\blet\s+_\s*=\s*[^;]+;/g, "low", "result is discarded"),
      swallow(/\.unwrap_or_default\(\)/g, "low", "failure becomes a default"),
    ],
    commented: [],
  },
  {
    name: "kotlin",
    extensions: [".kt", ".kts"],
    dispatch: /\bwhen\s*(?:\([^)]*\))?\s*\{/g,
    block: "brace",
    mode: "wildcard",
    catchAll: /\belse\s*->/,
    markers: [],
    closeWith: "list the remaining subtypes so the compiler names a new one",
    empty: [swallow(BRACE_EMPTY, "high", "catch block is empty")],
    commented: [BRACE_COMMENTED],
  },
  {
    name: "swift",
    extensions: [".swift"],
    dispatch: /\bswitch\b[^\n{]*\{/g,
    block: "brace",
    mode: "wildcard",
    catchAll: /\bdefault\s*:/,
    markers: [/@unknown\s+default/g],
    closeWith: "use `@unknown default:` so the compiler warns on a new case",
    empty: [
      swallow(/\bcatch\s*\{\s*\}/g, "high", "catch block is empty"),
      swallow(/\btry\?\s/g, "low", "error becomes nil"),
    ],
    commented: [BRACE_COMMENTED],
  },
  {
    name: "ruby",
    extensions: [".rb"],
    dispatch: null,
    empty: [
      swallow(/\brescue\s+nil\b/g, "high", "rescue returns nil"),
      swallow(
        /\brescue\b[^\n#]*\n[ \t]*end\b/g,
        "high",
        "rescue block is empty"
      ),
    ],
    commented: [],
  },
  {
    name: "julia",
    extensions: [".jl"],
    dispatch: null,
    empty: [
      swallow(/\bcatch\b[^\n#]*\n[ \t]*end\b/g, "high", "catch block is empty"),
    ],
    commented: [],
  },
];
