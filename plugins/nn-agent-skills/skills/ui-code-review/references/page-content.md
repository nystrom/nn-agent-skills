# Page content

The page is the whole review, read in any order the reader likes. Nothing is
posted, nothing is edited, and there is no turn-taking: every word the reviewer
will read has to be on the page.

Two content jobs: the **overview band** at the top, and one **change section**
per queue item.

## The overview band

The band is the first thing on the page and carries the whole-change story. Fill
all of it — `overview.what`, `overview.scope_line`, `overview.verdict`,
`overview.cross_cutting`, and `summary.routine`.

### What this change does
2–4 sentences on the overall intent, synthesized from the commit walk and the net
diff — the story of the change, not a file-by-file enumeration. If the branch is
really two unrelated changes wearing one PR, say that here.

### Scope
One line: how many semantic changes are in the review and the one-line summary of
what was skipped as bookkeeping. The skipped list itself goes in
`summary.routine`, where the band renders it folded. The review holds every
semantic change, so the count is the whole diff, not a shortlist of the
problematic ones.

### Verdict
Take a position on the change *as a whole* — a justification if it earns its
place, a critique if it doesn't. Be direct: "This is a clean, well-scoped change"
or "This mixes two concerns and should be split", not a neutral recap.

### Cross-cutting concerns
The concerns no individual change owns, one per entry in
`overview.cross_cutting`:

- Architectural direction and whether the decomposition is the right one.
- Systemic gaps — missing tests across the board, no error handling anywhere,
  observability holes.
- Scope: is the PR doing too much and should be split? Too little to stand alone?
- Whether the stated intent actually matches what the diff does.

Draw these from the merged fan-out findings that are **structural rather than
local** — the ones with no single change to attach to. Local, change-specific
findings stay on their change and are *not* pre-empted here.

## A change section

Every semantic change gets its own section, whether or not the fan-out landed a
finding on it. A clean change is written up the same way, with an honest "nothing
jumps out" in its findings. The reader is being walked through the diff, not
through a defect list.

### Briefing (`briefing`)
Short beats in plain language. Assume the reader has never seen the code — give
all five:

- **What this is** — one sentence. The change in human terms.
- **Why it exists** — the intent, drawn from the commit message / PR body. If the
  commit message is unhelpful, say what the code implies and flag the uncertainty.
- **What uses it / who calls it** — the callers, importers, or triggers. Name them
  with `path:line`. If nothing calls it yet (new code, dead code), say so — that
  itself is reviewable.
- **Who consumes the result** — the other side: who reads the value, handles the
  event, or depends on the output.
- **What's tested** — whether the change is tested and how; what tests are
  missing.

### Context (`context`)
The code the diff doesn't show but the reader needs: the caller, the definition of
the type being passed, the test that covers it. Each block carries a real
`path:line`. Quote the minimum that makes the change reviewable — 5 to 15 lines
per block. This is the reader's only chance to see it; there is no conversation
to fill the gap.

### What could be improved (`comments`)
The merged findings that landed on this change (see `multi-agent-review.md`),
ranked by severity, each tagged with the `source` lens that produced it and, where
it applies, a new-file `line` so the page can jump to it. Include
long-run-quality findings — slop, refactor and abstraction opportunities, dead
code, duplication — not just bugs. Where a finding carries a concrete
`suggested_fix`, keep it: the reader decides what to do with it.

If nothing landed on the change, leave `comments` empty. The page renders
"Nothing jumps out — looks correct" on its own; do not invent filler.

## What the terminal says

The terminal gets the output path and a short headline — the verdict in a sentence
or two and the count of changes written up. It is not a second copy of the review:
do not restate the walkthrough there.
