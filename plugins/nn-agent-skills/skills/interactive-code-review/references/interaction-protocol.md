# Interaction protocol

This skill runs as a **turn-by-turn session**, modeled on a grill-me flow: show
one thing, hand control back, wait. Every change is presented as a self-contained
briefing, and nothing advances without the reviewer's input. The briefing and
the action at the end of each turn depend on the **mode** (see SKILL.md):
**comment mode** ends in three comment options; **fix mode** ends in a proposed
fix you apply and verify.

## The opening overview turn

The **first** message of the session frames the whole PR before any single change
is presented. Produce one message, then stop and let the reviewer proceed. It has
three parts:

### 1. What this PR does
2–4 sentences on the overall intent, synthesized from the commit walk and the net
diff — the story of the change, not a file-by-file enumeration. If the branch is
really two unrelated changes wearing one PR, say that here.

### 2. Scope
One or two lines: how many semantic changes are queued (`N changes to walk`) and
the one-line bookkeeping summary of what's being skipped. This is the only place
the bookkeeping summary is stated; never repeat it later. The queue is every
semantic change, so `N` is the number of turns coming — not a shortlist of the
problematic ones.

### 3. High-level verdict
Take a position on the change *as a whole* — a justification if it earns its
place, a critique if it doesn't. This is where cross-cutting concerns live: ones
that no individual change owns.

- Architectural direction and whether the decomposition is the right one.
- Systemic gaps — missing tests across the board, no error handling anywhere,
  observability holes.
- Scope: is the PR doing too much and should be split? Too little to stand alone?
- Whether the stated intent actually matches what the diff does.

Draw these from the merged fan-out findings that are **structural rather than
local** — the ones that would otherwise have no single change to attach to. Be
direct: "This is a clean, well-scoped change" or "This mixes two concerns and
should be split" — not a neutral recap. Local, change-specific findings stay
attached to their change and are *not* pre-empted here.

Close with a line that you'll now walk the changes one at a time, and **stop** —
wait for the reviewer before presenting Change 1.

## The per-change turn

For each item in the review queue, in order, produce **one** message. Every queue
item gets a turn, whether or not the fan-out landed a finding on it; a clean
change is presented the same way, with an honest "nothing jumps out" in beat 3.

### 1. Header
`**Change N of M — <short title>**  ·  <file(s)>  ·  <kind>`

### 2. Briefing (always in the chat, GUI or not)
Short beats in plain language. Assume the reviewer has never
seen the code — give all four:

- **What this is** — one sentence. The change in human terms.
- **Why it exists** — the intent, drawn from the commit message / PR body. If
  the commit message is unhelpful, say what the code implies and flag the
  uncertainty.
- **What uses it / who calls it** — the callers, importers, or triggers. Name
  them with `path:line`. If nothing calls it yet (new code, dead code), say so —
  that itself is reviewable.
- **Who consumes the result** — the other side: who reads the value, handles the
  event, or depends on the output.
- **What's tested** — Whether the change is tested, and how. What tests are missing?

### 3. What could be improved
The merged findings that landed on this change from the fan-out (see
`multi-agent-review.md`), as a short list ranked by severity. Tag each by source
— `[<skill-name>]`, the review skill that produced it — with a severity word
and, where it applies, a line reference. Include long-run-quality findings (slop,
refactor and abstraction opportunities, dead code, duplication), not just bugs.
If nothing landed here, say "Nothing jumps out — looks correct to me" rather than
inventing filler.

### 4. The action — offer per-mode options + escape hatches

**Comment mode** — three genuinely different *angles* on the main concern (not
one comment reworded three ways). If there's no real concern, the three shift
toward praise / a clarifying question / skip.

```
How do you want to respond?
  1) Request a change — <one-line preview of the request-change comment>
  2) Ask a question   — <one-line preview of the question comment>
  3) Nit / praise     — <one-line preview of the lighter comment>
  s) Skip, no comment
  e) Write your own (tell me what to say and I'll post it)
```

Keep the full text of each option ready, but preview it in one line so the
message stays scannable; post the full version once they choose.

**Fix mode** — the concrete fix, with a preview of the edit, plus alternates
where a genuinely different approach exists. See `apply-fix.md` for how to build
and verify these. If there's nothing to fix, present the change anyway, say the
code looks right, and offer to advance — the turn still happens.

```
How do you want to fix this?
  1) Apply this fix        — <one-line preview of the edit>
  2) A different approach  — <one-line preview of the alternative>  (omit if none)
  3) Leave as-is / skip
  e) Tell me how to fix it (I'll make the edit)
```

### 5. Stop
End the turn here. Do **not** generate the next change. The reviewer's reply
drives the next step. This pause is the whole point — it keeps the review a
conversation the reviewer controls.

## On their reply

**Comment mode:**
- **1 / 2 / 3** → post that comment to GitHub per `github-submit.md`, confirm in
  one line (with the comment URL if returned), then present the next change.
- **e / free text** → post their wording (lightly cleaned up if asked), confirm,
  advance.
- **s / "next"** → record it as reviewed-no-comment, advance.

**Fix mode:**
- **1 / 2** → apply that fix and verify it per `apply-fix.md`, confirm in one
  line (what you changed + verification result), then present the next change.
- **e / free text** → make the edit they describe, verify, confirm, advance.
- **3 / s / "next"** → record it as reviewed-not-fixed, advance.

**Either mode:** a question about the change → answer it, then re-offer the
options. Don't advance until they've chosen.

## GUI vs. terminal presentation

Detect whether output can render HTML (a chat GUI / app that shows file cards or
artifacts) versus a plain terminal.

**GUI — render an HTML card per change.** Build a single-change JSON matching
`references/review-schema.md` (one entry in
`changes[]`: the widened diff, the context blocks you gathered, and the concerns
as `comments[]`), then run the renderer:

```bash
python3 scripts/render_review.py change-cN.json -o change-cN.html
```

Paths are relative to this skill's directory. Present `change-cN.html` (via the
file-presentation / artifact tool), and put the briefing and the per-mode action
options in the chat message next to it. One card per turn — do not pre-render the
whole queue. In fix mode the card still shows the findings; the proposed fix is
previewed and applied through the chat + edit tools, not embedded in the card.

If for some reason the renderer can't run (e.g. no Python), emit a minimal
self-contained HTML card yourself: a `<pre>` diff block, the context quoted
under labeled headings, and the concerns as a list. Keep it offline-safe (no
external CSS/JS).

**Terminal / no GUI** — skip HTML entirely. Present the same content as tight
markdown: the diff in a fenced block, each context block under a `**Label
(path:line)**` heading, and the concerns as a bulleted list. The per-mode action
options render exactly as the block shown above.

## Pacing rules

- One change per turn. Always wait.
- Walk **every** semantic change, not just the flagged ones. A change with no
  findings is still a turn: the reviewer is being walked through the diff, not
  through a defect list.
- Never re-litigate the bookkeeping summary — mention it once at the start.
- If the reviewer says "just show me everything" or "stop pausing", switch to
  presenting the remaining queue in one pass — but that's opt-in, not default.
