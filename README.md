# nn-agent-skills

Installable agent skills and plugins for Claude Code, Codex, and Antigravity.

## Skills

### run-review-lenses

Review a change set with **every code-review lens installed in the environment**
and write the result to `review.json` — the findings, and nothing else. It
establishes scope, walks the branch commit by commit to learn why each change
exists, splits the diff into semantic changes versus bookkeeping noise, gathers
the context each change needs, then fans out a parallel subagent per lens and
merges their findings into one severity-ranked list attached to the changes they
land on.

It is the basis for the two presentation skills below — both run it first and
present the `review.json` it writes. Run on its own, it prints a short ranked
summary for when you want the findings and nothing more.

This plugin also ships **review lenses** that `run-review-lenses` fans out to
automatically whenever they are installed (they are, with this plugin):

### adversarial-review

Assume the change is subtly wrong and find how it fails, then prove it with
targeted probes run against head and base. Expensive, dangerous, and
hard-to-detect failures: broken extension contracts and downstream subtypes,
boundary and degenerate inputs, mutability and cache-reuse hazards, auth and trust
boundaries, data loss, races, retry/idempotency holes, migration hazards.
Passing tests never justify an approval, and an observed regression always
blocks. Material findings only, each with a mechanism, evidence, and a concrete
fix. Also usable on its own when you want just the adversarial pass.

### performance-code-review

Performance lens over the change set: complexity regressions, N+1 and chatty
I/O, unbounded work, hot-path allocations, lock contention, cache misuse.
Prefers complexity- or scale-backed claims over taste. Standalone or via the
fan-out.

### risk-assessment

Shipping-risk lens: blast radius, rollback safety, operability and
observability, security/privacy exposure, data/migration hazard, dependency
risk, release readiness. Go/no-go oriented. Standalone or via the fan-out.

### test-coverage-code-review

Test-coverage lens: missing or weak tests for new and changed behavior,
untested failure/edge paths, assertions that would not catch the bug, brittle
snapshots, skipped or deleted tests without replacement — and useless tests
(no assertion, assertions that hold for any input, cases that reach no repo
code, tautologies, duplicates, mock-only, coverage theater) with a prune
proposal. Works for any language. The model does the missing-coverage analysis
by reading; `scripts/scan.mjs`, a table-driven scanner that needs only Node,
finds useless-test candidates with whole-tree evidence, and a judgment pass
confirms each. Symbol facts come from the language server when one exists, and
from text search and reading otherwise; each finding says which. It refuses
snapshot-backed, skipped, and helper-asserting cases and counts each refusal.
Every finding carries a proposed change, and the lens never edits files.
Reviews a diff or a whole repo. Behavioral coverage, not a line-percent
scolding. Standalone or via the fan-out.

### dead-code-code-review

Dead-code lens for a change set or a whole repository, in any programming
language: unreachable helpers, unused exports, orphaned modules, stale
re-exports, dead branches and flags, commented-out blocks. A script builds a
whole-tree reference index and lists candidates, roots, and public-API status
(needs Node and git, and `gh` for the cross-repository search). The model
confirms each finding from a language server, text search, or reading, treats
the public API and other repositories' callers conservatively, and asks you
about roots it cannot evaluate before it reports anything as dead. It reports
findings with a proposed change and the check that verifies it, and does not
edit files, commit, or post. Standalone or via the fan-out.

### ai-slop-code-review

Ruthless AI-slop lens: narrating comments, needless wrappers, impossible
defensive checks, enterprise cosplay, verbose restatements of one-line idioms,
duplicate thoroughness, theatrical tests, discarded type evidence, structural
erosion, quadratic accumulators. Persistent multi-pass; proposes deletion or the
tight rewrite without changing behavior. Standalone or via the fan-out.

### numerical-code-review

Numerical-correctness lens for scientific, statistical, simulation,
optimization, and solver code: degenerate inputs, NaN/Inf creation and
propagation, overflow and precision loss, ill-conditioning, changed tolerances
and stopping criteria, convergence failures that end on a plausible wrong
answer, broken invariants, and stale caches or factorizations. Proves findings
with head-vs-base probes and reference computations. Approves immediately when
a change touches no numerical code. Standalone or via the fan-out.

### codex-code-review

Second-model lens: runs the OpenAI Codex CLI's reviewer (`codex exec review`)
over the same scope in a read-only sandbox and returns its findings in the lens
format. Takes an optional Codex `model` and reasoning `effort`; without them,
Codex uses the defaults in `~/.codex/config.toml`. Reports `not-run` instead of
`approve` when the `codex` CLI is missing or the review fails, and skips itself
when the host is Codex. Standalone or via the fan-out.

### interactive-code-review

Walk a reviewer through a change set **one change at a time**, interactively —
like a guided, grill-me-style review session rather than a static report. It
opens with a whole-PR overview and a high-level verdict, then walks the changes
one by one. It runs in one of two modes (auto-detected, overridable in a word):

- **COMMENT mode** (reviewing someone else's PR/branch): for each change it
  explains, to someone unfamiliar with the codebase, what the change is, why it
  exists, and who consumes the result, then offers three ready-to-post comment
  options and posts the chosen one to GitHub.
- **FIX mode** (reviewing local code you intend to fix): for each change it gives
  just enough context to fix safely, then proposes and applies the fix locally,
  verifying after each edit.

It reviews the net diff (default: against `origin/main`), fans out to a parallel
subagent per relevant review skill installed in the environment, and hunts for
AI slop, refactoring opportunities, and dead code — not just bugs.

### ui-code-review

The same review as a **single self-contained HTML page** instead of a terminal
session. The page has two tabs.

The **Overview** tab tells the whole-change story: what it does, its scope, the
before/after architecture diagrams, the verdict, the advantages, disadvantages,
and risks, the cross-cutting concerns, and a folded list of the skipped
bookkeeping.

The **Changes** tab lays out every semantic change in three panes — a sidebar
that navigates the changes with severity counts, a GitHub-style diff in the
center showing only that change's hunks (with a marker on every line carrying a
finding, a whole-file toggle, old/new file buttons, show/hide whitespace, and
side-by-side vs. unified), and on the right the change's briefing, its
advantages/disadvantages/risks, the surrounding code it needs, and the findings
with click-to-jump line anchors.

It is a report: it asks nothing, posts nothing, and edits nothing. The output
file needs no server and fetches nothing.

### concolic-test-generation

Generates tests that drive a module down execution paths its suite never takes.
It records the ordered branch decisions each existing test makes, targets every
path that shares a prefix with a known path and then flips one decision, and
uses the model in place of an SMT solver to find inputs for that path. A test is
kept only if its recorded path starts with the target prefix. Generated tests
are characterization tests, written to a separate `*.generated` test file; an
optional review pass on a stronger model judges whether each pinned behavior is
correct.

### layering-rules-check

Checks layering rules that lint and the compiler do not enforce, in a repo in
any programming language: a production module that imports a test module, a
layer that imports a layer the rules forbid, a package that imports a package it
does not declare, a barrel that re-exports another directory's module, and
source files the repo's checkers skip. The model builds a layering rules file
from the repo's docs and lint config, takes import edges from a language server
(or text search when none exists), and checks them against the rules with a
bundled Node script (no install). Findings are ranked, labeled by evidence
source, and each carries a proposed change and a check that verifies it. The
skill reports; it does not edit files. It is also a review lens: it follows the
lens protocol, supports the `diff`, `repo`, and `paths` scopes, and can return
findings in the structured format that `run-review-lenses` merges.

### useless-abstraction-scan

A review lens, also usable on its own, on a change set or a whole repo. Finds
abstractions that give the reader nothing, in any language: unread ones (a
field whose comment says it has no effect, a parameter or type with zero
readers, an options type with no members) and single-use ones (a function,
class, interface, or wrapper that one place uses, a forwarder, an interface with
one implementation). The model uses a language server when one is available
and falls back to text search and reading. Text-based helper scripts (Node 20+,
no packages) list candidates, count readers and uses, and check whether a symbol
leaves its package, with `gh search code` for published packages. The model then
confirms or drops each candidate by reading the code, applies refusal gates
(seam, public API, named intent, dynamic wiring, tests), and surveys what the
helpers cannot see. Output is findings, each with its evidence source, a
judgment, and a proposed change. The skill never edits files. A symbol it
cannot prove internal is a refusal.

### duplicate-function-unifier

Finds functions, in any programming language, whose bodies are identical once
comments and whitespace are removed, and proposes keeping one copy. A script
with no dependencies groups the duplicates and reports where a shared function
can live, who calls each name (text search, and other repos with
`gh search code`), and nearby layering docs. The model then reads the code,
and uses language server references when available, to confirm each finding and
to look for duplicates the script cannot see. It refuses groups that look deliberate, have
no allowed home, or have an unknown consumer. It reports findings, each with a
proposed change and the check that verifies it, and never edits files. It is
also a review lens: it follows the shared lens protocol, scopes candidates to a
diff, a path set, or the whole repo, and can return the lens wire format.

### Language grounding skills

One skill per language: `python-grounding`, `julia-grounding`,
`javascript-grounding`, `typescript-grounding`, `rust-grounding`,
`cpp-grounding`. Each is a router `SKILL.md` that points to per-topic files
under `references/`, so the agent loads only the topic it needs. They ground an
agent in what a construct does, which version introduced it, and where the
footguns are, so it does not pattern-match one language or version onto another.

| Skill | Versions | References |
|-------|----------|------------|
| `python-grounding` | 3.9-3.13 | semantics, types, stdlib, toolchain, versions, errors, sharp-edges, packages |
| `julia-grounding` | 1.6-1.13 | semantics, types, stdlib, toolchain, versions, errors, sharp-edges, packages |
| `typescript-grounding` | 5.x-7.1 | semantics, types, sharp-edges, versions, toolchain |
| `javascript-grounding` | | semantics, sharp-edges |
| `rust-grounding` | editions 2015-2024, releases to 1.100 | semantics, types, sharp-edges, versions, toolchain, packages |
| `cpp-grounding` | | semantics, types, sharp-edges, versions, toolchain |

Every reference ends with a "What an agent may/must not infer" section. Each
skill's `SKILL.md` tells the agent to detect the project's language version
before it writes or explains code.

To add a language, create `skills/<lang>-grounding/` with a router `SKILL.md`
(`name: <lang>-grounding`, a table pointing to each reference) and
`references/<topic>.md` files, then add eval cases. The eval runner and its
cases are in [`evals/language-grounding/`](evals/language-grounding/README.md).

## Install with Claude Code

Add this marketplace, then install the plugin:

```
/plugin marketplace add nystrom/nn-agent-skills
/plugin install nn-agent-skills@nn-agent-skills
```

Or from the terminal:

```bash
claude plugin marketplace add nystrom/nn-agent-skills
claude plugin install nn-agent-skills@nn-agent-skills
```

Once installed, there are three ways into a review. Ask for the findings alone
("review this and just tell me what's wrong") to get `run-review-lenses`. Ask to
walk through the changes one by one, "grill me on this diff", or "review my local
changes and fix them" for the interactive session. Ask for a web page or a review
report to get the HTML page.

## Install with Codex

```bash
codex plugin marketplace add nystrom/nn-agent-skills
codex plugin add nn-agent-skills@nn-agent-skills
```

Invoke the skills as `$run-review-lenses`, `$adversarial-review`,
`$performance-code-review`, `$risk-assessment`, `$test-coverage-code-review`,
`$dead-code-code-review`, `$ai-slop-code-review`, `$numerical-code-review`,
`$codex-code-review` (which skips itself inside Codex),
`$interactive-code-review`,
`$ui-code-review`, `$concolic-test-generation`, `$layering-rules-check`, `$useless-abstraction-scan`, `$duplicate-function-unifier`, the `$<lang>-grounding` skills,
or describe a matching task
and let Codex select the skill.

## Install with Antigravity

```bash
git clone https://github.com/nystrom/nn-agent-skills.git
agy plugin install ./nn-agent-skills/plugins/nn-agent-skills
```

Antigravity installs from the cloned checkout rather than a remote marketplace, so
`git pull` in that directory is how you update. The skills are the same set;
describe a matching task and let the agent select one.
