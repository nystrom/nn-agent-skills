---
name: run-review-lenses
description: >-
  Review a change set with every code-review lens installed in the environment
  and write the result to review.json — the findings, and nothing else. It fans
  out to a parallel subagent per relevant lens (skills and commands like the
  builtin code-review, discovered at review time, not a fixed set), each loading
  and applying that lens, merged and de-duplicated into one severity-ranked list.
  Before that it establishes scope, walks the branch commit by commit to learn
  why each change exists, splits the diff into semantic changes versus
  bookkeeping noise, and gathers the context each change needs (definitions,
  callers, consumers, tests), so every finding is attached to the change it lands
  on. It reviews the NET diff (against origin/main by default, optionally
  including uncommitted work), ignoring changes that later commits undid. The
  goal is the software's long-run quality, so it hunts AI slop, refactoring and
  abstraction opportunities, and dead code, not just bugs. It does NOT walk you
  through the changes, post to GitHub, edit files, or render a page — it produces
  review.json and, run on its own, prints a short ranked summary. Use this when
  the user wants the findings and nothing more: "review this and just tell me
  what's wrong", "what would a code review flag here?", "run the review lenses",
  or when another skill needs a review to build on. For a guided change-by-change
  session that posts comments or applies fixes, use interactive-code-review; for
  the whole review as a browsable HTML page, use ui-code-review. Both of those
  run this skill first.
---

# Run Review Lenses

Review a change set and record the result in `review.json`. This is the review
itself — scope, intent, classification, context, and the lens fan-out — with no
presentation attached. Something else decides what to do with the findings.

The overarching goal is to make the software *better in the long run*, not merely
to catch bugs in this diff. Read every change asking not just "is this correct?"
but "does this raise the quality of the codebase?": AI slop, opportunities to
refactor or introduce a cleaner abstraction, dead code to remove, duplication to
collapse.

## Inputs

Both are optional; the defaults are right for a standalone run.

- **Scope** — a PR, branch, or range. Defaults to the net diff against
  `origin/main`. Set `include_working_tree` when uncommitted changes are part of
  the surface (a consumer fixing local code wants this; a consumer commenting on
  a PR does not).
- **Briefing depth** — `full` (default): write for a reviewer who has **never
  seen this codebase**, all five beats. `light`: the reader wrote this code, so
  gather only what makes a change safe to act on — what uses it, and what's
  tested.

Read each resource as you reach the step that needs it:

- `references/change-classification.md` — semantic vs. routine.
- `references/net-diff-and-context.md` — the net-diff/commit reasoning **and**
  how to gather context.
- `references/multi-agent-review.md` — the fan-out: **discover every relevant
  installed review lens (skills *and* commands like `/code-review`) → one subagent
  loads and applies each → one merged findings list**, plus applicability
  detection.
- `references/adversarial-review.md` — severity calibration, what makes a finding
  worth filing, and the solo checklist for when no lens can be loaded at all.
- `references/review-json.md` — the output contract.

## Workflow

### 1. Establish scope

**A caller's inputs are authoritative.** When a consumer supplied a scope or
`include_working_tree`, use them as given and do not re-derive either — the
consumer already decided, and a second opinion here produces a queue that
disagrees with what the consumer told the user. Skip the detection below and go
straight to the diff.

Detect only what was not supplied:

```bash
git fetch origin --quiet
git status --porcelain                                 # dirty tree?
gh pr view --json number,url,headRefName 2>/dev/null   # is there a PR?
```

Review the **net diff against origin/main** — committed work only:

```bash
git diff origin/main...HEAD --stat          # or origin/master if that's the base
```

`A...B` (three dots) diffs against the merge-base, so it already shows the *net*
effect of the branch.

When `include_working_tree` is set, extend the same surface through the
uncommitted changes in one command, so files that are both committed and further
modified aren't listed twice:

```bash
git diff $(git merge-base origin/main HEAD) --stat   # merge-base → working tree
```

(Omitting the second ref makes `git diff` compare against the working tree.) If
the tree is clean this reduces to the same net diff.

State the base and scope in one line and proceed. Only ask if it's genuinely
ambiguous (e.g. detached HEAD with no obvious base, and no caller said otherwise).
Record both in `scope` and `base`.

### 2. Understand the branch commit by commit — but review the net diff

Read `references/net-diff-and-context.md`. The key idea: **walk the commits to
learn *why* each change exists, but review the net diff so changes that a later
commit undid never reach the reader.**

```bash
git log --oneline --no-merges origin/main..HEAD     # newest → oldest
```

Read the commit messages (and per-commit diffs when a message is thin) to build
the *intent* behind each surviving change. Then classify against the **net**
diff from step 1 — anything added and later reverted simply isn't in it, so it
is correctly out of scope. Do not review intermediate states.

### 3. Classify: semantic vs. bookkeeping

Apply `references/change-classification.md`. Keep the **semantic** changes — the
ones that change what the code does (logic, control flow, interfaces,
concurrency, security, behavior-changing config, behavior deletions). Collapse
**bookkeeping** — whitespace/reformat, import shuffles, pure renames,
moved-unchanged code, generated files/lockfiles, snapshot text, comment-only
edits — into the `summary.routine` list.

Those two buckets are exhaustive: a change is either semantic or it matches a
bookkeeping category in the reference. "Not worth reviewing" is not a third
bucket. The one collapse that spans both is the repeated mechanical edit
(`foo()` → `self.foo()` across 30 call sites): queue one representative instance
and summarize the identical remainder with its count, per the "Borderline calls"
section of the reference. That applies only when the sites really are identical —
any site that differs is its own queue item.

Order the surviving semantic changes into a queue. Group by logical change, not
by file: one reviewable idea = one queue item, even across files. **There is no
cap on the queue length** — it holds *every* semantic change, whether that is 2
or 30. Never truncate to a "top N" or a round number, and never drop a real
change to keep the output short; only bookkeeping is collapsed.

**The queue is final here.** Later steps attach findings to queue items; they
never add or remove one. Whether a lens flagged something has no bearing on
whether a change is in the queue — a correct, uncontroversial change is still a
change.

### 4. For each change, gather context

Apply the context-gathering guidance in `references/net-diff-and-context.md`.
For every queue item, fill the `briefing` beats:

- **What** the change is (the diff hunk, widened so it reads in situ).
- **Why it exists** — from the commit message / PR intent, in plain language.
- **What uses it / who calls it** — call sites of a changed function, importers
  of a changed symbol. This is the highest-value context; find it with
  `git grep -n` or `rg -n`.
- **Who consumes the result** — the other side of the interface: the reader of
  what was written, the handler of what was emitted, the caller that uses the
  return value.
- **What's tested** — the covering test, or note its absence.

At `light` depth, gather only **what uses it** and **what's tested**; skip the
explanatory beats.

Quote the *minimum* that makes a change reviewable (5–15 lines per block), each
with a real `path:line`. These become the `context[]` blocks.

### 5. Review with the multi-agent fan-out

Read `references/multi-agent-review.md` and run the fan-out **once over the whole
change set** — not per change. Discover every relevant review lens installed in
the environment — skills *and* commands like the builtin `/code-review` — and
spawn a parallel subagent per lens that **loads and applies it** (a skill via the
`Skill` tool; the builtin `code-review` command by reading and following its
instruction file), whose findings all merge into **one list**. Every lens subagent
runs on Sonnet (`model: "sonnet"`), not the model driving the review. Between
them they cover correctness bugs *and* long-run quality (AI slop, refactor and
abstraction opportunities, dead code, duplication) *and* conformance to
standards/spec — whatever the available lenses cover.

Discover and gate applicability first (per the reference): select review lenses
by **what each one is for** (any code-review lens, however terse its
description). Look in two places — the available-skills list for **skills**, and
the plugin commands directory for the builtin **`code-review` command** (which
won't show up as a skill; find its instruction file with a glob like
`~/.claude/plugins/**/commands/code-review.md`). Exclude this skill and its
consumers, and let each lens self-gate on its own stated domain against the repo
and diff — biasing toward inclusion, since a standards doc (`CLAUDE.md`, etc.) is
almost always present and overlapping general lenses de-duplicate at the merge
step.

Apply the `code-review` command by **reading its instruction file and following
the methodology while skipping its eligibility bail, its confidence filter, and
its final GitHub post** — it returns findings, it never comments; its only PR
dependency is in those stripped reporting steps, so it works with no PR present.
A quality-review skill that ends by applying a change (e.g. `simplify`) is a lens
too: invoke it via the `Skill` tool but **stop at its findings**, returning the
change as a `suggested_fix` rather than letting it edit. Skip any lens that
genuinely has no context, and say so rather than faking findings. If no subagent
tool is available, load and apply the lenses inline in sequence — same merged
list, no parallelism.

De-duplicate and rank the merged findings by severity, then attach each to the
queue item it lands on, tagged by its `source` lens as provenance. File real
concerns only — a change that collects no findings gets an empty `comments` list,
which is an honest result, not a gap to fill. Findings that belong to no single
change go in `structural[]`.

### 6. Write the overview and the file

Write the three `overview` fields:

- **`what`** — the overall intent across all commits, 2–4 sentences, synthesized
  from the commit walk in step 2 and the net diff, not a file-by-file list.
- **`scope_line`** — one line: `M` semantic changes queued against `N`
  bookkeeping edits skipped.
- **`verdict`** — does the change, taken together, earn its place? Take a
  position. Draw on `structural[]`: architectural direction, missing tests across
  the board, scope creep, a cleaner decomposition, whether it should be split. Do
  not hedge into a neutral recap.

Assemble everything into one object per `references/review-json.md` and write it:

```bash
<workdir>/review.json
```

Tell the caller that path. If a consumer invoked this skill, stop here — the file
is the handoff.

### 7. Standalone ending

Only when a user invoked this skill directly. Print a short summary and nothing
more — no walkthrough, no per-change briefings:

- the scope line (base, files, +/-);
- `M` semantic changes queued, `N` bookkeeping edits skipped;
- the verdict in a sentence or two;
- the findings ranked by severity, each as one line: severity, `path:line`, the
  finding, and its `source` lens in brackets;
- the `review.json` path.

Then stop. If they want the changes walked one at a time, that's
`interactive-code-review`; as a browsable page, `ui-code-review`. Say so if the
findings list is long enough that reading it in the terminal is the wrong shape.

## Notes

- Keep change `id`s short and stable (`c1`, `c2`, …); consumers anchor to them.
- Never drop a change. The only changes that skip the queue are the ones matching
  a bookkeeping category in `references/change-classification.md`. A semantic
  change is never omitted for being small, obvious, or free of findings.
- This skill posts nothing and edits nothing. A lens that wants to act is stopped
  at its findings — see `references/multi-agent-review.md`.
- A `suggested_fix` is recorded, never applied. Whether it is offered, applied, or
  ignored is the consumer's decision.
