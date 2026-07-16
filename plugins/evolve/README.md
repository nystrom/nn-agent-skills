# Evolve

LLM-driven evolutionary code optimizer for Claude Code, inspired by Google
DeepMind's AlphaEvolve and the [OpenEvolve](https://github.com/algorithmicsuperintelligence/openevolve)
implementation.

Describe *what* to evolve and *how to measure it*. AlphaEvolve iteratively
mutates your code in isolated git worktrees, evaluates each variant, and
surfaces the best result.

## Algorithm

**MAP-Elites + LLM mutations**

Rather than tracking a single "best" program, AlphaEvolve maintains a
**MAP-Elites archive** — a grid of programs organized by two feature
dimensions: `complexity` (0–3) and `approach` (e.g. `"iterative"`,
`"cache-friendly"`, `"lookup-table"`). Each grid cell holds the best-scoring
program found with that combination. This preserves *diverse* solutions: a
novel approach at lower fitness today can seed a breakthrough tomorrow.

Each iteration:
1. **Select** a parent — elite (70%) or random (30%) from archive
2. **Search** (every 3rd iteration) — web + arxiv for relevant algorithms
3. **Mutate** — SEARCH/REPLACE diffs guided by top programs, diverse
   inspirations, and full evolution history
4. **Evaluate** — in an isolated git worktree: compile → tests → fitness
5. **Update archive** — insert if it improves its (complexity, approach) cell

## Install

Install it from the `nystrom/agent-skills` marketplace:

```
/plugin marketplace add nystrom/agent-skills
/plugin install evolve@agent-skills
```

Or, from a local checkout of `agent-skills`:

```
/plugin marketplace add ./
/plugin install evolve@agent-skills
```

Commands are namespaced under the plugin: `/evolve:evolve`,
`/evolve:evolve-status`, `/evolve:evolve-stop`.

To hack on it without installing, load the plugin directory directly:

```bash
claude --plugin-dir ./plugins/evolve
```

Validate manifest changes before publishing:

```bash
claude plugin validate ./plugins/evolve --strict
```

## Requirements

- Must be in a **git repository**
- Working tree must be **clean** (commit or stash changes first)
- A detectable build system: `Makefile`, `package.json`, `Cargo.toml`,
  `go.mod`, `pyproject.toml`, `CMakeLists.txt`, or `build.gradle`

## Usage

```bash
# Start an evolution run
/evolve "the sort() function in src/sort.ts" \
  --fitness "run make bench and maximize ops/sec"

# With options
/evolve "the query builder in db/query.go" \
  --fitness "go test -bench=BenchmarkQuery and minimize ns/op" \
  --branch main \
  --iterations 20

# Check progress during a run
/evolve-status

# Stop early (prompts to apply best result)
/evolve-stop
```

## Fitness prompts

Describe what to run and what to optimize. Higher is always better — the
evaluator negates latency/memory/error metrics automatically.

```
--fitness "run make bench, maximize throughput (ops/sec)"
--fitness "cargo bench -- sort_bench, maximize iter/sec"
--fitness "npm run benchmark, minimize p99 latency ms"
--fitness "measure peak RSS with /usr/bin/time -v make run, minimize memory"
--fitness "go test -bench=. -count=5, minimize ns/op"
```

Compile success and all tests passing are implicit requirements — variants
that fail either are discarded regardless of fitness.

## How web search is used

Every third iteration, the mutator agent searches the web and arxiv for
relevant algorithms before generating a mutation. For example, when evolving
a sorting function, it may find papers on cache-oblivious sorting or
SIMD-friendly partitioning and incorporate those ideas into the diff.

## State

Live state is in `.evolve/state.json`. Worktrees are created under `.evolve/`
and removed after each evaluation. The setup script adds `.evolve/` to
`.gitignore` automatically.
