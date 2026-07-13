# Review JSON schema

`scripts/render_review.py` consumes one JSON object. Build it, then render:

```bash
python3 scripts/render_review.py change-c1.json -o change-c1.html
```

## Shape

```jsonc
{
  "title": "string — headline for the review",
  "scope": "string — e.g. 'git diff main...HEAD  (12 files, +340 -88)'",
  "generated_at": "string, optional — script fills current time if omitted",

  "summary": {
    "files_changed": 12,          // optional int
    "additions": 340,             // optional int
    "deletions": 88,              // optional int
    "routine": [                  // one line per routine/skipped change
      "Removed unused import `os` from auth/session.py",
      "package-lock.json regenerated (not reviewed)"
    ]
  },

  "changes": [
    {
      "id": "c1",                 // short, stable, unique. Anchors use it.
      "file": "auth/token.py",    // path shown in the card header
      "title": "New refresh_token() coroutine",
      "kind": "logic",            // optional tag: logic|api|test|config|security|...
      "diff": "@@ -10,6 +10,12 @@ ...\n unified diff text for THIS change",
      "context": [                // optional; code the diff doesn't show
        {
          "label": "Caller: login()",
          "path": "auth/session.py:88",   // optional, shown next to label
          "lang": "python",                // optional, for highlighting
          "code": "async def login(user):\n    ...",
          "collapsed": false               // optional; true = start folded
        }
      ],
      "comments": [               // the review; [] renders "No issues found"
        {
          "severity": "high",     // blocker|high|medium|low|nit|question|praise
          "title": "Unbounded retry",       // optional short heading
          "body": "Explanation. Supports `code`, **bold**, and newlines.",
          "line": 13,             // optional: new-file line no. → click-to-jump
          "symbol": "refresh_token"  // optional alt anchor when no line applies
        }
      ]
    }
  ]
}
```

## Field notes

- **`diff`** must be a real unified diff (`@@ -a,b +c,d @@` hunk headers). The
  renderer numbers lines from the hunk header, so `line` anchors in comments
  resolve correctly. Include the surrounding context lines you want shown; use
  `git diff -U<n>` to widen.
- **`line`** refers to the *new-file* line number as it appears in the hunk —
  the number the renderer prints in the right-hand gutter. Deleted lines can't
  be anchored by `line`; use `symbol` or reference them in the body.
- **`comments`** are auto-sorted by severity (blocker → praise) in the output.
- Unknown `severity` values render with neutral styling, so a custom vocabulary
  from any review skill won't break anything.
- Everything except `title`, `scope`, and `changes` is optional.

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
        {"severity": "praise", "line": 20, "body": "Correct — avoids per-item rounding drift."}
      ]
    }
  ]
}
```
