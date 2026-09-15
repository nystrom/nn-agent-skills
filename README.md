# nn-agent-skills

Installable agent skills and plugins for Claude Code, Codex, and `agy`.

## Skills

### run-review-lenses

Review a change set with **every code-review lens installed in the environment**
and write the result to `review.json` — the findings, and nothing else. It
establishes scope, walks the branch commit by commit to learn why each change
exists, splits the diff into semantic changes versus bookkeeping noise, gathers
the context each change needs, then fans out a parallel subagent per lens and
merges their findings into one severity-ranked list attached to the changes they
land on.

It is the basis for the two skills below — both run it first and present the
`review.json` it writes. Run on its own, it prints a short ranked summary for
when you want the findings and nothing more.

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

Claude Code and `agy` receive the Evolve commands, agents, hooks, and scripts.
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

Invoke the skills as `$run-review-lenses`, `$interactive-code-review`,
`$ui-code-review`, and `$evolve`, or describe a matching task and let Codex
select the skill.

## Install with agy

```bash
git clone https://github.com/nystrom/nn-agent-skills.git
agy plugin install ./nn-agent-skills
```

`agy` installs from the cloned checkout rather than a remote marketplace, so
`git pull` in that directory is how you update. The skills are the same four;
describe a matching task and let the agent select one.
