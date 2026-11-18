# Python Toolchain Reference

This skill covers the behavior and diagnostics of the five major Python static analysis tools: **ruff**, **black**, **mypy**, **pyright**, and **pyrefly**. All are relevant for Python 3.9–3.13.

---

## ruff

ruff is a fast linter and formatter written in Rust. It replaces flake8, isort, pyupgrade, and many other tools.

### Configuration

`pyproject.toml` (preferred) or `ruff.toml`:

```toml
[tool.ruff]
target-version = "py39"        # minimum Python version
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "W", "I", "UP", "B", "SIM"]
ignore = ["E501"]              # line too long (let formatter handle)
unfixable = ["F841"]           # don't auto-remove unused variables

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
```

### Key Rule Sets

| Prefix | Source | What it checks |
|--------|--------|----------------|
| `E` / `W` | pycodestyle | PEP 8 style |
| `F` | pyflakes | unused imports, undefined names |
| `I` | isort | import order |
| `UP` | pyupgrade | modernize syntax for target version |
| `B` | flake8-bugbear | common bugs and design issues |
| `SIM` | flake8-simplify | simplifiable expressions |
| `ANN` | flake8-annotations | missing type annotations |
| `S` | flake8-bandit | security issues |
| `PT` | flake8-pytest-style | pytest style |
| `RUF` | ruff-native | ruff-specific rules |

### Common Diagnostics and Fixes

**F401 — unused import:**
```python
# Bad
import os
import sys   # F401: unused

# Fix: remove unused import, or add to __all__, or use noqa
```

**F811 — redefinition of unused name:**
```python
# Bad
def process(): ...
def process(): ...   # F811

# Fix: rename or remove the duplicate
```

**UP006 — use `list` instead of `List` (Python 3.9+):**
```python
# Bad
from typing import List
def f(x: List[int]) -> List[str]: ...

# Fix
def f(x: list[int]) -> list[str]: ...
```

**UP007 — use `X | Y` instead of `Optional`/`Union` (Python 3.10+):**
```python
# Bad
from typing import Optional
def f(x: Optional[int]) -> None: ...

# Fix (3.10+)
def f(x: int | None) -> None: ...
```

**B006 — mutable default argument:**
```python
# Bad
def f(items: list = []):   # B006: same list reused across calls

# Fix
def f(items: list | None = None):
    if items is None:
        items = []
```

**B007 — loop variable not used in loop body:**
```python
# Bad
for i in range(10):   # B007: i not used
    do_something()

# Fix
for _ in range(10):
    do_something()
```

**SIM108 — use ternary instead of if/else block:**
```python
# Bad
if condition:
    x = a
else:
    x = b

# Fix
x = a if condition else b
```

### Suppression

```python
x = 1  # noqa: F841        — suppress specific rule
x = 1  # noqa               — suppress all rules on this line
```

File-level: add `# ruff: noqa: F401` at the top.

### `ruff format` vs `black`

`ruff format` is intentionally black-compatible. The two should produce identical output in most cases. Running both is redundant; pick one.

---

## black

black is an opinionated formatter. It has very few configuration options by design.

### Configuration

```toml
[tool.black]
line-length = 88
target-version = ["py39", "py310", "py311", "py312", "py313"]
```

### Formatting Rules (non-obvious)

**Magic trailing comma:** a trailing comma in a collection forces it to be exploded (one item per line), even if it fits on one line.

```python
# This stays exploded because of the trailing comma
x = [
    1,
    2,
    3,
]

# This collapses to one line
x = [1, 2, 3]
```

**String normalization:** black converts single-quoted strings to double-quoted. Disable with `skip-string-normalization = true`.

**`# fmt: off` / `# fmt: on`:** disables formatting for a region.

```python
# fmt: off
matrix = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
]
# fmt: on
```

**`# fmt: skip`:** skip formatting for a single line.

---

## mypy

mypy is the original Python type checker. It is strict and configurable.

### Configuration

```toml
[tool.mypy]
python_version = "3.11"
strict = true              # enables all strict checks
ignore_missing_imports = true
```

### Strict mode enables:

`--disallow-untyped-defs`, `--disallow-any-generics`, `--warn-return-any`, `--warn-unused-ignores`, `--disallow-untyped-calls`, among others.

### Common Error Codes and Fixes

**`[no-untyped-def]`** — function lacks type annotations:
```python
# Bad
def add(a, b):   # error: [no-untyped-def]
    return a + b

# Fix
def add(a: int, b: int) -> int:
    return a + b
```

**`[attr-defined]`** — attribute does not exist:
```python
class Dog:
    name: str

d = Dog()
d.bark()   # error: [attr-defined] "Dog" has no attribute "bark"
```

**`[return-value]`** — return type mismatch:
```python
def f() -> int:
    return "hello"   # error: [return-value]
```

**`[assignment]`** — incompatible assignment:
```python
x: int = "hello"   # error: [assignment]
```

**`[override]`** — incompatible method override:
```python
class Base:
    def f(self, x: int) -> int: ...

class Sub(Base):
    def f(self, x: str) -> str: ...  # error: [override]
```

**`[type-arg]`** — generic without type argument (strict mode):
```python
x: list = []      # error: [type-arg] Missing type parameters for generic type "list"
x: list[int] = [] # fix
```

**`[misc]`** — catch-all; often from missing stubs or incompatible plugin behavior.

### Suppression

```python
x = f()  # type: ignore[attr-defined]
x = f()  # type: ignore  # suppress all errors on this line
```

### Stubs and `py.typed`

mypy uses stub files (`.pyi`) for type information. Third-party stubs live in `typeshed` or `types-*` packages (e.g., `types-requests`). If a library ships `py.typed` (PEP 561), mypy uses its inline annotations.

---

## pyright

pyright is Microsoft's type checker, also the engine behind Pylance (VS Code). It is faster than mypy and has tighter inference in many cases.

### Configuration

`pyrightconfig.json` (or `pyproject.toml`):

```json
{
  "pythonVersion": "3.11",
  "typeCheckingMode": "strict",
  "reportMissingImports": true,
  "reportMissingTypeStubs": false
}
```

```toml
[tool.pyright]
pythonVersion = "3.11"
typeCheckingMode = "strict"
```

### Type Checking Modes

| Mode | Behavior |
|------|----------|
| `off` | no type checking |
| `basic` | moderate — recommended default |
| `standard` | stricter; enables more checks |
| `strict` | all checks enabled |

### Common Diagnostics and Fixes

**`reportAttributeAccessIssue`** — attribute not found:
```python
"hello".upcase()   # error: Cannot access attribute "upcase" for class "str"
```

**`reportReturnType`** — function may not return a value:
```python
def f(x: int) -> int:
    if x > 0:
        return x
    # error: Function with declared type "int" must return value
```

**`reportOperatorIssue`** — unsupported operand types:
```python
"a" + 1   # error: Operator "+" not supported for types "str" and "int"
```

**`reportPossiblyUnbound`** — variable may not be assigned:
```python
def f(condition: bool) -> int:
    if condition:
        x = 1
    return x   # error: possibly unbound
```

**`reportUnknownVariableType`** (strict mode) — type inferred as `Unknown`:
```python
import untyped_lib
x = untyped_lib.func()   # x is Unknown
```

### Suppression

```python
x = f()  # type: ignore[reportAttributeAccessIssue]
x = f()  # pyright: ignore[reportAttributeAccessIssue]
```

### pyright vs mypy Differences

- pyright is generally faster and has stricter inference
- mypy has more plugins (e.g., sqlalchemy-stubs, django-stubs)
- pyright handles `TypedDict` narrowing better in many cases
- mypy is more conservative about `Any` propagation in some patterns
- They occasionally disagree; if they conflict, check the spec (pyright is often more correct)

---

## pyrefly

pyrefly is Meta's type checker for Python, designed for large-scale codebases. As of 2025, it is newer and less widely deployed than mypy or pyright.

### Configuration

```toml
[tool.pyrefly]
python_version = "3.11"
```

### Key Properties

- Designed for incremental checking in large repos
- Aims for compatibility with mypy/pyright annotation syntax
- Error output format similar to other tools: `file:line:col: error: message [code]`

### Compared to mypy/pyright

- pyrefly prioritizes speed and scalability
- In cases of disagreement with mypy or pyright, prefer pyright as the reference for correctness (it tracks the typing spec most closely)
- pyrefly is the least mature of the three; its behavior on edge cases is still stabilizing

---

## Tool Overlap and Selection

| Task | Recommended tool |
|------|-----------------|
| Auto-format | `ruff format` or `black` (pick one) |
| Lint (style + bugs) | `ruff` |
| Import sorting | `ruff` (rule `I`) |
| Modernize syntax | `ruff` (rule `UP`) |
| Type checking | `pyright` (default) or `mypy` (plugin ecosystem) |
| Large-scale monorepo type checking | `pyrefly` |

**Do not run both `black` and `ruff format`** — they are redundant and may conflict on configuration.

---

## What an Agent May Safely Infer

- ruff `F401` means an import is unused and can be removed (unless the import has side effects).
- ruff `B006` means the default argument is mutable and will be shared across calls.
- mypy `[no-untyped-def]` is suppressed in non-strict mode by default.
- `# type: ignore` and `# noqa` are local suppressions; they do not affect other lines.

## What an Agent Must Not Infer Without Evidence

- That a `# type: ignore` suppresses the same error in both mypy and pyright — the error codes differ.
- That fixing a ruff rule always preserves semantics — some autofixes change behavior (e.g., UP007 requires Python 3.10+).
- That a file passing pyright also passes mypy, or vice versa.

## What Requires Whole-Program Analysis

- Whether removing an unused import breaks a re-export that another module depends on.
- Whether a `type: ignore` is masking a real type error that would surface after refactoring.
- Whether pyright's `reportPossiblyUnbound` is a false positive due to control flow that pyright cannot track.
