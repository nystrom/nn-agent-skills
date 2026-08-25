# Diagrams, old-way/new-way, and tradeoffs

Three page elements that explain a change the diff cannot: a **diagram** pair for
structure, a **usage** pair for how the code is called, and a **tradeoffs** block
for what the change buys and what it costs.

All three are optional per change, and all three are declarative — you write a
spec, `scripts/render_app.py` draws it. Never hand-author SVG or HTML into a
state field.

## When to draw a diagram

A diagram earns its place only when a picture says something the diff does not.
Draw one when:

- **control or data flow moved between components** — a step now happens
  somewhere else, an extra hop appeared, a direct call became a queue;
- **a responsibility moved** — who owns retries, who validates, who caches;
- **a new layer, boundary, or component appeared** or one was collapsed away;
- **the change is a decomposition** — one module split into three, or three
  merged into one.

Do **not** draw one for: a single-file logic fix, a rename, a bug fix inside one
function, added tests, a config edit, or anything where the diff already reads
clearly on its own. A box-and-arrow picture of a two-function refactor is noise,
and every diagram costs space the findings need. When in doubt, leave it out and
say the same thing in the briefing.

Where it goes:

- the change *as a whole* restructures something → **`overview.diagrams`**, the
  before/after architecture pair at the top of the page;
- one queue item restructures something local → **`changes[].diagrams`**, drawn
  above that change's diff.

## The diagram spec

```jsonc
{
  "title": "Where retries live",
  "caption": "Optional one-liner under the title.",
  "note": "Optional line under the panels.",
  "before": {                       // optional: omit for a single-panel diagram
    "label": "Before",
    "nodes": [
      {"id": "os", "label": "OrderService", "sub": "own retry loop",
       "layer": 0, "state": "removed"}
    ],
    "edges": [{"from": "os", "to": "t", "label": "send x3", "state": "removed"}]
  },
  "after": { "label": "After", "nodes": [], "edges": [] }
}
```

- `layer` is an integer column index. Layout is strictly **left to right**: one
  column per layer, nodes stacked in array order, columns centered vertically.
- **Edges run forward only** (`from` in a lower layer than `to`). To show a
  callback or a return path, reverse it and label it (`"returns"`), or give the
  return its own node in a later layer. A backward or same-layer edge draws a
  path that overlaps the boxes; the renderer does not route around them.
- `state` on a node or edge is `same` (default), `added`, `removed`, or
  `changed`, and tints it green / dashed red / amber. Use `removed` in the
  *before* panel for what the change deletes, `added` in the *after* panel for
  what it introduces.
- Keep a panel to roughly 8 nodes and 3 layers. Beyond that, draw the one
  relationship that matters instead of the whole system.
- `label` wraps to 3 lines, `sub` to 2. Both are plain text — no markdown, no
  code fences. `title`, `caption`, and `note` take inline markdown.
- An edge naming a `from`/`to` that no node declares is dropped silently, so
  check the ids.

## The usage pair — the old way vs. the new way

For a changed **call signature, protocol, or abstraction boundary**, show the
call site both ways. This is the element to reach for when the diff shows the
*definition* but the reader's real question is "what do I write now?".

```jsonc
"usage": [
  {
    "title": "Calling the transport",
    "note": "Optional line under the two columns.",
    "before": {"label": "The old way", "path": "orders/service.py:41",
               "code": "for i in range(self.max_retries):\n    ..."},
    "after":  {"label": "The new way", "path": "orders/service.py:41",
               "code": "resp = await self.transport.send(req)"}
  }
]
```

Both sides are real code, quoted from the repo where it exists — the old side
from the base revision, the new side from the branch (or, for an API nobody has
adopted yet, the shortest honest example, said to be one). Keep each side under
about 12 lines. One `usage` entry per changed entry point; more than two or three
on one change means the change should be several.

Do not use `usage` as a second diff. If the answer is "the same call, one
argument different", the diff already showed it.

## Tradeoffs — advantages, disadvantages, risks

`overview.tradeoffs` is **required**: every review states what the change buys and
what it costs. `changes[].tradeoffs` is optional, for a change with its own
distinct bargain.

```jsonc
"tradeoffs": {
  "advantages":    ["One retry policy instead of five subtly different loops."],
  "disadvantages": ["The policy is process-wide, so a caller cannot opt out."],
  "risks":         ["A rolling deploy has old callers retrying too, doubling load."]
}
```

The three lists are different questions; do not print one twice:

- **Advantages** — what the change makes better, stated concretely. "Cleaner" is
  not an advantage; "one place to change the backoff" is.
- **Disadvantages** — costs the change accepts **knowingly and permanently**: an
  extra indirection, a wider interface, a lost per-call escape hatch, more code
  to read. These do not go away once the change ships.
- **Risks** — what **might** go wrong, on rollout or later: version skew during
  deploy, an untested path, a migration that cannot be reversed, a limit the new
  shape will hit under load. Each risk should name the trigger, not just the
  fear.

Two to four entries per list. If a list is genuinely empty, omit it rather than
padding it — but an empty `disadvantages` on a real restructuring means you have
not looked hard enough. Risks that need action are also findings; keep them in
both places, short here and argued on the change.
