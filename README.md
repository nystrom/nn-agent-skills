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

Assume the change is subtly wrong and find how it fails. Expensive, dangerous,
and hard-to-detect failures: auth and trust boundaries, data loss, races,
retry/idempotency holes, migration hazards, observability gaps. Material
findings only, each with a concrete fix. Also usable on its own when you want
just the adversarial pass.

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
(tautologies, duplicates, mock-only, coverage theater) with a prune proposal.
Behavioral coverage, not a line-percent scolding. Standalone or via the fan-out.

### dead-code-code-review

Dead-code lens: unreachable helpers, unused exports, orphaned modules, stale
flags, commented-out blocks — with removal proposals. Treats public/exported
API conservatively and looks for callers in other repos (`gh search`, monorepo
siblings) before calling something dead. Standalone or via the fan-out.

### ai-slop-code-review

Ruthless AI-slop lens: narrating comments, needless wrappers, impossible
defensive checks, enterprise cosplay, verbose restatements of one-line idioms,
duplicate thoroughness, theatrical tests. Persistent multi-pass; proposes
deletion or the tight rewrite. Standalone or via the fan-out.

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

### evolve

An LLM-driven evolutionary code optimizer inspired by AlphaEvolve. It runs
candidate mutations in isolated git worktrees, evaluates them with a
user-defined fitness function, and retains the strongest result across
iterations.

Claude Code and Antigravity receive the Evolve commands, agents, hooks, and scripts.
Codex receives a native `$evolve` skill that runs the same scripts without
depending on Claude's stop hook.

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
report to get the HTML page. Invoke Evolve with `/nn-agent-skills:evolve` and the
target plus fitness criteria; see
[`plugins/nn-agent-skills/skills/evolve/README.md`](plugins/nn-agent-skills/skills/evolve/README.md)
for examples and requirements.

## Install with Codex

```bash
codex plugin marketplace add nystrom/nn-agent-skills
codex plugin add nn-agent-skills@nn-agent-skills
```

Invoke the skills as `$run-review-lenses`, `$adversarial-review`,
`$performance-code-review`, `$risk-assessment`, `$test-coverage-code-review`,
`$dead-code-code-review`, `$ai-slop-code-review`, `$interactive-code-review`,
`$ui-code-review`, and `$evolve`, or describe a matching task and let Codex
select the skill.

## Install with Antigravity

```bash
git clone https://github.com/nystrom/nn-agent-skills.git
agy plugin install ./nn-agent-skills/plugins/nn-agent-skills
```

Antigravity installs from the cloned checkout rather than a remote marketplace, so
`git pull` in that directory is how you update. The skills are the same set;
describe a matching task and let the agent select one.
