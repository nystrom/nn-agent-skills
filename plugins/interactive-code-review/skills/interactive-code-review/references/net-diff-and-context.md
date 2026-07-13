# Net diff, commits, and newcomer context

## Why the net diff, and how commits fit in

The reviewer should spend attention only on what the branch *actually changes*,
not on the churn of how it got there. Two facts drive the approach:

1. **`git diff origin/main...HEAD` (three dots) is already the net diff.** It
   compares against the merge-base, so a line added in commit 2 and removed in
   commit 5 does not appear. Reverted, superseded, and self-cancelling edits
   fall out automatically. Review this surface.
2. **Commit history is where the *intent* lives.** The net diff shows *what*
   survives but not *why*. `git log origin/main..HEAD` (two dots) plus commit
   messages tell you why each surviving change was made — which is exactly what
   a newcomer needs for the "why it exists" beat.

So: **read commits for the story, review the net diff for the substance.**

```bash
git fetch origin --quiet
git diff  origin/main...HEAD --stat        # net surface to review
git log   origin/main..HEAD --oneline      # story / intent, newest first
```

### Handling commits that undo earlier ones
- If a change is absent from the net diff, it was undone — **do not review it**,
  and don't mention the intermediate flip-flop unless the reviewer asks.
- If a commit message describes work you can't find in the net diff, that's the
  telltale of a later revert. Confirm with `git log -p -- <path>` if it matters,
  then move on; the net state is what ships.
- A change present in the net diff but touched by several commits: attribute the
  "why" to the commit that best explains the *final* form, not the first stab.
- `git log --follow -- <path>` helps when a file was renamed mid-branch.

## Gathering context for someone new to the code

The diff answers "what changed." A newcomer needs four more answers per change.
Gather them explicitly:

### Why it exists
Pull from the commit message / PR body first. If those are thin, infer from the
code and label it as inference ("appears to add retry handling for flaky S3
calls — not stated in the commit"). Never present a guess as fact.

### What uses it / who calls it
The single most valuable context. Find the callers and importers:

```bash
git grep -n "refresh_token"                # references across the tree
git grep -n "def refresh_token\|class TokenStore"   # the definition(s)
rg -n "refresh_token" --type py            # if ripgrep is available
```

Show the notable call sites (2–4 is usually enough), each with `path:line`. If a
signature changed, the review question is "did every caller get updated?" —
surface the call sites so the reviewer can judge.

### Who consumes the result
Trace the other side of whatever the change touches:
- Changed a return value → who uses it?
- Changed a writer / producer / emitter → show the reader / consumer / handler.
- Changed a schema field → show what reads that field.

### What's tested
Show the covering test, or state plainly that there isn't one — a missing test
for new behavior is itself a comment worth offering.

## Discipline
- Quote the minimum that makes the change reviewable: 5–15 focused lines per
  context block, never whole files.
- Every block gets a real `path:line` so the reviewer can open it.
- If a change spans files, add several small blocks rather than one giant dump.
- Widen a too-narrow diff with `git diff -U15 <scope> -- <file>` so it reads in
  context rather than as a floating hunk.
