#!/usr/bin/env node
//
// Language-neutral helper for the dead-code-scan skill.
//
//   scan.mjs [scan] [options]   list candidates, roots, and skipped files
//   scan.mjs diff-scope [opts]  print the files a change touches and the symbols it orphans
//   scan.mjs wire FILE          print a judged findings file as review-lens wire findings
//   scan.mjs validate FILE      check a findings file after the judgment pass
//
// Read-only: the only file written is the one named by --out. Without --out the
// findings go to stdout. Nothing in the repository under review is changed.
//
// The scan is text based: it counts identifier tokens across every text file
// in the repository and reads declaration lines with one generic pattern. It
// proposes candidates. It cannot prove a symbol dead; the model confirms each
// candidate with a language server, text search, or reading (see SKILL.md).
//
// Exit codes: 0 no candidates, 1 candidates or refusals for the judgment pass,
// 2 could not run or invalid input.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

const usage = `usage: scan.mjs [scan] [options]
       scan.mjs diff-scope [--base <ref>] [--working-tree]
       scan.mjs wire FILE
       scan.mjs validate FILE

Run from inside the git repository to scan.

Options:
  --scope <path>        Restrict the declaration scan to this subtree.
                        Repeatable. The reference index covers the whole
                        repository.
  --out <file>          Write the findings JSON here instead of stdout. The file
                        must be outside the repository under review.
  --keep <name>         Never propose this symbol. Repeatable.
  --accept-root <id>[:<path>]
                        Treat an unresolved root (roots.unresolved in the
                        output) as evaluated, for the files under <path> or
                        for all files. Use only after the user said what the
                        root loads. other-repositories means --no-external.
                        Repeatable.
  --public-api <path>   The files under <path> are public API of a library
                        that other repositories consume. Repeatable.
  --not-public <path>   The files under <path> are not public API (the user
                        said so). Repeatable. Paths are relative to the
                        current directory; run from the repository root. The
                        most specific path wins.
  --base <ref>          Diff scope: list only candidates in files that
                        <ref>...HEAD touches, and candidates the diff orphans.
                        A range (A..B or A...B) is diffed as given.
                        Roots, public API, and the reference index still cover
                        the whole repository at HEAD.
  --working-tree        With --base, include uncommitted and untracked files.
  --format wire         Print review-lens wire findings (a JSON array) instead
                        of the scan document.
  --no-external         Skip the cross-repository search. Use only when the
                        repository has no consumers elsewhere.
  --org <owner>         GitHub owner to search. Default: owner of the origin
                        remote.
  --max-external <n>    Search at most n distinct symbols (default 40).
  --max-candidates <n>  Keep at most n candidates (default 500).
  --max-file-bytes <n>  Do not read files larger than n bytes (default 50 MB).
  --pace-ms <ms>        Wait between searches (default 6500).
  --retry-ms <ms>       Wait before retrying a failed search (default 30000).
  -h, --help            This text.

The findings JSON goes to stdout (or --out); a summary goes to stderr.
diff-scope prints {base, files, orphan_symbols, removed_only_symbols}.
wire turns a findings file after the judgment pass into the wire format.
validate checks that every script finding carries a judgment and every
finding names its source and evidence source.
`;

const GH = process.env.DEAD_CODE_SCAN_GH ?? "gh";

const LANGUAGES = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".kts": "kotlin",
  ".scala": "scala", ".cs": "csharp", ".swift": "swift", ".dart": "dart", ".jl": "julia",
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
  ".rb": "ruby", ".php": "php", ".ex": "elixir", ".exs": "elixir", ".lua": "lua", ".zig": "zig",
};
const HEADER_EXT = new Set([".h", ".hpp", ".hh"]);
const GENERATED_SEGMENTS = new Set([
  "node_modules", "vendor", "target", "build", "dist", "out", "coverage", ".venv", "venv",
  "__pycache__", ".gradle", ".next", "site-packages",
]);
const SUPPORT_SEGMENTS = new Set([
  "fixtures", "samples", "examples", "e2e", "testdata", "mocks", "__mocks__",
]);
const TEST_PATH = [
  /(^|\/)(tests?|__tests__|specs?)\//,
  /\.(test|spec)\.[^/]+$/,
  /_test\.[^/]+$/,
  /(^|\/)test_[^/]+\.py$/,
  /Tests?\.(java|kt|cs|swift|scala)$/,
  /_spec\.rb$/,
  /(^|\/)runtests\.jl$/,
];
const DOC_NAMES = ["README.md", "README.rst", "DESIGN.md", "ARCHITECTURE.md"];
const MAX_DECLARATION_BYTES = 2 * 1024 * 1024;

const PACKAGE_MANIFESTS = new Set([
  "package.json", "Cargo.toml", "go.mod", "pyproject.toml", "setup.py", "pom.xml",
  "build.gradle", "build.gradle.kts", "Package.swift", "Project.toml", "mix.exs",
  "Gemfile", "composer.json", "deno.json",
]);
const BUILD_FILES = new Set([
  ...PACKAGE_MANIFESTS, "Makefile", "justfile", "CMakeLists.txt", "meson.build", "BUILD",
  "BUILD.bazel", "Taskfile.yml", "Dockerfile", "requirements.txt", "setup.cfg",
]);
const CI_FILE =
  /(^|\/)(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|\.circleci\/config\.yml|azure-pipelines\.yml|Jenkinsfile)$/;
const TOOL_CONFIG =
  /\.config\.[cm]?[jt]s$|(^|\/)\.?(eslintrc|babelrc|prettierrc)|(^|\/)(conftest\.py|tox\.ini|pytest\.ini|noxfile\.py|build\.rs|Rakefile)$/;

// One pattern for declaration lines across languages. Methods and C-style
// declarations that have no keyword are out of reach; see references/languages.md.
const MODS =
  "(?:(?:export|pub(?:\\([^)]*\\))?|public|protected|private|internal|open|abstract|final|static|extern(?:\\s+\"[^\"]*\")?|async|unsafe|declare|inline|virtual|override|sealed|data|suspend|const|readonly)\\s+)*";
const KEYWORDS =
  "(?:function|def|fn|func|fun|class|struct|interface|trait|enum|type|typedef|typealias|const|let|var|val|object|module|macro|mutable\\s+struct|abstract\\s+type|primitive\\s+type|record|union|protocol|extension)";
const DECLARATION = new RegExp(
  `^([ \\t]*)(${MODS})(${KEYWORDS})\\s+(?:\\([^)]*\\)\\s*)?([\\p{L}_$][\\p{L}\\p{N}_$]*)`,
  "u"
);
const REEXPORT =
  /^\s*(export\s*(\*|\{|type\s*\{)|pub\s+use\b|from\s+\S+\s+import\b|__all__|module\.exports)/;
const IDENTIFIER = /[\p{L}_$][\p{L}\p{N}_$]*/gu;

const MAIN_ENTRY = [
  /^\s*(?:public\s+)?static\s+void\s+main\s*\(/,
  /^func\s+main\s*\(\s*\)/,
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+main\s*\(/,
  /^\s*fun\s+main\s*\(/,
  /if\s+__name__\s*==\s*["']__main__["']/,
  /^\s*int\s+main\s*\(/,
  /^\s*function\s+main\s*\(|^\s*@main\b|PROGRAM_FILE\s*==/,
  /^#!\//,
];
const DYNAMIC_LOAD = [
  /\b(?:import|require)\(\s*(?:`[^`]*\$\{|[^'"`\s)])/,
  /import\.meta\.glob|require\.context/,
  /\bimportlib\b|__import__\(/,
  /Class\.forName|ServiceLoader|MethodHandles\.lookup/,
  /plugin\.Open\(|MethodByName|reflect\.ValueOf/,
  /\bdlopen\(|LoadLibrary[AW]?\(|libloading::/,
  /\binclude\(\s*[^"'\s)]|Base\.invokelatest|Core\.eval|@eval\b/,
  /\bconst_get\(|constantize/,
];
const FFI_EXPORT =
  /#\[\s*(?:unsafe\s*\(\s*)?no_mangle|extern\s+"C"|^\s*\/\/export\s+\w+|@JvmStatic|JNIEXPORT|__declspec\(\s*dllexport|__attribute__\(\(\s*visibility|@ccallable|#\[pyfunction|#\[wasm_bindgen/;

// Frameworks that load files by path and call their contents by convention.
// `dep` matches manifest text; `files` matches paths those frameworks load.
const FRAMEWORKS = [
  { id: "next", dep: /"next"\s*:/, files: /(^|\/)(pages|app)\// },
  { id: "nuxt", dep: /"nuxt3?"\s*:/, files: /(^|\/)(pages|server|plugins|middleware|layouts|composables)\// },
  { id: "remix", dep: /@remix-run\/|react-router/, files: /(^|\/)routes\// },
  { id: "sveltekit", dep: /@sveltejs\/kit/, files: /(^|\/)(routes|hooks[^/]*)(\/|\.)/ },
  { id: "astro", dep: /"astro"\s*:/, files: /(^|\/)pages\// },
  { id: "gatsby", dep: /"gatsby"/, files: /(^|\/)(pages|templates)\/|gatsby-(node|config|browser|ssr)\./ },
  { id: "storybook", dep: /storybook/, files: /\.stories\.|(^|\/)\.storybook\// },
  { id: "serverless", dep: /serverless|aws-lambda|functions-framework/, files: /handler/i },
  {
    id: "django",
    dep: /django/i,
    files: /(^|\/)(urls|views|admin|models|apps|signals)\.py$|(^|\/)(migrations|management\/commands|templatetags)\//,
  },
  { id: "rails", dep: /\brails\b/, files: /(^|\/)(app|config|db\/migrate)\// },
  { id: "spring", dep: /spring/i, files: /\.(java|kt)$/ },
];
const CONVENTION_DIRS = new Set([
  "migrations", "seeds", "plugins", "handlers", "commands", "routes", "api", "middleware",
]);

function fail(message) {
  process.stderr.write(`scan.mjs: ${message}\n`);
  process.exit(2);
}

function sleep(ms) {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    encoding: "utf8",
    cwd,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseArgs(argv) {
  const options = {
    scopes: [],
    keep: new Set(),
    acceptRoots: [],
    base: undefined,
    workingTree: false,
    format: "scan",
    diffScopeOnly: false,
    publicApi: [],
    notPublic: [],
    out: undefined,
    external: true,
    org: undefined,
    maxExternal: 40,
    maxCandidates: 500,
    maxFileBytes: 50 * 1024 * 1024,
    paceMs: 6500,
    retryMs: 30000,
  };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith("-") && v !== "-")) {
      fail(`${flag} needs a value`);
    }
    return v;
  };
  const integer = (i, flag) => {
    const n = Number(value(i, flag));
    if (!Number.isInteger(n) || n < 0) {
      fail(`${flag} needs a non-negative integer`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--scope":
        options.scopes.push(value(i, "--scope"));
        break;
      case "--out":
        options.out = value(i, "--out");
        break;
      case "--keep":
        options.keep.add(value(i, "--keep"));
        break;
      case "--accept-root": {
        const raw = value(i, "--accept-root");
        if (raw === "other-repositories") {
          options.external = false; // the caller asserts there are none
        } else {
          options.acceptRoots.push(raw);
        }
        break;
      }
      case "--diff-scope-only":
        options.diffScopeOnly = true;
        continue;
      case "--base":
        options.base = value(i, "--base");
        break;
      case "--working-tree":
        options.workingTree = true;
        continue;
      case "--format":
        options.format = value(i, "--format");
        if (!["scan", "wire"].includes(options.format)) {
          fail("--format needs scan or wire");
        }
        break;
      case "--public-api":
        options.publicApi.push(value(i, "--public-api"));
        break;
      case "--not-public":
        options.notPublic.push(value(i, "--not-public"));
        break;
      case "--org":
        options.org = value(i, "--org");
        break;
      case "--max-external":
        options.maxExternal = integer(i, "--max-external");
        break;
      case "--max-candidates":
        options.maxCandidates = integer(i, "--max-candidates");
        break;
      case "--max-file-bytes":
        options.maxFileBytes = integer(i, "--max-file-bytes");
        break;
      case "--pace-ms":
        options.paceMs = integer(i, "--pace-ms");
        break;
      case "--retry-ms":
        options.retryMs = integer(i, "--retry-ms");
        break;
      case "--no-external":
        options.external = false;
        continue;
      case "-h":
      case "--help":
        process.stdout.write(usage);
        process.exit(0);
      default:
        fail(`unknown option ${argv[i]}\n${usage}`);
    }
    i += 1;
  }
  return options;
}

function gitRoot() {
  const result = run("git", ["rev-parse", "--show-toplevel"], process.cwd());
  if (result.status !== 0) {
    fail("not inside a git repository");
  }
  return path.resolve(result.stdout.trim());
}

/**
 * Regular files that are tracked or untracked and not ignored. Ignore rules
 * keep dependencies, build output, and nested worktrees out. Symlinks are
 * skipped: their target is either listed itself or outside the repository.
 */
function repoFiles(root) {
  const result = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
  if (result.status !== 0) {
    fail(`git ls-files failed: ${result.stderr.trim()}`);
  }
  const files = [];
  for (const file of new Set(result.stdout.split("\0"))) {
    if (file === "") {
      continue;
    }
    let stat;
    try {
      stat = lstatSync(path.join(root, file));
    } catch (error) {
      if (error.code === "ENOENT") {
        continue; // tracked but deleted in the working tree
      }
      fail(`cannot stat ${file}: ${error.message}`);
    }
    if (stat.isFile()) {
      files.push({ file, size: stat.size });
    }
  }
  return files;
}

const extOf = (file) => path.posix.extname(file).toLowerCase();
const isTestPath = (file) => TEST_PATH.some((re) => re.test(file));
const dirSegments = (file) => file.split("/").slice(0, -1);

function inScope(file, scopes) {
  return scopes.length === 0 || scopes.some((s) => file === s || file.startsWith(`${s}/`));
}

/**
 * Every identifier token in every text file: occurrence count and naming
 * files. Comments and strings count as references. That over-counts, which
 * hides a dead symbol instead of proposing a live one. Binary files and files
 * over the size limit are not tokenized and are reported.
 */
function readRepository(root, files, options) {
  const occurrences = new Map();
  const sites = new Map();
  const texts = new Map();
  const skipped = [];
  const binaryTypes = new Map();
  for (const { file, size } of files) {
    if (size > options.maxFileBytes) {
      skipped.push({ file, reason: `larger than ${options.maxFileBytes} bytes; not read` });
      continue;
    }
    let buffer;
    try {
      buffer = readFileSync(path.join(root, file));
    } catch (error) {
      // An unread file would lower counts and could make a live symbol look dead.
      fail(`cannot read ${file}: ${error.message}`);
    }
    if (buffer.subarray(0, 8000).includes(0)) {
      const ext = extOf(file) || "(none)";
      binaryTypes.set(ext, (binaryTypes.get(ext) ?? 0) + 1);
      continue;
    }
    const text = buffer.toString("utf8");
    texts.set(file, text);
    for (const match of text.matchAll(IDENTIFIER)) {
      const name = match[0];
      occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
      let where = sites.get(name);
      if (where === undefined) {
        where = new Set();
        sites.set(name, where);
      }
      where.add(file);
    }
  }
  return { occurrences, sites, texts, skipped, binaryTypes };
}

function isDeclarationFile(file, size, scopes) {
  return (
    LANGUAGES[extOf(file)] !== undefined &&
    !isTestPath(file) &&
    !/\.d\.[cm]?ts$/.test(file) &&
    !/\.min\.[cm]?js$/.test(file) &&
    !dirSegments(file).some((s) => GENERATED_SEGMENTS.has(s)) &&
    size <= MAX_DECLARATION_BYTES &&
    inScope(file, scopes)
  );
}

/**
 * Exported, private, or unknown, from the declaration line alone. Private
 * declarations are not candidates: the compiler or a linter reports them.
 * @returns {"exported"|"public-by-convention"|"unknown"|"private"}
 */
function visibilityHint(file, mods, indent, name) {
  const language = LANGUAGES[extOf(file)];
  switch (language) {
    case "typescript":
    case "javascript":
      return /\bexport\b/.test(mods) ? "exported" : "private";
    case "rust":
      return /\bpub\b/.test(mods) ? "exported" : "private";
    case "go":
      return indent === 0 && /^\p{Lu}/u.test(name) ? "exported" : "private";
    case "python":
      return indent === 0 && !name.startsWith("_") ? "public-by-convention" : "private";
    case "java":
    case "kotlin":
    case "scala":
    case "csharp":
    case "swift":
    case "dart":
      if (/\bprivate\b/.test(mods)) {
        return "private";
      }
      return /\b(public|open|protected|internal)\b/.test(mods) ? "exported" : "unknown";
    case "c":
    case "cpp":
      return indent === 0 && HEADER_EXT.has(extOf(file)) ? "exported" : "private";
    default:
      return indent === 0 ? "unknown" : "private";
  }
}

/** True when the right-hand side of a declaration runs code to get its value. */
function hasSideEffectInitializer(line, keyword) {
  if (!/^(const|let|var|val|static)$/.test(keyword)) {
    return false;
  }
  const at = line.indexOf("=");
  if (at === -1) {
    return false;
  }
  const rhs = line.slice(at + 1).trim();
  if (/^(async\s+)?(function\b|\([^)]*\)\s*(:[^=]+)?=>|[\p{L}_$][\p{L}\p{N}_$]*\s*=>)/u.test(rhs)) {
    return false;
  }
  return /[\p{L}\p{N}_$.\])]\s*\(/u.test(rhs) || /^[^;]*,\s*[\p{L}_$][\p{L}\p{N}_$]*\s*=/u.test(line);
}

/**
 * What a change touches. `files` are the paths in the diff (plus untracked
 * files with --working-tree). A symbol is orphaned when the diff removes more
 * of its occurrences than it adds and one occurrence remains at HEAD: that is
 * the declaration, whose last reference the diff took away. The base count is
 * the head count minus added plus removed occurrences. Symbols named only in
 * removed lines (count zero at HEAD) are listed separately.
 */
function diffInfo(root, options, index) {
  // A named range (A..B or A...B) is diffed as given. A single ref is diffed
  // from its merge base with HEAD, through the working tree when asked.
  const isRange = options.base.includes("..");
  if (isRange && options.workingTree) {
    fail("--working-tree needs a single base ref, not a range");
  }
  let range;
  if (isRange) {
    range = [options.base];
  } else {
    const mergeBase = run("git", ["merge-base", options.base, "HEAD"], root);
    if (mergeBase.status !== 0) {
      fail(`cannot find a merge base of ${options.base} and HEAD; fetch the base first`);
    }
    range = options.workingTree ? [mergeBase.stdout.trim()] : [`${options.base}...HEAD`];
  }
  // -z gives unquoted paths; a rename or copy lists the new path last.
  const names = run("git", ["diff", "--name-status", "-z", "-M", "--no-ext-diff", ...range], root);
  const patch = run("git", ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--no-renames", ...range], root);
  if (names.status !== 0 || patch.status !== 0) {
    fail(`git diff failed: ${(names.stderr || patch.stderr).trim()}`);
  }
  const files = new Set();
  const fields = names.stdout.split("\0");
  for (let i = 0; i < fields.length - 1; ) {
    const status = fields[i];
    const width = /^[RC]/.test(status) ? 2 : 1;
    if (!status.startsWith("D")) {
      files.add(fields[i + width]);
    }
    i += 1 + width;
  }
  const added = new Map();
  const removed = new Map();
  const count = (map, text) => {
    for (const match of text.matchAll(IDENTIFIER)) {
      map.set(match[0], (map.get(match[0]) ?? 0) + 1);
    }
  };
  // Count only lines inside hunks, so a content line that starts with "+++ "
  // or "--- " is not taken for a file header.
  let inHunk = false;
  for (const line of patch.stdout.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && line.startsWith("+")) {
      count(added, line.slice(1));
    } else if (inHunk && line.startsWith("-")) {
      count(removed, line.slice(1));
    }
  }
  if (options.workingTree) {
    const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], root);
    untracked.stdout.split("\n").filter((f) => f !== "").forEach((f) => files.add(f));
  }
  const orphans = new Set();
  const removedOnly = new Set();
  for (const [name, n] of removed) {
    const head = index.occurrences.get(name) ?? 0;
    if (head === 0) {
      removedOnly.add(name);
    } else if (head === 1 && n > (added.get(name) ?? 0)) {
      orphans.add(name);
    }
  }
  return { base: options.base, workingTree: options.workingTree, files, orphans, removedOnly };
}

/**
 * `dead-export`: a declaration line whose name occurs once in the whole
 * repository, which is its own declaration. A name used in its own file occurs
 * twice and is not a candidate.
 *
 * `dead-reexport`: a re-export line where the name occurs in exactly two files
 * and two times: the re-exporting file and one other.
 */
function candidates(files, index, scopes) {
  const found = [];
  for (const { file, size } of files) {
    if (!isDeclarationFile(file, size, scopes) || !index.texts.has(file)) {
      continue;
    }
    const lines = index.texts.get(file).split("\n");
    lines.forEach((line, i) => {
      const declaration = DECLARATION.exec(line);
      if (declaration !== null) {
        const [, indentText, mods, keyword, name] = declaration;
        const hint = visibilityHint(file, mods, indentText.replace(/\t/g, "    ").length, name);
        if (hint !== "private" && index.occurrences.get(name) === 1) {
          found.push({
            check: "dead-export",
            name,
            file,
            line: i + 1,
            hint,
            sideEffect: hasSideEffectInitializer(line, keyword.trim()),
          });
        }
      }
      if (REEXPORT.test(line)) {
        for (const match of line.matchAll(IDENTIFIER)) {
          const name = match[0];
          const where = index.sites.get(name);
          if (index.occurrences.get(name) === 2 && where.size === 2 && where.has(file)) {
            found.push({ check: "dead-reexport", name, file, line: i + 1, hint: "unknown", sideEffect: false });
          }
        }
      }
    });
  }
  return found;
}

/**
 * Whether the package a manifest describes is published as a library whose
 * exported names other repositories can use.
 * @returns {{status: "public"|"private"|"unclear", why: string}}
 */
function manifestPublication(root, file, fileSet) {
  const base = path.posix.basename(file);
  const dir = path.posix.dirname(file);
  const text = () => readFileSync(path.join(root, file), "utf8");
  try {
    if (base === "package.json") {
      return JSON.parse(text()).private === true
        ? { status: "private", why: "package.json has private: true" }
        : { status: "public", why: "package.json is not private" };
    }
    if (base === "Cargo.toml") {
      const section = /^\s*\[package\]([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m.exec(text())?.[1] ?? "";
      if (/^\s*publish\s*=\s*false/m.test(section)) {
        return { status: "private", why: "Cargo.toml has publish = false" };
      }
      if (/^\s*publish\s*(\.workspace\s*=\s*true|=\s*\{)/m.test(section)) {
        return { status: "unclear", why: "Cargo.toml inherits publish from the workspace" };
      }
      return /^\s*\[lib\]/m.test(text()) || fileSet.has(path.posix.join(dir, "src/lib.rs"))
        ? { status: "public", why: "Cargo.toml has a library target" }
        : { status: "private", why: "Cargo.toml has no library target" };
    }
    if (base === "go.mod") {
      return { status: "public", why: "go.mod declares a module; the model checks internal/ import rules" };
    }
    if (base === "Project.toml" && /^name\s*=/m.test(text())) {
      return { status: "public", why: "Project.toml declares a package" };
    }
  } catch {
    return { status: "unclear", why: `${file} could not be read` };
  }
  return { status: "unclear", why: `${base} does not say whether the code is published` };
}

const owningDir = (file, manifestDirs) => {
  for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
    const normalized = dir === "." ? "" : dir;
    if (manifestDirs.has(normalized)) {
      return normalized;
    }
    if (normalized === "") {
      return undefined;
    }
  }
};

function packageJsonEntries(root, file) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, file), "utf8"));
    const values = [];
    const collect = (v) => {
      if (typeof v === "string") {
        values.push(v);
      } else if (v !== null && typeof v === "object") {
        Object.values(v).forEach(collect);
      }
    };
    ["main", "module", "types", "typings", "bin", "exports"].forEach((key) => collect(manifest[key]));
    return values;
  } catch {
    return [];
  }
}

/**
 * Where code can be entered from. A root is evaluated when its text is in the
 * reference index, so every name it uses counts as a reference. A root that
 * loads files by path, by convention, or by computed name cannot be evaluated
 * that way: it is unresolved, and every candidate it may load is refused.
 */
function discoverRoots(root, files, index, options, externalState) {
  const names = files.map((f) => f.file);
  const fileSet = new Set(names);
  const sources = names.filter((f) => LANGUAGES[extOf(f)] !== undefined);
  const found = [];
  const unresolved = [];
  const blocks = new Map();
  const list = (items) => (items.length > 10 ? [...items.slice(0, 10), `... ${items.length - 10} more`] : items).join(", ");
  const add = (target, id, kind, detail) => target.push({ id, kind, detail });
  const block = (id, kind, detail, matches) => {
    add(unresolved, id, kind, detail);
    blocks.set(id, matches);
  };

  const manifests = names.filter((f) => PACKAGE_MANIFESTS.has(path.posix.basename(f)) || f.endsWith(".csproj"));
  if (manifests.length > 0) {
    add(found, "manifests", "package and build manifests", list(manifests));
  }
  const entries = manifests
    .filter((f) => path.posix.basename(f) === "package.json")
    .flatMap((f) => packageJsonEntries(root, f).map((v) => `${f}: ${v}`));
  if (entries.length > 0) {
    add(found, "package-entry", "entry points named in package.json", list(entries));
  }
  const mains = [];
  for (const file of sources) {
    (index.texts.get(file) ?? "").split("\n").forEach((line, i) => {
      if (MAIN_ENTRY.some((re) => re.test(line))) {
        mains.push(`${file}:${i + 1}`);
      }
    });
  }
  if (mains.length > 0) {
    add(found, "main-entry", "main functions, __main__ guards, and script shebangs", list(mains));
  }
  const referenced = new Set();
  const buildFiles = names.filter(
    (f) => BUILD_FILES.has(path.posix.basename(f)) || CI_FILE.test(f) || /\.(mk|gradle)$/.test(f)
  );
  for (const build of buildFiles) {
    const text = index.texts.get(build) ?? "";
    for (const other of names) {
      if ((LANGUAGES[extOf(other)] !== undefined || other.endsWith(".sh")) && other !== build && text.includes(other)) {
        referenced.add(other);
      }
    }
  }
  if (referenced.size > 0) {
    add(found, "build-and-ci-references", "files named by build files, scripts, and CI workflows", list([...referenced]));
  }
  const tests = sources.filter(isTestPath);
  if (tests.length > 0) {
    add(found, "tests", "test files and test setup files", `${tests.length} files`);
  }
  const configs = names.filter((f) => TOOL_CONFIG.test(f));
  if (configs.length > 0) {
    add(found, "tool-configs", "build and tool configs that import code", list(configs));
  }
  const data = names.filter((f) => index.texts.has(f) && LANGUAGES[extOf(f)] === undefined);
  if (data.length > 0) {
    add(found, "docs-and-data", "docs, templates, schemas, and config read by name", `${data.length} files`);
  }

  const OWNERS = new Set(["Makefile", "justfile", "CMakeLists.txt", "meson.build", "BUILD", "BUILD.bazel"]);
  const manifestDirs = new Set(
    names
      .filter((f) => PACKAGE_MANIFESTS.has(path.posix.basename(f)) || OWNERS.has(path.posix.basename(f)) || f.endsWith(".csproj"))
      .map((f) => {
        const dir = path.posix.dirname(f);
        return dir === "." ? "" : dir;
      })
  );
  const manifestText = buildFiles.map((f) => index.texts.get(f) ?? "").join("\n");
  for (const framework of FRAMEWORKS) {
    const affected = sources.filter((f) => framework.files.test(f));
    if (framework.dep.test(manifestText) && affected.length > 0) {
      block(
        `framework:${framework.id}`,
        `${framework.id} loads files by path or annotation and calls their contents by convention`,
        list(affected),
        (file) => framework.files.test(file)
      );
    }
  }
  for (const dir of CONVENTION_DIRS) {
    const affected = sources.filter((f) => dirSegments(f).includes(dir));
    if (affected.length > 0) {
      block(
        `convention-directory:${dir}`,
        `files under a ${dir} directory are often loaded by path or by a registry`,
        list(affected),
        (file) => dirSegments(file).includes(dir)
      );
    }
  }
  // Publication status per manifest directory. Package manifests decide when
  // present; a build file alone says nothing about publication.
  const statusByDir = new Map();
  for (const dir of manifestDirs) {
    const inDir = (f) => (path.posix.dirname(f) === "." ? "" : path.posix.dirname(f)) === dir;
    const own = names.filter(
      (f) => inDir(f) && (PACKAGE_MANIFESTS.has(path.posix.basename(f)) || f.endsWith(".csproj"))
    );
    const statuses = own.map((f) =>
      f.endsWith(".csproj")
        ? { status: "unclear", why: ".csproj does not say whether the code is published" }
        : manifestPublication(root, f, fileSet)
    );
    const pick = (status) => statuses.find((x) => x.status === status);
    statusByDir.set(
      dir,
      pick("public") ?? pick("unclear") ?? pick("private") ?? { status: "unclear", why: "only a build file describes this directory" }
    );
  }
  // The most specific path the caller named wins; equal paths conflict.
  const depth = (file, paths) =>
    Math.max(-1, ...paths.filter((q) => q === "" || file === q || file.startsWith(`${q}/`)).map((q) => (q === "" ? 0 : q.split("/").length)));
  const statusOf = (file) => {
    const dir = owningDir(file, manifestDirs);
    const priv = depth(file, options.notPublic);
    const pub = depth(file, options.publicApi);
    if (priv >= 0 && priv === pub) {
      fail(`--public-api and --not-public name the same path for ${file}`);
    }
    if (priv > pub) {
      return { status: "private", dir, why: "the caller said this path is not public API" };
    }
    if (pub > priv) {
      return { status: "public", dir, why: "the caller said this path is public API" };
    }
    if (dir === undefined) {
      return { status: "unclear", dir, why: "no manifest above this file" };
    }
    return { ...statusByDir.get(dir), dir };
  };
  const publicDirs = new Map();
  const sourceStatuses = new Set();
  for (const file of sources) {
    const state = statusOf(file);
    sourceStatuses.add(state.status);
    if (state.status === "public") {
      publicDirs.set(state.dir ?? "(path)", state.why);
    }
  }
  if (publicDirs.size > 0) {
    add(
      found,
      "public-api",
      "public API of libraries other repositories can use; exported symbols are live until the user says otherwise",
      list([...publicDirs].map(([dir, why]) => `${dir || "."}: ${why}`))
    );
  }
  for (const dir of manifestDirs) {
    const unclear = sources.filter((f) => owningDir(f, manifestDirs) === dir && statusOf(f).status === "unclear");
    if (unclear.length > 0) {
      block(
        `publication-status:${dir || "."}`,
        `${statusByDir.get(dir).why}, so the public API of ${dir || "the repository"} is unknown`,
        list(unclear),
        (file) => owningDir(file, manifestDirs) === dir && statusOf(file).status === "unclear"
      );
    }
  }
  if (
    sourceStatuses.has("public") &&
    sourceStatuses.has("private") &&
    options.publicApi.length === 0 &&
    options.notPublic.length === 0
  ) {
    block(
      "public-api-scope",
      "the repository mixes published and unpublished packages; which directories are public API is a question for the user",
      "see public-api under found",
      (file) => statusOf(file).status === "private"
    );
  }

  const loaders = [];
  const ffi = new Set();
  for (const file of sources.filter((f) => !isTestPath(f))) {
    (index.texts.get(file) ?? "").split("\n").forEach((line, i) => {
      if (DYNAMIC_LOAD.some((re) => re.test(line))) {
        loaders.push({ file, at: `${file}:${i + 1}` });
      }
      if (FFI_EXPORT.test(line)) {
        ffi.add(file);
      }
    });
  }
  if (loaders.length > 0) {
    const owners = new Set(loaders.map(({ file }) => owningDir(file, manifestDirs) ?? "(none)"));
    block(
      "dynamic-loading",
      "computed imports, reflection, plugin loading, and dynamic libraries",
      list(loaders.map((l) => l.at)),
      (file) => owners.has(owningDir(file, manifestDirs) ?? "(none)")
    );
  }
  if (ffi.size > 0) {
    block("ffi-exports", "symbols exported to other languages or binaries by name", list([...ffi]), (file) => ffi.has(file));
  }
  const unowned = sources.filter((f) => owningDir(f, manifestDirs) === undefined);
  if (unowned.length > 0) {
    block(
      "manifest",
      "no package or build manifest above these files, so their entry points and public API are unknown",
      list(unowned),
      (file) => owningDir(file, manifestDirs) === undefined
    );
  }
  if (index.skipped.length > 0) {
    block(
      "unread-files",
      "files over the size limit were not read, so references in them are not counted",
      list(index.skipped.map((s) => s.file)),
      () => true
    );
  }

  if (!options.external) {
    add(found, "other-repositories", "other repositories", "the caller asserted there are none (--no-external)");
  } else if (externalState.blocker === undefined) {
    add(found, "other-repositories", "other repositories", `gh search code over ${externalState.searched} symbols`);
  } else {
    add(unresolved, "other-repositories", "other repositories", externalState.blocker);
  }

  // Root ids can hold colons (framework:next), so match the longest id first
  // and read the rest as a path.
  const accepts = new Map();
  for (const raw of options.acceptRoots) {
    const match = [...unresolved]
      .sort((a, b) => b.id.length - a.id.length)
      .find((r) => raw === r.id || raw.startsWith(`${r.id}:`));
    if (match === undefined) {
      fail(`--accept-root ${raw}: no such unresolved root. Unresolved: ${unresolved.map((r) => r.id).join(", ") || "none"}`);
    }
    const scope = raw === match.id ? null : raw.slice(match.id.length + 1);
    const before = accepts.get(match.id);
    accepts.set(match.id, scope === null || before === null ? null : [...(before ?? []), scope]);
  }
  for (const [id, paths] of accepts) {
    const at = unresolved.findIndex((r) => r.id === id);
    if (paths === null) {
      const [accepted] = unresolved.splice(at, 1);
      found.push({ ...accepted, detail: `accepted by caller; ${accepted.detail}` });
      blocks.delete(id);
    } else {
      const matches = blocks.get(id);
      blocks.set(id, (file) => matches(file) && !paths.some((q) => file === q || file.startsWith(`${q}/`)));
      unresolved[at].detail = `accepted by caller for ${paths.join(", ")}; ${unresolved[at].detail}`;
    }
  }
  return { found, unresolved, blocks, statusOf };
}

/** The refusal that applies without any search, as `{category, reason}`. */
function localRefusal(candidate, root, options, blockedBy, publicBy) {
  if (options.keep.has(candidate.name)) {
    return { category: "kept-by-caller", reason: "the caller listed this name with --keep" };
  }
  if (candidate.name.startsWith("_")) {
    return { category: "underscore-name", reason: "a leading underscore marks a name as intentionally unreferenced" };
  }
  if (candidate.sideEffect) {
    return {
      category: "side-effect-initializer",
      reason: "the declaration line calls code or declares several names, so removing it may remove a side effect",
    };
  }
  const dir = path.posix.dirname(candidate.file);
  if (dirSegments(candidate.file).some((s) => SUPPORT_SEGMENTS.has(s))) {
    return {
      category: "test-support",
      reason: "the file sits under a fixture, sample, mock, or example directory, which another tool or owner prunes",
    };
  }
  for (const name of DOC_NAMES) {
    if (existsSync(path.join(root, dir, name))) {
      return {
        category: "doc-in-directory",
        reason: `${path.posix.join(dir, name)} documents this directory, and a symbol that completes a documented set is not dead because nothing uses it yet`,
      };
    }
  }
  if (blockedBy !== undefined) {
    return { category: "unevaluated-root", reason: `root ${blockedBy} is not evaluated and may load this symbol` };
  }
  if (publicBy !== undefined) {
    return {
      category: "public-api",
      reason: `${publicBy}; the public API is a root, so an exported symbol is live even with no consumer found, unless the user states it is not public`,
    };
  }
  return undefined;
}

function originRepo(root) {
  const result = run("git", ["remote", "get-url", "origin"], root);
  const match =
    result.status === 0
      ? result.stdout.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
      : null;
  return match === null ? undefined : { owner: match[1], repo: `${match[1]}/${match[2]}` };
}

/** Why the cross-repository search cannot run, or undefined when it can. */
function externalBlocker(root, options) {
  if (run(GH, ["--version"], root).status !== 0) {
    return "gh is not installed";
  }
  if (run(GH, ["auth", "status"], root).status !== 0) {
    return "gh is not authenticated";
  }
  if (options.org === undefined && originRepo(root) === undefined) {
    return "the GitHub owner is unknown; pass --org";
  }
  return undefined;
}

/**
 * Other repositories naming a symbol, by `gh search code`. A failed search is
 * `unknown`, never `none`.
 */
function searchExternal(root, name, options, owner, self) {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      sleep(options.retryMs);
    }
    const result = run(
      GH,
      ["search", "code", name, "--owner", owner, "--json", "repository,path", "--limit", "100"],
      root
    );
    if (result.status === 0) {
      try {
        const rows = JSON.parse(result.stdout);
        const hits = rows
          .map((row) => ({ repo: row.repository?.nameWithOwner ?? "?", path: row.path }))
          .filter((hit) => hit.repo !== self);
        const capped = rows.length >= 100;
        // A full page of rows from this repository can hide other repositories.
        const status = hits.length > 0 ? "hits" : capped ? "unknown" : "none";
        return { status, hits, capped, error: "the search hit its 100-result cap with no other repository visible" };
      } catch {
        lastError = "gh returned output that is not JSON";
        continue;
      }
    }
    lastError = result.stderr.trim().split("\n")[0] || `gh exited ${result.status}`;
  }
  return { status: "unknown", hits: [], capped: false, error: lastError };
}

/**
 * Cross-repository state per distinct name: `{external, hits, note}` with
 * external one of none, hits, unknown, skipped.
 */
function externalVerdicts(root, names, options) {
  const verdicts = new Map();
  if (names.length === 0) {
    return { verdicts, blocker: undefined, searched: 0 };
  }
  if (!options.external) {
    for (const name of names) {
      verdicts.set(name, { external: "skipped", hits: [], note: "cross-repository search skipped by --no-external" });
    }
    return { verdicts, blocker: undefined, searched: 0 };
  }
  const blocker = externalBlocker(root, options);
  const self = originRepo(root)?.repo;
  const owner = options.org ?? originRepo(root)?.owner;
  let searched = 0;
  for (const name of names) {
    if (blocker !== undefined) {
      verdicts.set(name, { external: "unknown", hits: [], note: `cross-repository search unavailable: ${blocker}` });
      continue;
    }
    if (searched >= options.maxExternal) {
      verdicts.set(name, {
        external: "unknown",
        hits: [],
        note: `search limit of ${options.maxExternal} symbols reached; rerun with a larger --max-external`,
      });
      continue;
    }
    if (searched > 0) {
      sleep(options.paceMs);
    }
    searched += 1;
    const answer = searchExternal(root, name, options, owner, self);
    if (answer.status === "unknown") {
      verdicts.set(name, { external: "unknown", hits: [], note: `cross-repository search failed: ${answer.error}` });
    } else if (answer.status === "hits") {
      verdicts.set(name, {
        external: "hits",
        hits: answer.hits,
        note: answer.capped ? "the search hit its 100-result cap" : undefined,
      });
    } else {
      verdicts.set(name, {
        external: "none",
        hits: [],
        note: `gh search code found no repository of ${owner} other than this one naming it`,
      });
    }
  }
  return { verdicts, blocker, searched };
}

function buildFindings(found, root, options, index, blockFor, publicFor, externals) {
  const rows = found.map((candidate) => ({
    candidate,
    refusal: localRefusal(candidate, root, options, blockFor(candidate), publicFor(candidate)),
  }));
  // A public-API refusal is searched too: the hits are evidence for the
  // verdict, but a search that finds nothing never lifts it.
  const searched = (r) => r.refusal === undefined || r.refusal.category === "public-api";
  const searchNames = [...new Set(rows.filter(searched).map((r) => r.candidate.name))];
  const external = externals(searchNames);

  const findings = [];
  const make = ({ candidate, refusal }, state) => {
    let refused = refusal;
    if (refused === undefined && state.external === "hits") {
      refused = { category: "exported-with-hits", reason: "another repository names this symbol" };
    } else if (refused === undefined && state.external === "unknown") {
      refused = { category: "unknown", reason: state.note };
    }
    const exportCheck = candidate.check === "dead-export";
    const evidence = [
      `files naming it in this repository: ${[...(index.sites.get(candidate.name) ?? [])].join(", ")}`,
      `visibility hint from the declaration line: ${candidate.hint}`,
      `external: ${state.external}`,
      state.note,
      state.hits.length > 0 ? `other repositories: ${state.hits.map((h) => `${h.repo}:${h.path}`).join(", ")}` : undefined,
    ].filter((part) => part !== undefined);
    return {
      id: "",
      source: "script",
      evidence_source: "text",
      severity: refused !== undefined ? "question" : exportCheck ? "medium" : "low",
      check: candidate.check,
      file: candidate.file,
      line: candidate.line,
      symbol: candidate.name,
      language: LANGUAGES[extOf(candidate.file)],
      ...(candidate.diffReason === undefined ? {} : { diff_reason: candidate.diffReason }),
      visibility_hint: candidate.hint,
      external: state.external,
      signal: exportCheck
        ? "this declaration's name occurs once in the repository"
        : "this re-export names a symbol that only two files mention",
      evidence: evidence.join("; "),
      proposal:
        refused !== undefined
          ? "None. Recorded so the refusal is countable."
          : exportCheck
            ? `Proposed change, if the judgment pass confirms visibility and roots: delete the declaration of ${candidate.name} at ${candidate.file}:${candidate.line} with its comments. Check: find-references (or rg) shows no other use, and the owning package builds and passes its tests.`
            : `Proposed change, if the judgment pass confirms it: delete the re-export of ${candidate.name} at ${candidate.file}:${candidate.line} and keep the declaration. Check: nothing imports ${candidate.name} through this file, and the owning package builds and passes its tests.`,
      judgment: null,
      refused: refused !== undefined,
      ...(refused ?? {}),
    };
  };
  const noSearch = { external: "not-run", hits: [], note: undefined };
  for (const row of rows) {
    findings.push(make(row, searched(row) ? external.verdicts.get(row.candidate.name) : noSearch));
  }
  // Candidates first, then refusals; stable within each group.
  findings.sort((a, b) => Number(a.refused) - Number(b.refused));
  findings.forEach((f, i) => {
    f.id = `dc-${i + 1}`;
  });
  return { findings, external };
}

function summarize(document) {
  const { counts, findings } = document;
  const lines = [
    `dead-code-scan: ${counts.candidates} candidates, ${counts.reported} for the judgment pass, ${counts.refused} refused` +
      (counts.truncated > 0 ? `, ${counts.truncated} more not listed` : ""),
  ];
  const shown = findings.filter((f) => !f.refused);
  for (const f of shown.slice(0, 20)) {
    lines.push(`  ${f.severity.padEnd(4)} ${f.file}:${f.line} ${f.symbol} (${f.check}, ${f.language})`);
  }
  if (shown.length > 20) {
    lines.push(`  ... ${shown.length - 20} more in the JSON`);
  }
  for (const w of document.warnings) {
    lines.push(`  warning: ${w}`);
  }
  for (const r of document.roots.unresolved) {
    lines.push(`  unresolved root: ${r.id}`);
  }
  if (document.skipped_files.length > 0) {
    lines.push(`  skipped files: ${document.skipped_files.length} (read them by hand)`);
  }
  const byCategory = new Map();
  for (const f of findings.filter((x) => x.refused)) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }
  if (byCategory.size > 0) {
    lines.push(`  refused: ${[...byCategory].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

/** The findings file must be a regular file outside the repository under review. */
function checkOut(root, options) {
  if (options.out === undefined) {
    return;
  }
  try {
    if (lstatSync(path.resolve(process.cwd(), options.out)).isSymbolicLink()) {
      fail("--out is a symbolic link; name a regular file");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const parent = path.dirname(path.resolve(process.cwd(), options.out));
  const real = existsSync(parent) ? realpathSync(parent) : parent;
  if (!path.relative(root, path.join(real, path.basename(options.out))).startsWith("..")) {
    fail("--out is inside the repository under review; write the findings outside it, for example under the system temp dir");
  }
}

function outputText(options, text) {
  if (options.out === undefined) {
    process.stdout.write(text);
  } else {
    writeFileSync(options.out, text);
  }
}

const WIRE_SEVERITY = { blocker: "blocker", high: "high", medium: "medium", low: "low", nit: "low", question: "low" };

/**
 * Review-lens wire findings from a scan document, judged or not. Dropped
 * findings and unjudged refusals are left out. Unresolved roots become one
 * `low` finding that says what to ask the user.
 */
function toWire(document) {
  const roots = [...document.roots.found, ...document.roots.unresolved].map((r) => r.id).join(", ");
  const wire = [];
  for (const f of document.findings) {
    const overturned = f.judgment === "overturned";
    if (f.judgment === "dropped" || (f.refused === true && !overturned)) {
      continue;
    }
    const origin = f.source === "reviewer" ? "reviewer" : "script";
    const unjudged = f.source !== "reviewer" && (f.judgment === null || f.judgment === undefined);
    const verified = f.judgment === "confirmed" && (f.evidence_source === "lsp" || f.evidence_source === "read");
    wire.push({
      source: "dead-code-scan",
      path: f.file,
      line: f.line ?? null,
      severity: unjudged ? "low" : (WIRE_SEVERITY[f.severity] ?? "low"),
      title:
        (unjudged ? "Candidate: " : "") +
        (f.check === "dead-reexport"
          ? `Remove re-export ${f.symbol ?? ""}`.trim()
          : f.symbol === undefined
            ? "Dead code"
            : `Remove unused ${f.symbol}`),
      body:
        `Finding source: ${origin}. ${unjudged ? "Unjudged scan candidate: confirm the roots and callers before acting. " : ""}${f.signal ?? ""} ` +
        (f.judgment_reason === undefined ? "" : `Judgment: ${f.judgment}, ${f.judgment_reason}.`),
      suggested_fix: f.proposal,
      evidence: `${verified ? "Verified" : "Inferred"}: ${f.evidence_source} evidence; ${f.evidence}; roots considered: ${roots}`,
    });
  }
  if (document.roots.unresolved.length > 0) {
    const open = document.roots.unresolved.map((r) => `${r.id} (${r.detail})`).join("; ");
    wire.push({
      source: "dead-code-scan",
      path: ".",
      line: null,
      severity: "low",
      title: "Roots the scan could not evaluate",
      body: `These roots may reach code the scan lists as dead or refused: ${open}`,
      suggested_fix:
        "Ask the user which files or symbols each root loads, which packages are public API, and which repositories consume this one. Then rerun with --accept-root, --public-api, or --not-public.",
      evidence: `Inferred: roots.unresolved in the scan document; roots considered: ${roots}`,
    });
  }
  return wire;
}

const headline = (wire) =>
  wire.some((w) => ["blocker", "high", "medium"].includes(w.severity)) ? "needs-attention" : "approve";

function wireCommand(argv) {
  if (argv.length !== 1) {
    fail(`wire needs one findings file\n${usage}`);
  }
  let document;
  try {
    document = JSON.parse(readFileSync(argv[0], "utf8"));
  } catch (error) {
    fail(`cannot read ${argv[0]}: ${error.message}`);
  }
  const problems = validationProblems(document);
  if (problems.length > 0) {
    fail(`the findings file is not valid; run validate\n${problems.join("\n")}`);
  }
  const wire = toWire(document);
  process.stdout.write(JSON.stringify(wire, null, 2) + "\n");
  process.stderr.write(`headline: ${headline(wire)}\n`);
}

function scan(argv) {
  const options = parseArgs(argv);
  const root = gitRoot();
  const resolved = options.scopes.map((s) =>
    path.relative(root, path.resolve(process.cwd(), s)).split(path.sep).join("/")
  );
  if (resolved.some((s) => s.startsWith(".."))) {
    fail("--scope is outside the repository");
  }
  // The repository root among the scopes means the whole repository.
  const scopes = resolved.includes("") ? [] : resolved;

  checkOut(root, options);
  const relative = (s) => path.relative(root, path.resolve(process.cwd(), s)).split(path.sep).join("/");
  options.publicApi = options.publicApi.map(relative);
  options.notPublic = options.notPublic.map(relative);
  if ([...options.publicApi, ...options.notPublic].some((q) => q.startsWith(".."))) {
    fail("--public-api and --not-public paths must be inside the repository");
  }
  const files = repoFiles(root);
  const index = readRepository(root, files, options);
  if (options.diffScopeOnly && options.base === undefined) {
    options.base = "origin/main";
  }
  const diff = options.base === undefined ? undefined : diffInfo(root, options, index);
  const warnings = [];
  if (diff !== undefined && !options.workingTree) {
    const dirty = run("git", ["status", "--porcelain"], root).stdout.trim();
    if (dirty !== "") {
      warnings.push(
        "the working tree has uncommitted changes; the reference index reads the working tree, not HEAD. Commit or stash them, or pass --working-tree to review them."
      );
    }
  }
  if (options.diffScopeOnly) {
    const info = {
      base: diff.base,
      working_tree: diff.workingTree,
      files: [...diff.files].sort(),
      orphan_symbols: [...diff.orphans].sort(),
      removed_only_symbols: [...diff.removedOnly].sort(),
    };
    outputText(options, JSON.stringify(info, null, 2) + "\n");
    return;
  }
  const found = candidates(files, index, scopes)
    .filter((c) => diff === undefined || diff.files.has(c.file) || diff.orphans.has(c.name))
    .map((c) =>
      diff === undefined ? c : { ...c, diffReason: diff.files.has(c.file) ? "touched" : "orphaned" }
    )
    .sort((a, b) => a.check.localeCompare(b.check) || a.file.localeCompare(b.file) || a.line - b.line);
  const kept = found.slice(0, options.maxCandidates);

  // Roots come first so that a symbol an unevaluated root may load costs no
  // search. The search state is added to the roots afterward.
  const early = discoverRoots(root, files, index, options, { blocker: undefined, searched: 0 });
  const blockFor = (candidate) => [...early.blocks].find(([, matches]) => matches(candidate.file))?.[0];
  let final;
  const publicFor = (candidate) => {
    const state = early.statusOf(candidate.file);
    return state.status === "public" ? state.why : undefined;
  };
  const built = buildFindings(kept, root, options, index, blockFor, publicFor, (names) => {
    final = externalVerdicts(root, names, options);
    return final;
  });
  const roots = discoverRoots(root, files, index, options, final);

  const skippedFiles = [
    ...index.skipped,
    ...files
      .filter(({ file }) => LANGUAGES[extOf(file)] !== undefined && inScope(file, scopes) && index.texts.has(file))
      .filter(({ file, size }) => /\.min\.[cm]?js$/.test(file) || size > MAX_DECLARATION_BYTES)
      .map(({ file }) => ({ file, reason: "minified or over 2 MB; not scanned for declarations" })),
  ];
  const dataTypes = new Set([
    ".md", ".mdx", ".rst", ".txt", ".json", ".yml", ".yaml", ".toml", ".xml", ".html", ".css", ".csv", ".svg",
    ".lock", ".cfg", ".ini", ".sh", ".gitignore", ".proto", ".graphql", ".hbs", ".vue", ".svelte",
  ]);
  const unlistedTypes = new Map();
  for (const { file } of files) {
    const ext = extOf(file) || "(none)";
    if (index.texts.has(file) && LANGUAGES[extOf(file)] === undefined && !dataTypes.has(ext)) {
      unlistedTypes.set(ext, (unlistedTypes.get(ext) ?? 0) + 1);
    }
  }
  const reported = built.findings.filter((f) => !f.refused).length;
  const document = {
    tool: "dead-code-scan",
    scope:
      (diff === undefined ? "" : `diff against ${diff.base}${diff.workingTree ? " with the working tree" : ""}; `) +
      (scopes.length === 0 ? "whole repository" : scopes.join(", ")),
    ...(diff === undefined
      ? {}
      : { diff: { base: diff.base, files: [...diff.files].sort(), orphan_symbols: [...diff.orphans].sort() } }),
    generated_at: new Date().toISOString(),
    warnings,
    counts: {
      candidates: kept.length,
      refused: built.findings.length - reported,
      reported,
      truncated: found.length - kept.length,
    },
    roots: { found: roots.found, unresolved: roots.unresolved },
    skipped_files: skippedFiles,
    binary_file_types: Object.fromEntries(index.binaryTypes),
    unlisted_file_types: Object.fromEntries(unlistedTypes),
    findings: built.findings,
  };
  if (options.format === "wire") {
    const wire = toWire(document);
    outputText(options, JSON.stringify(wire, null, 2) + "\n");
    process.stderr.write(`headline: ${headline(wire)}\n`);
  } else {
    outputText(options, JSON.stringify(document, null, 2) + "\n");
  }
  process.stderr.write(summarize(document));
  // Candidates and refusals both need the judgment pass. `exitCode` rather
  // than `exit` so a piped stdout write is not truncated.
  process.exitCode = kept.length > 0 ? 1 : 0;
}

const SOURCES = new Set(["script", "reviewer"]);
const EVIDENCE_SOURCES = new Set(["lsp", "text", "read"]);
const JUDGMENTS = new Set(["confirmed", "downgraded", "dropped", "overturned"]);

/** Problems in a findings document after the judgment pass, as strings. */
function validationProblems(document) {
  const problems = [];
  if (!Array.isArray(document?.findings)) {
    return ["findings is not an array"];
  }
  document.findings.forEach((f, i) => {
    const at = `finding ${f.id ?? i}`;
    if (!SOURCES.has(f.source)) {
      problems.push(`${at}: source must be script or reviewer`);
    }
    if (!EVIDENCE_SOURCES.has(f.evidence_source)) {
      problems.push(`${at}: evidence_source must be lsp, text, or read`);
    }
    for (const field of ["file", "evidence", "proposal"]) {
      if (typeof f[field] !== "string" || f[field] === "") {
        problems.push(`${at}: ${field} is missing`);
      }
    }
    if (f.source === "script" && !JUDGMENTS.has(f.judgment)) {
      problems.push(`${at}: a script finding needs judgment (confirmed, downgraded, dropped, overturned)`);
    }
    if (f.judgment !== null && f.judgment !== undefined) {
      if (!JUDGMENTS.has(f.judgment)) {
        problems.push(`${at}: unknown judgment ${f.judgment}`);
      } else if (typeof f.judgment_reason !== "string" || f.judgment_reason === "") {
        problems.push(`${at}: judgment_reason is missing`);
      }
    }
  });
  return problems;
}

function validate(argv) {
  if (argv.length !== 1) {
    fail(`validate needs one findings file\n${usage}`);
  }
  let document;
  try {
    document = JSON.parse(readFileSync(argv[0], "utf8"));
  } catch (error) {
    fail(`cannot read ${argv[0]}: ${error.message}`);
  }
  const problems = validationProblems(document);
  if (problems.length > 0) {
    process.stderr.write(problems.map((p) => `${p}\n`).join(""));
    process.exitCode = 2;
    return;
  }
  process.stderr.write(`${document.findings.length} findings valid\n`);
}

function main() {
  const [first, ...rest] = process.argv.slice(2);
  if (first === "validate") {
    validate(rest);
  } else if (first === "wire") {
    wireCommand(rest);
  } else if (first === "diff-scope") {
    scan(["--diff-scope-only", ...rest]);
  } else {
    scan(first === "scan" ? rest : process.argv.slice(2));
  }
}

try {
  main();
} catch (error) {
  // Node would exit 1 on an uncaught error, which means "candidates".
  fail(error.message);
}
