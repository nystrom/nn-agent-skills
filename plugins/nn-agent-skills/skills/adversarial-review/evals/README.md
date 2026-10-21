# adversarial-review evals

Real scientific-code PRs where AI reviewers approved defective changes, taken
from the October 2026 reviewer evaluation ("Can AI reviewers catch the bugs
that change scientific results?"). Use them to check that changes to
`SKILL.md` actually reduce harmful approvals.

- `cases.json` — the PRs, each with its defects, the mechanism a review must
  name to earn a catch, and a hint for the probe that exposes it.
- `score.py` — computes the report's three measures from graded results.

## Running

1. **Pin each case.** Set `head` to the PR's last commit before any later fix,
   and `base` to its merge base. The report used frozen heads; a PR's current
   state may already contain the fix. Unpinned cases are skipped.
2. **Fill missing mechanisms.** Four cases carry `"mechanism": null` because
   the report names only their category. Get the mechanism from the report's
   `evidence.json` before grading catches on those cases.
3. **Add controls.** The report used seven clean PRs that it does not name.
   Add `"kind": "control"` cases with `"defects": []` — merged PRs with no
   follow-up fix or revert. Without controls, a reviewer that blocks
   everything scores perfectly.
4. **Review.** For each case, run the skill standalone in a checkout of the
   repo at `head`, with the base named:
   `Review this change adversarially against <base>.` Give it a Julia runtime
   so it can run probes. Hide the PR discussion and later commits from it.
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
