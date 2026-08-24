# Applying fixes (fix mode)

Fix mode's counterpart to `github-submit.md`. The reviewer picked a fix; you make
the edit **locally** and verify it. Fix mode mutates files — that is the whole
new risk surface, so the discipline here matters more than anywhere else in the
skill: one change at a time, show it, verify it, never advance on a broken tree.

## Proposing the fix (before they choose)

Each finding from the review fan-out should already carry a concrete fix.
Present it so the reviewer can judge it without reading the whole file:

- **Preview the edit** — a tight before/after or a ````suggestion`-style block
  showing exactly what changes. Keep it to the lines that move.
- **Prefer the smallest change** that resolves the finding. Don't fold unrelated
  cleanups into it.
- **For a refactor or new abstraction, state the target shape first** (the new
  function's signature, the type you're extracting) so they can veto the
  *direction* before you touch anything. These are the fixes most likely to go
  sideways.
- **Offer a genuinely different approach only when one exists** — don't
  manufacture an "option 2" that's a cosmetic variant of option 1.

## Applying the edit

On the reviewer's choice (`1`/`2`/`e`):

- Make the edit with the edit tools. **One change per turn**, matching the
  session's pacing — do not batch fixes for later changes.
- If the fix spans files (a signature change, a rename, a moved symbol), apply
  **all** the sites in that one logical fix — a half-applied signature change
  leaves the tree broken. You already gathered the call sites in the context
  step; use them.
- Re-read the file region shortly before editing if it may have shifted, so the
  edit lands in the right place.
- Preserve the surrounding style — indentation, naming, comment density. A fix
  that reads as foreign is a worse fix.

## Verifying — required, every time

Your standing rule is "review your work; don't declare done until you've run the
check." A fix is not applied until it's verified. In rough order of preference,
do the **cheapest check that actually exercises the change**:

- **Type/compile check** on the touched scope — `cargo check`, `tsc --noEmit`,
  `go build ./...`, `python -c 'import m'`, etc. For Rust, this is non-negotiable
  before advancing.
- **Run the covering test** you found in the context step (or the file's test
  module), not the whole suite.
- **If neither is cheap**, at minimum **re-read the affected function** in full
  and confirm the edit is internally consistent — no half-renamed variable, no
  now-unreachable branch, no caller left on the old signature.

State what you ran and the result in the one-line confirmation. If verification
**fails**, do not advance: report the failure, fix it or offer to revert, and
stay on this change until the tree is clean again.

## Safety and boundaries

- **Edits are uncommitted.** Leave them staged as working-tree changes so the
  reviewer can inspect, amend, or `git checkout -- <file>` to revert. Do not
  `git add`/`commit`/`push` unless the reviewer explicitly asks — the global
  rule stands.
- **Never advance on a broken tree.** A failed build/test blocks the next change.
- **Don't widen scope.** Fix the finding at hand; note adjacent problems as their
  own queue items rather than sneaking them into this edit.
- **If a fix turns out larger than a quick edit** (a real refactor touching many
  files), say so and let the reviewer decide whether to do it now, defer it, or
  drop it — don't silently embark on a sprawling change mid-session.
