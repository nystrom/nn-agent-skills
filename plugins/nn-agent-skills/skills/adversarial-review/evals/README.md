# adversarial-review evals

Frozen real PRs with known defects, plus clean controls, for checking that
changes to `SKILL.md` actually reduce harmful approvals. The format and scorer
are project-neutral; add cases from any codebase. The seed cases come from a
published reviewer evaluation in which AI reviewers approved these defective
changes.

- `cases.json` — the PRs, each pinned to a frozen `head` and its `base`, with
  its defects: the mechanism a review must name to earn a catch, a hint for
  the probe that exposes it, `fixed_by` (the commit that later fixed it), and
  `source` (`report` if taken from a published evaluation, `fix-commit` if
  read from the fix). Controls have `"kind": "control"` and no defects.
- `score.py` — computes the three measures below from graded results.

## Running

The seed cases are already pinned, diagnosed, and paired with controls;
steps 1–3 apply when adding cases.

1. **Pin each case.** Set `head` to the PR's last commit before any later fix,
   and `base` to its merge base. A PR's current state may already contain
   the fix. Give each review a checkout holding only history up to `head`,
   so later fixes are not visible. Unpinned cases are skipped.
2. **Fill missing mechanisms.** A case whose defect has `"mechanism": null`
   is known to be defective but not yet diagnosed. Establish the mechanism
   (for example from the later fix) before grading catches on it.
3. **Add controls.** Add `"kind": "control"` cases with `"defects": []` —
   merged PRs with no follow-up fix or revert. Without controls, a reviewer that blocks
   everything scores perfectly.
4. **Review.** For each case, run the skill standalone in a checkout of the
   repo at `head`, with the base named:
   `Review this change adversarially against <base>.` Give it the project's
   language runtime and dependencies so it can run probes. Hide the PR
   discussion and later commits from it.
5. **Grade.** For each review, record the verdict and list the defect ids
   whose mechanism a blocking finding names. Blocking alone, or naming only
   the symptom, is not a catch.
6. **Score:** `python3 score.py cases.json results.json`

## Measures

- **Harmful approval** — `approve` on a defect case, divided by all graded
  reviews. The number to drive to zero.
- **Defects caught** — credited defects over defects encountered. Guards
  against a reviewer that blocks for the wrong reason.
- **Verdict correct** — block on defect cases, approve on controls. Guards
  against a reviewer that blocks everything.

The set is small and from one ecosystem, so treat a change in score as a
signal to look at the reviews, not as proof.
