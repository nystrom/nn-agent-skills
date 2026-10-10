---
name: risk-assessment
description: >-
  Risk-assessment code review of a change set. Judges blast radius, rollback
  safety, operability, security and privacy exposure, data/migration hazard,
  dependency and supply-chain risk, and release readiness — what can go wrong
  after merge, how bad, and how you would know. Use when asked to assess risk
  of a PR or branch, write a go/no-go risk review, or as a review lens under
  run-review-lenses.
---

# Risk Assessment

Assess the **shipping risk** of the change set: blast radius, failure modes
after merge, rollback and operability, and whether the change is ready to
leave the branch. This is not a style review and not a full adversarial
correctness hunt — it is the release/risk lens: what can hurt, how widely,
and whether you can see and undo it.

This is a **review lens**. It returns findings and never acts — no file
edits, no GitHub posts, no deploys. When another skill (typically
`run-review-lenses`) loaded you and asked for a structured finding list, obey
that wire format and stop there. When invoked on your own, review the change
set and report as below.

## Scope

- Prefer the net diff against `origin/main` (or the base the caller named).
- Include the working tree when the caller said to, or when pointed at local
  uncommitted work.
- Read enough of deploy/config/migration/test context to judge operability —
  flags, configs, schema diffs, CI, runbooks — when the change touches them.
- Weight any focus area (security, data, a named service), but still cover
  the other risk axes when the diff implicates them.

## Risk axes

Interrogate the change on each axis that applies. Skip an axis only when the
diff clearly cannot touch it, and say so.

1. **Blast radius** — which users, tenants, regions, or code paths are in
   play? Is the default on or off? Can it fan out (webhooks, jobs, fan-out
   writes)?
2. **Security & privacy** — authn/authz changes, new trust boundaries, PII
   movement, secrets handling, injection surfaces, overly broad permissions.
3. **Data & migration** — irreversible writes, backfills, schema expand/
   contract order, dual-write windows, consistency windows, restore paths.
4. **Rollback & forward-fix** — can you revert the binary without stranding
   data or clients? Are migrations backward-compatible? Feature-flagged?
5. **Operability & observability** — new failure modes logged/metric'd/
   traced? Alerts? Timeouts and load shedding? Partial-failure behavior
   under dependency loss?
6. **Dependencies & supply chain** — new packages, version bumps with known
   hazard, protocol changes, required infra that may not exist in every env.
7. **Release readiness** — tests that cover the risky paths (including
   failure), staged rollout plan implied or missing, config defaults safe
   for production.

## Method

1. Summarize what the change *enables* in production in one short paragraph.
2. For each applicable axis, look for a concrete hazard in the diff or its
   immediate callers/callees.
3. Score impact (who hurt, how bad, how long) and detectability (would we
   see it in logs/metrics/customer reports before it spreads?).
4. Prefer risks that are **novel to this change** over generic project risks
   that already existed and the diff does not worsen.

## Finding bar

A risk finding must state:

1. The hazard (what goes wrong after merge/deploy).
2. The blast radius (who/what is affected).
3. Detectability and rollback posture (how you would know; whether you can
   undo).
4. A concrete mitigation (flag, guard, migration order, test, alert, or
   code change).

Skip pure correctness bugs that have no shipping/ops dimension unless they
*are* the release risk (e.g. a migration that drops a column). Leave
deep "assume it's wrong" failure hunting to `adversarial-review` when both
run — overlap is fine if the shipping angle is distinct.

## Output

### When a caller requested structured findings

```
{ source, path, line, severity, title, body, suggested_fix }
```

- `source` — `risk-assessment`
- `path` — file path, or a central config/migration path for cross-cutting
  risk
- `line` — new-file line, or `null` for whole-change release risk
- `severity` — `blocker` (do not ship as-is) | `high` (ship only with
  explicit mitigation) | `medium` (material but bounded) | `low` (watch item)
- `title` — short heading
- `body` — hazard, blast radius, detectability/rollback, why this change
  introduces or worsens it
- `suggested_fix` — mitigation: code, flag default, migration order, test, or
  rollout control

Also return:

- a one-line headline: `needs-attention` or `approve`
- a short **risk summary** naming residual risks you accept if the findings
  were fixed (or `none` on approve)

### When invoked standalone

Compact markdown:

- verdict: `needs-attention` or `approve`
- risk summary (blast radius + residual risk)
- findings by severity with file/line, axis, hazard, mitigation
- optional go/no-go line tied to the blockers

## Final check

Each finding must be about shipping risk (not style), tied to this change,
honest about blast radius and rollback, and paired with a mitigation someone
can actually do before or at release.
