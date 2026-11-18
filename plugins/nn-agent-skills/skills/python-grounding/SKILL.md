---
name: python-grounding
description: >-
  Authoritative grounding in real Python (3.9–3.13) semantics for coding agents:
  scoping and closures, the type-hint system, the standard-library API surface,
  toolchain (ruff/mypy/pyright/pyrefly), what changed across versions, error
  taxonomy, packaging, and footguns. Read before reasoning about, explaining, or
  editing Python — it blocks analogical hallucination from other languages and
  version confusion. Pull the topic reference that matches the question.
---

# Python grounding

Ground yourself in what Python actually does — and in which version it does it —
before editing or explaining Python code. Syntax tells you if code is legal;
these references tell you if an edit is safe and whether a feature exists in the
target interpreter. Read the reference that matches your question:

| Question | Read |
|----------|------|
| What does this code actually do? (scoping/LEGB, closures, mutability, identity, generators, MRO, dunder protocol) | `references/semantics.md` |
| Type hints by version, `TypeVar`/`ParamSpec`, `Protocol`, `TypedDict`, overloads; `typing` vs `typing_extensions` | `references/types.md` |
| Standard-library function names and signatures; what does **not** exist | `references/stdlib.md` |
| ruff, black, mypy, pyright, pyrefly — config, diagnostics, common fixes | `references/toolchain.md` |
| What changed in 3.9, 3.10, 3.11, 3.12, 3.13; migration rules | `references/versions.md` |
| Why did this fail? (TypeError, AttributeError, ImportError, KeyError, async pitfalls) | `references/errors.md` |
| Footguns: mutable defaults, late binding, `is` vs `==`, class vs instance vars | `references/sharp-edges.md` |
| pip, uv, venv, pyproject.toml, requirements.txt, editable installs | `references/packages.md` |

## Grounding the Active Version

Whenever writing, editing, or explaining Python code, you **MUST** first determine the active Python version to reference the correct version-specific features and syntax (such as type hinting syntax and standard library APIs).

To detect the active Python version and environment:
1. Check `pyproject.toml` (look for `requires-python` under `[project]`), `poetry.lock`, or `.python-version`.
2. If still unresolved, run:
   ```bash
   python --version
   # or when using uv:
   uv run python --version
   ```

## What an agent must not infer

Do not assume Python behaves like JavaScript, Julia, C, or any language you were
trained on, and do not assume a feature exists in every version. Each reference
has a "What an agent may/must not infer" section — consult it rather than
pattern-matching across languages or Python versions.
