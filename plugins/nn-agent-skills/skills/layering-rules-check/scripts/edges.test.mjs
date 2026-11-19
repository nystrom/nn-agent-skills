import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extractEdges } from "./edges.mjs";
import { makeRepo } from "./fixture.mjs";

const EDGES = join(dirname(fileURLToPath(import.meta.url)), "edges.mjs");

const edgeOf = (edges, from, specifier) =>
  edges.find((e) => e.from === from && e.specifier === specifier);

describe("edges.mjs", () => {
  it("resolves TypeScript and JavaScript relative imports and re-exports", () => {
    const root = makeRepo({
      "src/a/index.ts": 'export { x } from "../b/x.js";\nimport "left-pad";\n',
      "src/b/x.ts": "export const x = 1;\n",
      "src/c.mjs":
        'const m = require("./b/x");\n// import "./b/x"\nconst u = "http://h"; import("./b/x.js");\n',
    });
    const { edges } = extractEdges(root);
    const re = edgeOf(edges, "src/a/index.ts", "../b/x.js");
    assert.equal(re.to, "src/b/x.ts");
    assert.equal(re.kind, "reexport");
    assert.equal(edgeOf(edges, "src/a/index.ts", "left-pad").to, null);
    const c = edges.filter((e) => e.from === "src/c.mjs");
    assert.deepEqual(c.map((e) => e.line), [1, 3]);
    assert.ok(c.every((e) => e.to === "src/b/x.ts"));
  });

  it("resolves Python absolute and relative imports", () => {
    const root = makeRepo({
      "pkg/__init__.py": "from ..other import y\n",
      "pkg/core/a.py":
        "from pkg.util import f\nfrom . import b\nfrom .b import g\nimport os\n# import pkg.util\n",
      "pkg/core/b.py": "",
      "pkg/util.py": "",
      "other.py": "",
    });
    const { edges } = extractEdges(root);
    assert.equal(edgeOf(edges, "pkg/core/a.py", "pkg.util").to, "pkg/util.py");
    assert.equal(edgeOf(edges, "pkg/core/a.py", ".b").to, "pkg/core/b.py");
    assert.equal(edgeOf(edges, "pkg/core/a.py", "os").to, null);
    assert.equal(edges.filter((e) => e.from === "pkg/core/a.py").length, 4);
    assert.equal(edgeOf(edges, "pkg/__init__.py", "..other").kind, "reexport");
  });

  it("resolves Go imports through the go.mod module path", () => {
    const root = makeRepo({
      "go.mod": "module example.com/app\n\ngo 1.21\n",
      "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/app/internal/store"\n)\n',
      "internal/store/store.go": "package store\n",
      "internal/store/store_test.go": "package store\n",
    });
    const { edges } = extractEdges(root);
    const store = edgeOf(edges, "cmd/main.go", "example.com/app/internal/store");
    assert.equal(store.to, "internal/store/store.go");
    assert.equal(edgeOf(edges, "cmd/main.go", "fmt").to, null);
    assert.equal(edgeOf(edges, "cmd/main.go", "fmt").line, 4);
  });

  it("resolves Rust use, pub use, and mod", () => {
    const root = makeRepo({
      "src/lib.rs": "mod util;\npub mod net;\n",
      "src/util.rs": "pub fn f() {}\n",
      "src/net/mod.rs": "pub use crate::util::f;\nuse std::io;\n",
    });
    const { edges } = extractEdges(root);
    assert.equal(edgeOf(edges, "src/lib.rs", "mod::util").to, "src/util.rs");
    assert.equal(edgeOf(edges, "src/lib.rs", "mod::net").to, "src/net/mod.rs");
    const re = edgeOf(edges, "src/net/mod.rs", "crate::util::f");
    assert.equal(re.to, "src/util.rs");
    assert.equal(re.kind, "reexport");
    assert.equal(edgeOf(edges, "src/net/mod.rs", "std::io").to, null);
  });

  it("resolves Java and Kotlin imports", () => {
    const root = makeRepo({
      "src/main/java/com/acme/app/App.java":
        "import com.acme.util.Strings;\nimport static com.acme.util.Strings.trim;\nimport java.util.List;\n",
      "src/main/java/com/acme/util/Strings.java": "",
      "src/main/kotlin/com/acme/k/K.kt": "import com.acme.util.Strings\n",
    });
    const { edges } = extractEdges(root);
    const java = edges.filter((e) => e.from.endsWith("App.java"));
    assert.deepEqual(java.map((e) => e.to), [
      "src/main/java/com/acme/util/Strings.java",
      "src/main/java/com/acme/util/Strings.java",
      null,
    ]);
    const kt = edgeOf(edges, "src/main/kotlin/com/acme/k/K.kt", "com.acme.util.Strings");
    assert.equal(kt.to, "src/main/java/com/acme/util/Strings.java");
  });

  it("resolves C and C++ quoted includes and skips angle includes", () => {
    const root = makeRepo({
      "src/a.c": '#include "a.h"\n#include "util/u.h"\n#include <stdio.h>\n',
      "src/a.h": "",
      "include/util/u.h": "",
    });
    const { edges } = extractEdges(root);
    assert.equal(edges.length, 2);
    assert.equal(edgeOf(edges, "src/a.c", "a.h").to, "src/a.h");
    assert.equal(edgeOf(edges, "src/a.c", "util/u.h").to, "include/util/u.h");
  });

  it("resolves Julia include and relative using", () => {
    const root = makeRepo({
      "src/Pkg.jl": 'module Pkg\ninclude("a.jl")\nusing .Inner\nusing LinearAlgebra\nend\n',
      "src/a.jl": "module Inner\nend\n",
    });
    const { edges } = extractEdges(root);
    assert.equal(edgeOf(edges, "src/Pkg.jl", "a.jl").to, "src/a.jl");
    assert.equal(edgeOf(edges, "src/Pkg.jl", "module::Inner").to, "src/a.jl");
    assert.equal(edges.length, 2);
  });

  it("resolves a Python submodule named in a from-import, and leaves a missing TypeScript target null", () => {
    const root = makeRepo({
      "pkg/core/a.py": "from . import b\nfrom pkg.core import b as c, missing\n",
      "pkg/core/b.py": "",
      "src/x.ts": 'import "../nowhere/y";\nimport "../../outside";\n',
    });
    const { edges } = extractEdges(root);
    const a = edges.filter((e) => e.from === "pkg/core/a.py");
    assert.deepEqual(a.map((e) => [e.specifier, e.to]), [
      [".b", "pkg/core/b.py"],
      ["pkg.core.b", "pkg/core/b.py"],
    ]);
    assert.ok(edges.filter((e) => e.from === "src/x.ts").every((e) => e.to === null));
  });

  it("refuses an output path inside the repo, also through a symlinked directory", () => {
    const root = makeRepo({ "a.py": "", "sub/keep.txt": "" });
    const outside = makeRepo({});
    symlinkSync(join(root, "sub"), join(outside, "link"));
    for (const out of [join(root, "edges.json"), join(root, "sub", "new", "edges.json"), join(outside, "link", "e.json")]) {
      const r = spawnSync("node", [EDGES, "--root", root, "--out", out], { encoding: "utf8" });
      assert.equal(r.status, 2, out);
    }
    const ok = spawnSync("node", [EDGES, "--root", root, "--out", join(outside, "e.json")], { encoding: "utf8" });
    assert.equal(ok.status, 0);
  });

  it("exits 2 on a missing root", () => {
    const r = spawnSync("node", [EDGES, "--root", join(makeRepo({}), "missing")], { encoding: "utf8" });
    assert.equal(r.status, 2);
  });

  it("does not follow symlinks", () => {
    const root = makeRepo({ "a.py": "import b\n", "b.py": "" });
    symlinkSync(root, join(root, "loop"));
    assert.equal(extractEdges(root).edges.length, 1);
  });

  it("works as a command and handles an empty repo", () => {
    const empty = makeRepo({});
    const r = spawnSync("node", [EDGES, "--root", empty], { encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), []);
    assert.equal(spawnSync("node", [EDGES, "--bogus"], { encoding: "utf8" }).status, 2);
  });
});
