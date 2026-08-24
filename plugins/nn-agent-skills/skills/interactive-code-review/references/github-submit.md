# Submitting comments to GitHub

The reviewer picks one of the three options; you post it. Prefer posting a
**line-anchored review comment** on the PR so it lands exactly where the change
is. Degrade gracefully when that isn't possible.

## Preflight (once per session)
Establish whether real posting is available and to which PR:

```bash
gh auth status                                  # is gh authed?
gh pr view --json number,url,headRefName,baseRefName   # is there a PR for this branch?
```

Cache the PR number and the head commit SHA:

```bash
HEAD_SHA=$(git rev-parse HEAD)
```

If there's no `gh`, no auth, or no PR, use the **copy-paste fallback** below —
do not fail the session.

## Posting an inline (line-anchored) comment
Best when the concern is about a specific line. Uses the PR reviews API with the
new-file line and side:

```bash
gh api \
  --method POST \
  repos/{owner}/{repo}/pulls/{number}/comments \
  -f body="$COMMENT_BODY" \
  -f commit_id="$HEAD_SHA" \
  -f path="auth/token.py" \
  -F line=12 \
  -f side="RIGHT"
```

`gh api` fills `{owner}/{repo}` from the current remote. `line` is the new-file
line number (the same anchor used in the HTML card); use `side=RIGHT` for
added/changed lines, `side=LEFT` for a deleted line. The response includes an
`html_url` — surface it in your one-line confirmation.

## Posting a file-level or general comment
When the concern isn't tied to one line (design-level, or the change is a
deletion), post a top-level PR comment instead:

```bash
gh pr comment {number} --body "$COMMENT_BODY"
```

## Optional: an overall verdict at the end
If the reviewer wants to conclude with a verdict rather than scattered comments:

```bash
gh pr review {number} --comment        --body "..."   # neutral
gh pr review {number} --approve        --body "..."
gh pr review {number} --request-changes --body "..."
```

Only do this when they ask for it in the wrap-up step — never auto-approve.

## Copy-paste fallback (no gh / no PR / posting declined)
Still deliver the value: present the chosen comment as ready-to-paste text with
its location, so the reviewer can drop it into the GitHub UI.

```
Comment for auth/token.py:12  (paste into the PR)
────────────────────────────────────────
<full comment body>
```

If a message-composing tool is available, offer the comment through it so the
reviewer can copy it in one tap. Otherwise a fenced block is fine.

## Comment body conventions
- Keep it to what you'd actually leave on a PR: the concern, why it matters, and
  a concrete suggestion. GitHub renders Markdown, so use backticks and
  ```suggestion blocks where a direct fix helps.
- Match the chosen angle: option 1 states the required change, option 2 asks a
  real question, option 3 is a light nit or genuine praise.
- Don't sign as the reviewer or fabricate certainty; if it's a guess, phrase it
  as one.
