# Multi-agent review — load every relevant review lens, one merged findings list

The review step fans out to **one subagent per relevant review lens installed in
the environment**, has each subagent **load and apply that lens**, and **merges
all their findings into a single list**. No lenses are named or embedded here —
they are discovered at review time from whatever is available. A "lens" is any
code-review tool in the environment, whether it ships as a **skill** (in the
available-skills list) or as a **command** (a slash command such as the builtin
`/code-review`).

Subagents have the `Skill` tool and see the available-skills list, so they load
the real installed skill rather than a vendored copy.

Run the fan-out **once, up front** (SKILL.md step 5), over the whole change set —
not per change. One agent per applicable skill per session, not `skills × N`.
Attach each finding to the queue item it lands on so it renders on the right
change's section of the page.

## Discover which lenses to run

At review time, select the **review lenses**: tools whose *purpose is
reviewing/critiquing/auditing code* — a PR, a branch, a diff, a change set, or
code quality generally. Judge this by what the tool **is for**, not by whether
its description happens to spell out "diff" or "emits findings." Descriptions
vary in verbosity: a terse one like "Code Review Guidelines" is as much a review
lens as a paragraph-long one — **when a tool reads as a code-review tool at all,
include it.** Today that typically pulls in general code/adversarial review,
security review, standards/spec review, code-quality/simplification review (e.g.
`simplify`), any project-specific review skill, and — **when it is installed** —
the builtin `code-review` command. But **select by
what the tool is, not by a fixed list**, so new review lenses are picked up
automatically and removed ones drop out.

Look in two places, because lenses ship in two forms:

- **Skills** — scan the available-skills list. These are loaded via the `Skill`
  tool.
- **Commands** — the builtin `code-review` ships as a slash command, not a skill,
  so it is *not* in the available-skills list. If the environment surfaces slash
  commands to you, check there; but do not rely on that — locate its instruction
  file directly with a best-effort glob such as
  `~/.claude/plugins/**/commands/code-review.md` (several may match across
  marketplaces; prefer the official `code-review` plugin, and confirm the file's
  own frontmatter reads as a code-review command). Include it whenever such a file
  is found. It is applied by **reading that file and following its methodology**,
  not by invoking the command (see Spawning for why).

The builtin `code-review` differs from a skill lens in how it is applied, all
handled at spawn time:

- Its **PR dependency lives only in its reporting steps** — linking GitHub blob
  URLs and posting the comment. Because a lens strips those steps anyway (below),
  its diff-based methodology applies with no PR present at all: feed it the net
  diff as scope and it reviews the local changes.
- Its own instructions **bail early** (closed/draft/already-reviewed PR) and
  **filter out any issue scoring below its confidence threshold** before
  reporting. For a *lens* we want the raw scored issues, so neither gate applies —
  don't abort, and surface every scored issue (see Spawning).
- Its final step **posts a comment to the PR** via `gh`. That must not happen
  here — this skill posts nothing and edits nothing; it writes a page (see
  Spawning).

Bias toward inclusion: an extra general lens costs one parallel subagent and its
findings merge (and de-duplicate) with the rest, so a borderline "is this a
review tool?" resolves to **yes**. Overlap between general lenses is expected and
handled at the merge step, not by pruning lenses here.

Exclude only:

- **`ui-code-review` and `interactive-code-review`** — no recursion.
- Tools that don't review code — diagnosis, verification, run/build,
  authoring/scaffolding helpers, etc. They critique nothing. (A tool that
  *reviews* code quality and then offers to apply the change — e.g. `simplify` —
  is a review lens, not a transformation tool: include it and take only its
  findings. See Spawning.)

## Applicability — let each lens self-gate

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

State which lenses ran and which were skipped and why; don't invent findings to
fill a lens that had no context. It is normal for only the general lens(es) to
apply in a plain repo.

## Spawning

Send **one message with all applicable `Agent` calls** so they run in parallel.
Use the `general-purpose` subagent type and pass `model: "sonnet"` on every
call, so lens work runs on Sonnet regardless of the model driving the review.
Each prompt must:

- Name the **one lens this subagent owns** and instruct it to **load and apply**
  that lens, using its own methodology and judgement — its finding bar, severity
  vocabulary, attack surface, style rules. How the subagent loads it depends on
  what the lens is:
  - a **skill** — invoke it via the `Skill` tool. **Do not** vendor a copy of a
    skill by reading its files; use the tool. Invoking a skill loads its
    instructions for the subagent to follow, so the subagent stays in control of
    where to stop: if the skill's methodology ends by *applying* a change (e.g.
    `simplify`, which reviews for quality and then fixes), **stop at the
    finding** — capture the change it would make as `suggested_fix` and return
    it, applying nothing. That apply-step is exactly the "act" the return-only
    rule below forbids.
  - the builtin **`code-review` command** — **read its instruction file** (the
    path found during discovery) and follow its review methodology, but **stop
    short of the reporting/side-effect steps**: do *not* run its early-exit
    eligibility gate as a reason to produce nothing, do *not* apply its
    confidence-threshold filter (surface every issue it scores, carrying the
    score into the finding's `note`), and make **no `gh` calls / open no
    comments**. Running the command as a black box (via a `SlashCommand` tool)
    would execute all of those steps — the threshold filter and the final GitHub
    post — and hand back a rendered PR comment instead of structured findings, so
    do not invoke it that way; read-and-apply is the only path for this lens.
- Include the **scope command** from step 1 (the net diff against the review
  base) and the commit list.
- **Override the lens's native output format.** Review lenses natively emit prose
  (Summary/Must-fix/Suggestions, ship/no-ship blobs). That prose can't be
  attached to per-change queue items, so require a structured per-finding list
  instead, one object per finding:

  ```
  { source, path, line, severity, note, suggested_fix }
  ```

  - `source` — the **name of the lens** that produced the finding (e.g. the
    skill slug or command name). This is provenance for the reader; everything
    still lands in one merged list.
  - `line` — new-file line number, or `null` for a file-/design-level finding.
  - `suggested_fix` — the concrete change: the smallest edit that resolves it.
    Always ask for it; it renders under the finding on the page.
- **A lens must only *return* findings — never act.** No subagent may post to
  GitHub, edit files, or take any other side effect; it hands back the structured
  list and nothing else. Nothing in this skill posts or edits — the output is a
  page the reviewer reads. This is the reason the `code-review` command is applied
  by reading its file and skipping its final steps rather than run as a command:
  run whole, it would comment on the PR before the reviewer has seen anything. A
  skill whose methodology ends in an edit (`simplify`) is held to the same rule
  the other way around: it is still invoked via the `Skill` tool (there is no
  file to read — it is builtin), but the subagent follows the loaded instructions
  only up to the proposed change and returns it as `suggested_fix`.

Ask the agent to also return its one-line ship/no-ship headline, but the
structured list is what you consume. A lens that itself fans out into further
sub-agents (e.g. a standards+spec lens splitting into two axes, or `/code-review`
spawning its own audit agents) is fine — you spawn it as one agent and it returns
findings tagged by `source`.

## Merging into one list

Collect the findings from every agent into a **single list**. Then:

- **De-duplicate** where two skills flag the same line for the same reason; keep
  the more specific wording and note both sources.
- **Rank** by severity/confidence so the reviewer sees the sharpest issues first,
  regardless of which skill found them.
- **Keep the `source` tag** on each finding as provenance — it tells the reviewer
  which lens produced the finding, but it does not split the list.

## Feeding the page

Each change section's **"what could be improved"** is the merged findings that
landed on it, each tagged by its `source` skill name so the reader knows which
lens produced it. A change with no findings from any skill gets an honest "nothing
jumps out" — and still gets its own section. The findings decide what a change's
write-up says, never which changes appear; the queue was fixed before this fan-out
ran.

The **structural** findings — the ones with no single change to attach to — go
into the overview band's verdict and cross-cutting list instead (see
`page-content.md`).

## Fallback — no subagent tool available

If the environment can't spawn subagents (e.g. a plain terminal with no `Agent`
tool), do the review inline: **load and apply each applicable review lens
yourself** in sequence — skills via the `Skill` tool, the builtin `code-review`
command by reading its instruction file and following its methodology (skipping
the eligibility bail, the confidence filter, and the GitHub post, exactly as
above) — then merge into the same single list. The output is the same; only the
parallelism is lost. Never silently drop a lens — if you skip one, say why. If
even the `Skill` tool is unavailable, fall back to the solo checklist in
`adversarial-review.md`.
