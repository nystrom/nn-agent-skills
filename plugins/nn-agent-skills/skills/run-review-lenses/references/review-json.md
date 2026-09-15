# `review.json` — the review contract

This skill's deliverable. Everything the review learned goes in this one file:
the queue of semantic changes, the context gathered for each, the merged lens
findings, and the whole-change verdict.

It is written to `<workdir>/review.json` and is the **only** thing a consumer
needs — a consumer reads this file and presents it. Nothing here mentions how it
is presented, and nothing here is specific to a walkthrough, a page, or a
terminal summary.

Consumers may **extend** it with fields of their own (`ui-code-review` adds
diagrams, tradeoffs, and alternate diff renderings). Extensions are additive: a
consumer never redefines a field below, and this skill never writes one it
doesn't own.

## Shape

```jsonc
{
  "title": "string — headline for the review",
  "scope": "string — e.g. 'git diff main...HEAD  (12 files, +340 -88)'",
  "base": "string — the ref the net diff was taken against, e.g. 'origin/main'",
  "generated_at": "string, optional — ISO 8601",

  "overview": {                   // the change as a whole (workflow step 6)
    "what": "2–4 sentences: the overall intent across all commits, synthesized
             from the commit walk — not a file-by-file list.",
    "scope_line": "One line: what is queued vs. what was skipped as bookkeeping.",
    "verdict": "A position: does the change, taken together, earn its place?
                Justification or critique. Do not hedge into a neutral recap."
  },

  "structural": [                 // findings owned by no single change
    {
      "severity": "medium",
      "source": "code-review",
      "title": "No tests for the new retry path",
      "body": "Cross-cutting concern: architectural direction, missing tests
               across the board, scope creep, a cleaner decomposition, whether
               it should be split."
    }
  ],

  "summary": {
    "files_changed": 12,          // optional int
    "additions": 340,             // optional int
    "deletions": 88,              // optional int
    "routine": [                  // one line per bookkeeping/skipped change
      "Removed unused import `os` from auth/session.py",
      "package-lock.json regenerated (not reviewed)"
    ]
  },

  "changes": [                    // the queue, in review order
    {
      "id": "c1",                 // short, stable, unique. Anchors use it.
      "file": "auth/token.py",    // primary path
      "title": "New refresh_token() coroutine",
      "kind": "logic",            // optional tag: logic|api|test|config|security|...
      "diff": "@@ -10,6 +10,12 @@ ...\n unified diff text for THIS change",

      "briefing": {               // the beats gathered in workflow step 4
        "what": "One sentence: what this change is.",
        "why": "Why it exists, from the commit message / PR intent.",
        "uses": "What uses it / who calls it — the highest-value beat.",
        "consumes": "Who consumes the result: the other side of the interface.",
        "tested": "The covering test, or an explicit note of its absence."
      },

      "context": [                // code the diff doesn't show
        {
          "label": "Caller: login()",
          "path": "auth/session.py:88",    // real path:line
          "lang": "python",                 // optional, for highlighting
          "code": "async def login(user):\n    ...",
          "collapsed": false                // optional; true = start folded
        }
      ],

      "comments": [               // merged lens findings; [] = nothing jumps out
        {
          "severity": "high",     // blocker|high|medium|low|nit|question|praise
          "source": "code-review",          // the lens that produced it
          "title": "Unbounded retry",       // optional short heading
          "body": "Explanation. Supports `code`, **bold**, and newlines.",
          "line": 13,             // optional: new-file line no.
          "symbol": "refresh_token",        // optional alt anchor
          "suggested_fix": "The smallest edit that resolves it."
        }
      ]
    }
  ]
}
```

## Field notes

- **`diff`** must be a real unified diff (`@@ -a,b +c,d @@` hunk headers), holding
  **only this change's hunks**. Line numbers derive from the hunk header, so
  `line` anchors resolve against it. Include the surrounding context lines that
  make it read in situ; use `git diff -U<n>` to widen.
- **`line`** is the *new-file* line number as it appears in the hunk. Deleted
  lines can't be anchored by `line`; use `symbol` or reference them in the body.
- **`source`** on every finding is the lens that produced it. It is provenance,
  and it never splits the list — the findings stay merged and ranked by severity.
- **`comments`** are ordered by severity (blocker → praise).
- A custom `severity` from some review lens is passed through as-is rather than
  coerced; consumers style unknown values neutrally.
- **`structural`** holds only what attaches to no single change. A finding that
  lands on a change belongs in that change's `comments`, not here.
- **`briefing`** keys are exactly `what`, `why`, `uses`, `consumes`, `tested`.
  `uses` is the beat most often skimped — a reviewer who has never seen the
  codebase needs it more than any other.
- **`structural`** carries `source` and `severity` so a consumer can rank and
  attribute it. A consumer that wants it as flat display text (the page's
  `overview.cross_cutting`) derives that from these entries rather than this skill
  writing the same content twice.
- Required: `title`, `scope`, `changes`. Everything else is optional, though
  `overview` and `briefing` should always be present in a real review.

## Minimal valid example

```json
{
  "title": "Fix rounding in invoice total",
  "scope": "git diff HEAD~1",
  "changes": [
    {
      "id": "c1",
      "file": "billing/invoice.py",
      "title": "Round after summing, not before",
      "diff": "@@ -20,3 +20,3 @@ def total(items):\n-    return sum(round(i.price) for i in items)\n+    return round(sum(i.price for i in items))",
      "comments": [
        {"severity": "praise", "source": "code-review", "line": 20, "body": "Correct — avoids per-item rounding drift."}
      ]
    }
  ]
}
```
