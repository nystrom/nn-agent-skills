# Multi-agent review — load every relevant review skill, one merged findings list

The review step fans out to **one subagent per relevant review skill installed in
the environment**, has each subagent **load and apply that skill**, and **merges
all their findings into a single list**. No skills are named or embedded here —
they are discovered at review time from whatever is available.

Subagents have the `Skill` tool and see the available-skills list, so they load
the real installed skill rather than a vendored copy.

Run the fan-out **once, up front** (SKILL.md step 5), over the whole change set —
not per change. One agent per applicable skill per session, not `skills × N`.
Attach each finding to the queue item it lands on so the interactive session can
surface it at the right change.

## Discover which skills to run

At review time, scan the available-skills list and select the **review lenses**:
skills whose *purpose is reviewing/critiquing/auditing code* — a PR, a branch, a
diff, a change set, or code quality generally. Judge this by what the skill **is
for**, not by whether its description happens to spell out "diff" or "emits
findings." Descriptions vary in verbosity: a terse one like "Code Review
Guidelines" is as much a review lens as a paragraph-long one — **when a skill
reads as a code-review tool at all, include it.** Today that typically pulls in
general code/adversarial review, security review, standards/spec review, and any
project-specific review skill — but **select by what the skill is, not by a fixed
list**, so new review skills are picked up automatically and removed ones drop
out.

Bias toward inclusion: an extra general lens costs one parallel subagent and its
findings merge (and de-duplicate) with the rest, so a borderline "is this a
review skill?" resolves to **yes**. Overlap between general lenses is expected and
handled at the merge step, not by pruning lenses here.

Exclude only:

- **`interactive-code-review` itself** — no recursion.
- Skills that don't review code — diagnosis, verification, simplification,
  run/build, authoring/scaffolding helpers, etc. They critique nothing.

## Applicability — let each skill self-gate

Drive applicability off **each skill's own stated domain**, not a hardcoded
per-skill table. A skill scoped to a particular toolchain, language, or file kind
runs only when the change set is in that domain; a general lens always applies.
Judge this from the skill's description against the repo and the diff (files
touched, project markers, presence of standards/spec sources). When in doubt,
run it — a loaded skill whose domain is absent will report that it found nothing
applicable, which is cheap and honest.

**Standards/spec lenses are applicable per-axis, and a standards doc is almost
always present.** A lens that checks against a standards doc applies whenever *any*
such doc exists — `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CONTEXT.md`,
`STYLE*.md`, `DESIGN.md`, `docs/adr/` — which is the common case, so **run it
rather than skipping.** Don't gate the whole lens on *also* finding a spec: if
only the standards source exists, run the standards axis and note the spec axis
as unavailable (and vice versa). Only skip such a lens outright when *neither* a
standards doc nor a spec/issue can be found.

State which skills ran and which were skipped and why; don't invent findings to
fill a lens that had no context. It is normal for only the general lens(es) to
apply in a plain repo.

## Spawning

Send **one message with all applicable `Agent` calls** so they run in parallel.
Use the `general-purpose` subagent type. Each prompt must:

- Name the **one skill this subagent owns** and instruct it to **invoke that
  skill via the `Skill` tool** and apply the skill's own methodology and
  judgement — its finding bar, severity vocabulary, attack surface, style rules.
- Include the **scope command** from step 1 (comment mode:
  `git diff origin/main...HEAD`; fix mode: the merge-base-to-working-tree diff)
  and the commit list.
- **Override the skill's native output format.** Review skills natively emit prose
  (Summary/Must-fix/Suggestions, ship/no-ship blobs). That prose can't be
  attached to per-change queue items, so require a structured per-finding list
  instead, one object per finding:

  ```
  { source, path, line, severity, note, suggested_fix }
  ```

  - `source` — the **name of the skill** that produced the finding (e.g. the
    skill slug). This is provenance for the reader; everything still lands in one
    merged list.
  - `line` — new-file line number, or `null` for a file-/design-level finding.
  - `suggested_fix` — the concrete change (required in fix mode; the smallest edit
    that resolves it).

Ask the agent to also return its one-line ship/no-ship headline, but the
structured list is what you consume. A review skill that itself fans out into
further sub-agents (e.g. a standards+spec lens splitting into two axes) is fine —
you spawn it as one agent and it returns findings tagged by `source`.

## Merging into one list

Collect the findings from every agent into a **single list**. Then:

- **De-duplicate** where two skills flag the same line for the same reason; keep
  the more specific wording and note both sources.
- **Rank** by severity/confidence so the reviewer sees the sharpest issues first,
  regardless of which skill found them.
- **Keep the `source` tag** on each finding as provenance — it tells the reviewer
  which lens produced the finding, but it does not split the list.

## Feeding the interactive session

Each queue item's **"what could be improved"** is the merged findings that landed
on it, each tagged by its `source` skill name so the reviewer knows which lens
produced it. A change with no findings from any skill gets an honest "nothing
jumps out."

In **fix mode**, every finding should still carry a concrete fix (per
`apply-fix.md`) — the subagents propose the change; you preview, apply, and
verify it during the session.

## Fallback — no subagent tool available

If the environment can't spawn subagents (e.g. a plain terminal with no `Agent`
tool), do the review inline: **invoke each applicable review skill yourself via
the `Skill` tool** in sequence, then merge into the same single list. The output
is the same; only the parallelism is lost. Never silently drop a lens — if you
skip one, say why. If even the `Skill` tool is unavailable, fall back to the
solo checklist in `adversarial-review.md`.
