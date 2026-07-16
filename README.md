# agent-skills

A [Claude Code](https://claude.com/claude-code) plugin marketplace hosting agent skills.

## Plugins

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

### evolve

An LLM-driven evolutionary code optimizer inspired by AlphaEvolve. It runs
candidate mutations in isolated git worktrees, evaluates them with a
user-defined fitness function, and retains the strongest result across
iterations.

The plugin provides `/evolve:evolve`, `/evolve:evolve-status`, and
`/evolve:evolve-stop`, plus the agents, hooks, and scripts that drive the
optimization loop.

## Installation

Add this marketplace, then install the plugin you want:

```
/plugin marketplace add nystrom/agent-skills
/plugin install interactive-code-review@agent-skills
/plugin install evolve@agent-skills
```

Or from the terminal:

```bash
claude plugin marketplace add nystrom/agent-skills
claude plugin install interactive-code-review@agent-skills
claude plugin install evolve@agent-skills
```

Once installed, invoke it by asking Claude Code to review a PR or branch
interactively, walk through changes one by one, "grill me on this diff", or
"review my local changes and fix them". Invoke Evolve with `/evolve:evolve` and
the target plus fitness criteria; see [`plugins/evolve/README.md`](plugins/evolve/README.md)
for examples and requirements.
