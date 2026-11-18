#!/usr/bin/env python3
"""
Language-grounding eval runner.

Measures how accurately Claude answers Python and Julia semantics questions,
with and without the grounding skills injected into the system prompt.

Usage:
    python evals/language-grounding/run.py                              # with skills, via claude CLI
    python evals/language-grounding/run.py --no-skills                  # baseline without skills
    python evals/language-grounding/run.py --compare                    # run both, show delta
    python evals/language-grounding/run.py --filter py.errors           # filter by ID prefix/substring
    python evals/language-grounding/run.py --filter jl.pkg
    python evals/language-grounding/run.py --model claude-haiku-4-5-20251001
    python evals/language-grounding/run.py --out results/my_run.json

    # Use Anthropic SDK directly (requires ANTHROPIC_API_KEY):
    python evals/language-grounding/run.py --sdk

Requirements:
    pip install pyyaml          # always needed
    pip install anthropic       # only for --sdk mode
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml not installed. Run: pip install pyyaml")
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────

EVAL_ROOT = Path(__file__).parent
REPO_ROOT = EVAL_ROOT.parent.parent
SKILLS_DIR = REPO_ROOT / "plugins" / "nn-agent-skills" / "skills"
CASE_DIRS = [
    EVAL_ROOT / "languages" / "python" / "evals",
    EVAL_ROOT / "languages" / "julia" / "evals",
    EVAL_ROOT / "languages" / "javascript" / "evals",
    EVAL_ROOT / "languages" / "typescript" / "evals",
    EVAL_ROOT / "cases",
]
RESULTS_DIR = EVAL_ROOT / "results"

DEFAULT_MODEL = "claude-haiku-4-5-20251001"

SYSTEM_BASE = (
    "You are a programming language expert. "
    "Answer questions about Python and Julia accurately and concisely."
)

# ── Skills loading ─────────────────────────────────────────────────────────

def load_all_skills() -> str:
    # Each language skill is a router SKILL.md plus references/*.md; inject both
    # so the grounding content (which lives in the references) reaches the model.
    parts = []
    for md_file in sorted(SKILLS_DIR.glob("*-grounding/**/*.md")):
        parts.append(md_file.read_text())
    if not parts:
        print(f"WARNING: No skill markdown found in {SKILLS_DIR}", file=sys.stderr)
    return "\n\n---\n\n".join(parts)


def build_system_prompt(with_skills: bool) -> str:
    if not with_skills:
        return SYSTEM_BASE
    skills_text = load_all_skills()
    return (
        f"{SYSTEM_BASE}\n\n"
        "You have access to the following language reference material:\n\n"
        f"{skills_text}"
    )


# ── Case loading ───────────────────────────────────────────────────────────

def load_cases(filter_str: str | None = None) -> list[dict]:
    cases: list[dict] = []
    for case_dir in CASE_DIRS:
        if not case_dir.exists():
            continue
        for yaml_file in sorted(case_dir.glob("*.yaml")):
            try:
                data = yaml.safe_load(yaml_file.read_text())
            except Exception as e:
                print(f"WARNING: Failed to parse {yaml_file}: {e}", file=sys.stderr)
                continue
            if not data or "cases" not in data:
                continue
            cases.extend(data["cases"])

    if filter_str:
        cases = [c for c in cases if filter_str in c.get("id", "")]

    return cases


# ── Prompt building ────────────────────────────────────────────────────────

def build_user_prompt(case: dict) -> str:
    parts = [case["prompt"].strip()]
    if "code" in case:
        parts.append(f"\n```\n{case['code'].rstrip()}\n```")
    if "choices" in case:
        parts.append("\nChoices:")
        for letter, choice in zip("ABCD", case["choices"]):
            parts.append(f"  {letter}) {choice}")
    return "\n".join(parts)


# ── Grading ────────────────────────────────────────────────────────────────

def token_match(haystack: str, needle: str) -> bool:
    """True if needle appears in haystack as a whole token.

    A word boundary is required only on the sides where needle itself ends in
    a word character, so "2.67" does not match inside "2.675" and "true" does
    not match inside "construe", while values like "<class 'int'>" (non-word
    edges) still match when surrounded by spaces. This removes lexical false
    passes; it cannot catch semantic ones (e.g. "not False" contains "false").
    """
    if not needle:
        return True
    pat = re.escape(needle)
    if re.match(r"\w", needle[0]):
        pat = r"(?<!\w)" + pat
    if re.search(r"\w\Z", needle):
        pat = pat + r"(?!\w)"
    return re.search(pat, haystack) is not None


def grade(case: dict, response: str) -> tuple[bool, str]:
    """Returns (passed, reason)."""
    r = response.lower()

    if "expected_output" in case:
        expected = case["expected_output"].lower()
        # Multi-line outputs: each line must appear somewhere in the response
        lines = [ln.strip() for ln in expected.split("\n") if ln.strip()]
        if not lines:
            lines = [expected]
        missing = [ln for ln in lines if not token_match(r, ln)]
        if not missing:
            return True, f"contains expected: {case['expected_output']!r}"
        return False, (
            f"missing: {missing!r}; "
            f"wrong_reason: {case.get('wrong_output_reason', '')[:120]}"
        )

    if "expected_behavior" in case:
        eb = case["expected_behavior"]
        for phrase in eb.get("must_not_say", []):
            if token_match(r, phrase.lower()):
                return False, f"said forbidden phrase: {phrase!r}"
        candidates = eb.get("must_say_one_of", [])
        if candidates:
            for phrase in candidates:
                if token_match(r, phrase.lower()):
                    return True, f"said required phrase: {phrase!r}"
            return False, f"none of must_say_one_of found; expected one of: {candidates}"
        return True, "no must_say_one_of required"

    return True, "no grading criteria defined"


# ── Backends ───────────────────────────────────────────────────────────────

def call_via_cli(prompt: str, system: str, model: str, retries: int = 3) -> str:
    """
    Run a prompt through the `claude` CLI (uses existing auth, no API key needed).

    Uses --system-prompt-file to avoid OS arg-length limits on large skill prompts.
    Retries with exponential backoff on rate-limit errors.
    """
    # Write system prompt to a temp file to avoid CLI arg size limits
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", prefix="eval_sys_", delete=False
    ) as tf:
        tf.write(system)
        sys_file = tf.name

    try:
        cmd = [
            "claude", "-p", prompt,
            "--model", model,
            "--system-prompt-file", sys_file,
        ]
        for attempt in range(retries):
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                stdin=subprocess.DEVNULL,
                timeout=120,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
            # Retry on rate limits or transient errors
            wait = 10 * (2 ** attempt)  # 10s, 20s, 40s
            if attempt < retries - 1:
                time.sleep(wait)

        # Final attempt failed
        detail = result.stderr[:200] if result.stderr else f"rc={result.returncode}, empty output"
        raise RuntimeError(f"claude CLI error: {detail}")
    finally:
        Path(sys_file).unlink(missing_ok=True)


def call_via_sdk(prompt: str, system: str, model: str) -> str:
    """Run a prompt through the Anthropic SDK (requires ANTHROPIC_API_KEY)."""
    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic package not installed. Run: pip install anthropic")
        sys.exit(1)

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=model,
        max_tokens=512,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


# ── Case runner ────────────────────────────────────────────────────────────

def run_case(
    case: dict,
    system: str,
    model: str,
    use_sdk: bool,
) -> dict:
    prompt = build_user_prompt(case)
    start = time.monotonic()
    try:
        caller = call_via_sdk if use_sdk else call_via_cli
        text = caller(prompt, system, model)
        elapsed = time.monotonic() - start
        passed, reason = grade(case, text)
        return {
            "id": case["id"],
            "skill": case.get("skill", ""),
            "topic": case.get("topic", ""),
            "passed": passed,
            "reason": reason,
            "response_excerpt": text[:400],
            "elapsed_s": round(elapsed, 2),
        }
    except Exception as e:
        return {
            "id": case["id"],
            "skill": case.get("skill", ""),
            "topic": case.get("topic", ""),
            "passed": False,
            "reason": f"error: {e}",
            "response_excerpt": "",
            "elapsed_s": round(time.monotonic() - start, 2),
        }


def run_all(
    cases: list[dict],
    system: str,
    model: str,
    label: str,
    use_sdk: bool,
    verbose: bool = False,
) -> list[dict]:
    results: list[dict] = []
    n = len(cases)
    passed_count = 0

    print(f"\n{'='*60}")
    print(f"  Condition : {label}")
    print(f"  Model     : {model}")
    print(f"  Backend   : {'SDK (ANTHROPIC_API_KEY)' if use_sdk else 'claude CLI'}")
    print(f"  Cases     : {n}")
    print(f"{'='*60}")

    for i, case in enumerate(cases, 1):
        r = run_case(case, system, model, use_sdk)
        results.append(r)
        passed_count += r["passed"]
        status = "PASS" if r["passed"] else "FAIL"
        print(f"  [{i:3d}/{n}] {status}  {r['id']}")
        if not r["passed"] or verbose:
            print(f"            → {r['reason']}")
        if i < n:
            time.sleep(1.5)   # stay well under CLI rate limits

    pct = 100 * passed_count / n if n else 0
    print(f"\n  Result: {passed_count}/{n} passed ({pct:.1f}%)")
    return results


# ── Saving & comparison ────────────────────────────────────────────────────

def save_results(results: list[dict], label: str, model: str, out_path: Path | None) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = label.replace(" ", "_").lower()
    path = out_path or (RESULTS_DIR / f"{timestamp}_{slug}.json")

    n = len(results)
    passed = sum(1 for r in results if r["passed"])
    payload = {
        "timestamp": timestamp,
        "label": label,
        "model": model,
        "passed": passed,
        "total": n,
        "pass_rate": round(passed / n, 4) if n else 0,
        "results": results,
    }
    path.write_text(json.dumps(payload, indent=2))
    print(f"  Saved → {path}")
    return path


def print_comparison(with_results: list[dict], without_results: list[dict]) -> None:
    by_id_with    = {r["id"]: r for r in with_results}
    by_id_without = {r["id"]: r for r in without_results}
    ids = sorted(set(by_id_with) | set(by_id_without))

    gained: list[str] = []
    lost:   list[str] = []
    both_fail: list[str] = []

    for cid in ids:
        w  = by_id_with.get(cid)
        wo = by_id_without.get(cid)
        if w is None or wo is None:
            continue
        if w["passed"] and not wo["passed"]:
            gained.append(cid)
        elif not w["passed"] and wo["passed"]:
            lost.append(cid)
        elif not w["passed"] and not wo["passed"]:
            both_fail.append(cid)

    total = len(ids)
    with_pass    = sum(1 for r in with_results    if r["passed"])
    without_pass = sum(1 for r in without_results if r["passed"])
    delta = with_pass - without_pass
    sign  = "+" if delta >= 0 else ""

    print(f"\n{'='*60}")
    print("  COMPARISON: with skills vs without skills")
    print(f"{'='*60}")
    print(f"  Without skills : {without_pass}/{total} ({100*without_pass/total:.1f}%)")
    print(f"  With skills    : {with_pass}/{total} ({100*with_pass/total:.1f}%)")
    print(f"  Delta          : {sign}{delta} cases ({sign}{100*delta/total:.1f}%)")

    if gained:
        print(f"\n  GAINED ({len(gained)} — skills helped):")
        for cid in gained:
            print(f"    + {cid}")

    if lost:
        print(f"\n  LOST ({len(lost)} — skills hurt):")
        for cid in lost:
            print(f"    - {cid}")

    if both_fail:
        print(f"\n  STILL FAILING ({len(both_fail)} — skills did not fix):")
        for cid in both_fail:
            print(f"    ? {cid}")
            print(f"        {by_id_with[cid]['reason']}")

    print()


# ── CLI ────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Language-grounding eval runner")
    parser.add_argument("--no-skills", action="store_true",
                        help="Run without skill content (baseline)")
    parser.add_argument("--compare",   action="store_true",
                        help="Run both conditions and compare")
    parser.add_argument("--filter",    metavar="STR",
                        help="Filter cases by ID substring (e.g. 'py.errors', 'jl.')")
    parser.add_argument("--model",     default=DEFAULT_MODEL,
                        help=f"Model to use (default: {DEFAULT_MODEL})")
    parser.add_argument("--sdk",       action="store_true",
                        help="Use Anthropic SDK instead of claude CLI (requires ANTHROPIC_API_KEY)")
    parser.add_argument("--out",       metavar="PATH",
                        help="Output JSON path (default: evals/results/<timestamp>.json)")
    parser.add_argument("--verbose",   action="store_true",
                        help="Print reason for every case, not just failures")
    args = parser.parse_args()

    if args.sdk and not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: --sdk requires ANTHROPIC_API_KEY to be set.")
        sys.exit(1)

    cases = load_cases(args.filter)
    if not cases:
        print(f"ERROR: No cases found (filter={args.filter!r}).")
        sys.exit(1)

    print(f"Loaded {len(cases)} cases.")
    out_path = Path(args.out) if args.out else None

    if args.compare:
        system_with    = build_system_prompt(with_skills=True)
        system_without = build_system_prompt(with_skills=False)
        with_results    = run_all(cases, system_with,    args.model, "with skills",    args.sdk, args.verbose)
        without_results = run_all(cases, system_without, args.model, "without skills", args.sdk, args.verbose)
        save_results(with_results,    "with_skills",    args.model, None)
        save_results(without_results, "without_skills", args.model, None)
        print_comparison(with_results, without_results)

    elif args.no_skills:
        system  = build_system_prompt(with_skills=False)
        results = run_all(cases, system, args.model, "without skills", args.sdk, args.verbose)
        save_results(results, "without_skills", args.model, out_path)

    else:
        system  = build_system_prompt(with_skills=True)
        results = run_all(cases, system, args.model, "with skills", args.sdk, args.verbose)
        save_results(results, "with_skills", args.model, out_path)


if __name__ == "__main__":
    main()
