# Language-grounding evals

Regression cases that measure how accurately Claude answers language-semantics
questions with and without the `*-grounding` skills in
`plugins/nn-agent-skills/skills/`. The runner calls the Anthropic API and is not
part of `make test`.

## Run

```bash
cd evals/language-grounding
uv run --with anthropic --with pyyaml python run.py --compare
```

`ANTHROPIC_API_KEY` must be set. Other modes:

```bash
uv run --with anthropic --with pyyaml python run.py                 # with skills
uv run --with anthropic --with pyyaml python run.py --no-skills     # baseline
uv run --with anthropic --with pyyaml python run.py --compare --filter py.errors
uv run --with anthropic --with pyyaml python run.py --compare --model claude-sonnet-5-5
```

The runner injects every `*-grounding` skill's `SKILL.md` and `references/*.md`
as the system prompt. Results are written as JSON to `results/` (gitignored).

## Cases

| Directory | Coverage |
|-----------|----------|
| `languages/python/evals/` | semantics, versions, sharp edges, abstention |
| `languages/julia/evals/` | semantics, versions, sharp edges, abstention |
| `languages/javascript/evals/` | semantics, sharp edges |
| `cases/` | errors, stdlib, packages (Python and Julia) |

Rust, C++, and TypeScript have no cases. The runner already lists
`languages/typescript/evals/`; the directory does not exist yet.

To add a case, add a YAML file to `cases/`:

```yaml
cases:
  - id: py.myskill.my_case          # unique, dot-separated
    skill: python-semantics         # display label
    topic: relevant_topic
    prompt: >
      Question text.
    code: |
      # optional code shown to the model
    # Output-prediction case:
    choices: ["Option A", "Option B"]
    expected_output: "Option A"
    wrong_output_reason: >
      Why an agent without grounding picks the wrong answer.
    # Behavior-assertion case (instead of choices):
    expected_behavior:
      must_not_say: ["forbidden phrase"]
      must_say_one_of: ["required phrase"]
```

## Last recorded result

`claude-haiku-4-5-20251001`, 2026-07-11, before the move into this repo. A usage
cap truncated both runs, and empty responses count as failures. The comparison
below uses only the 163 cases where both conditions returned an answer.

| Condition | Passed | Rate |
|-----------|-------:|-----:|
| With grounding skills | 116 / 163 | 71.2% |
| Without skills | 104 / 163 | 63.8% |

15 cases were fixed and 3 regressed. The gain is concentrated in version and
sharp-edge topics (`julia/versions` +15 points, `python-sharp-edges` +14). The
three regressions are `py.float.int_float_mixed_exact_compare`,
`jl.111.filter_named_tuple`, and `jl.112.waitany_requires_112`. The run gave no
fair baseline for the JavaScript, errors, stdlib, and packages cases.
