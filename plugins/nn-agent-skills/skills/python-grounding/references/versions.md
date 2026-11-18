# Python Version Differences: 3.9–3.13

This skill covers what *changed* between Python 3.9 and 3.13 — syntax additions, semantic changes, standard library changes, and what was removed. Use it when you need to verify whether a construct is valid for a given target version, or when migrating code.

---

## Python 3.9

Released October 2020. Minimum supported version for many active projects.

### PEP 585: Built-in Generic Types

```python
# 3.9+
x: list[int] = []
y: dict[str, int] = {}
z: tuple[int, ...] = ()
t: type[MyClass]

# No longer needed (but still legal):
from typing import List, Dict, Tuple, Type
```

Full list of newly generic built-ins: `list`, `dict`, `tuple`, `set`, `frozenset`, `type`, `collections.deque`, `collections.defaultdict`, `collections.OrderedDict`, `collections.Counter`, `collections.ChainMap`, `collections.abc.*`, `contextlib.AbstractContextManager`, `contextlib.AbstractAsyncContextManager`, `re.Pattern`, `re.Match`.

### PEP 617: New PEG Parser

Python 3.9 replaced the old LL(1) parser with a PEG parser. Visible effect: better error messages. No syntax changes. The new parser enables future syntax additions.

### PEP 584: `|` Operator for `dict`

```python
a = {"x": 1}
b = {"y": 2}
c = a | b           # merge: {"x": 1, "y": 2}
a |= b              # update in place
```

### String Methods: `str.removeprefix` / `str.removesuffix`

```python
"TestHook".removeprefix("Test")  # "Hook"
"TestHook".removesuffix("Hook")  # "Test"
# Returns the original string unchanged if prefix/suffix not found
```

### Deprecations

- `typing.List`, `typing.Dict`, etc. deprecated in favor of built-in generics.

---

## Python 3.10

Released October 2021.

### PEP 634: Structural Pattern Matching (`match` / `case`)

```python
match command:
    case "quit":
        quit()
    case "go" | "walk":
        move()
    case {"action": action, "direction": direction}:  # mapping pattern
        handle(action, direction)
    case Point(x=0, y=y):       # class pattern
        print(f"y={y}")
    case [first, *rest]:        # sequence pattern
        handle_list(first, rest)
    case _:                     # wildcard
        unknown()
```

**Semantics:**
- Patterns are matched top to bottom; first match wins.
- `case _` is the catch-all; it never binds a name.
- Capture patterns (bare names) bind the matched value: `case x:` captures to `x`.
- Guard: `case Point(x=x) if x > 0:` — the guard is evaluated only if the pattern matches.
- **No fall-through** — unlike C switch statements.

### PEP 604: Union Types with `|`

```python
def f(x: int | str | None) -> int | None: ...
```

Also works in `isinstance` and `issubclass`:

```python
isinstance(x, int | str)   # 3.10+
```

### PEP 612: ParamSpec

```python
from typing import ParamSpec, Callable, TypeVar

P = ParamSpec("P")
R = TypeVar("R")

def decorator(f: Callable[P, R]) -> Callable[P, R]:
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return f(*args, **kwargs)
    return wrapper
```

### PEP 647: TypeGuard

```python
from typing import TypeGuard

def is_str_list(val: list[object]) -> TypeGuard[list[str]]:
    return all(isinstance(x, str) for x in val)
```

### Better Error Messages

3.10 introduced significantly improved `SyntaxError` and `AttributeError` messages including suggestions for nearby names.

### `zip` with `strict=True`

```python
for a, b in zip(list1, list2, strict=True):   # raises ValueError if lengths differ
    ...
```

---

## Python 3.11

Released October 2022.

### PEP 654: Exception Groups and `except*`

```python
try:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(coro1())
        tg.create_task(coro2())
except* ValueError as eg:       # catches ValueError subgroup
    for exc in eg.exceptions:
        handle(exc)
```

`ExceptionGroup(message, [exc1, exc2])` — holds multiple exceptions. `except*` always produces an `ExceptionGroup` in `eg.exceptions`, never a bare exception.

### PEP 680: `tomllib` in stdlib

```python
import tomllib

with open("pyproject.toml", "rb") as f:
    data = tomllib.load(f)
```

Read-only TOML parsing. For writing TOML, use a third-party library.

### PEP 673: `Self` Type

```python
from typing import Self

class Builder:
    def set_name(self, name: str) -> Self:
        self._name = name
        return self
```

Replaces the pattern `TypeVar("T", bound="Builder")` for builder/fluent APIs.

### PEP 675: `LiteralString`

```python
from typing import LiteralString

def execute_query(sql: LiteralString) -> None:
    ...   # safe: only literal strings accepted, not dynamic f-strings
```

Prevents SQL injection in type-safe code.

### Fine-Grained Error Locations

Python 3.11 error tracebacks show the exact column where an error occurred, not just the line.

### Performance

CPython 3.11 is approximately 25% faster than 3.10 due to the "faster CPython" project (adaptive specialization, frame optimization).

### `asyncio.TaskGroup` (PEP 654 adjacent)

```python
async with asyncio.TaskGroup() as tg:
    task1 = tg.create_task(coro1())
    task2 = tg.create_task(coro2())
# All tasks are awaited here; exceptions from any task are raised as ExceptionGroup
```

---

## Python 3.12

Released October 2023.

### PEP 695: New Generic Syntax and `type` Statement

```python
# Type alias
type Vector = list[float]
type Matrix[T] = list[list[T]]

# Generic function (no TypeVar import needed)
def first[T](items: list[T]) -> T:
    return items[0]

# Generic class
class Stack[T]:
    def __init__(self) -> None:
        self._items: list[T] = []
    def push(self, item: T) -> None:
        self._items.append(item)
    def pop(self) -> T:
        return self._items.pop()
```

The old `TypeVar` approach still works; the new syntax is 3.12+ only.

### PEP 698: `@override`

```python
from typing import override

class Base:
    def method(self) -> None: ...

class Sub(Base):
    @override
    def method(self) -> None:   # type checker errors if Base.method doesn't exist
        ...
```

Catches typos in method names when overriding.

### PEP 701: f-string improvements

f-strings can now contain:
- The same quote character as the outer string
- Multi-line expressions
- Backslashes in expressions
- Nested f-strings

```python
f"{'hello'}"              # 3.12+: reuse quote type
f"{"\n".join(items)}"     # backslash in expression
```

### `@dataclass` with `__slots__` via `slots=True`

Available since 3.10 but widely used in 3.12:

```python
@dataclass(slots=True)
class Point:
    x: float
    y: float
```

### Removed / Changed

- `distutils` removed (use `setuptools`)
- `asynchat`, `asyncore`, `imghdr`, `mailcap`, `ossaudiodev`, `sndhdr`, `sunau` modules removed

---

## Python 3.13

Released October 2024.

### PEP 719 / PEP 703: Free-Threaded Mode (No GIL)

An experimental build option (`--disable-gil` at compile time, or `python3.13t`) removes the Global Interpreter Lock:

```python
import sys
print(sys._is_gil_enabled())   # False in free-threaded build
```

**Important:** free-threaded builds are experimental. Many C extensions and threading assumptions may break. Not for production use without careful testing.

### PEP 742: `TypeIs` (Stricter TypeGuard)

```python
from typing import TypeIs

def is_int(x: object) -> TypeIs[int]:
    return isinstance(x, int)
```

Unlike `TypeGuard`, `TypeIs` narrows both the `True` and `False` branches, and the narrowed type must be a subtype of the input type.

### Improved Interactive Interpreter (REPL)

- Multi-line editing in the REPL
- Color output and syntax highlighting
- Paste mode

### `locals()` Behavior Clarified (PEP 667)

`locals()` in CPython now returns a snapshot; it is not a live view of local variables. Modifying the returned dict does not affect actual locals. This was always the intended behavior; 3.13 formalizes it.

### Deprecations / Removals

- `aifc`, `audioop`, `cgi`, `cgitb`, `chunk`, `crypt`, `imghdr`, `mailcap`, `msilib`, `nis`, `nntplib`, `ossaudiodev`, `pipes`, `sndhdr`, `spwd`, `sunau`, `telnetlib`, `uu`, `xdrlib` modules removed.
- `typing.no_type_check_decorator` removed.
- `complex.__int__` removed; use `int(x.real)` instead.

---

## Migration Rules

### 3.8 → 3.9

- Replace `from typing import List, Dict, Tuple, Set, FrozenSet, Type` with built-in generics.
- Use `str.removeprefix` / `str.removesuffix` instead of `lstrip`/`rstrip` for prefix/suffix removal.
- Use `dict1 | dict2` instead of `{**dict1, **dict2}`.

### 3.9 → 3.10

- Replace `Union[X, Y]` with `X | Y`.
- Replace `Optional[X]` with `X | None`.
- `isinstance(x, (A, B))` can become `isinstance(x, A | B)`.

### 3.10 → 3.11

- Replace `TypeVar("T", bound="MyClass")` fluent patterns with `Self`.
- `asyncio.gather` with `return_exceptions=False` can often be replaced with `asyncio.TaskGroup`.

### 3.11 → 3.12

- Replace `TypeAlias` + `=` with `type Name = ...`.
- Replace `TypeVar("T")` generic patterns with `def f[T](...)`.
- Add `@override` to overriding methods for safety.

### 3.12 → 3.13

- Audit for removed stdlib modules (see above).
- Do not enable free-threaded mode in production without thorough testing.

---

## Target Version Matrix

| Feature | 3.9 | 3.10 | 3.11 | 3.12 | 3.13 |
|---------|-----|------|------|------|------|
| `list[int]` generics | ✓ | ✓ | ✓ | ✓ | ✓ |
| `X \| Y` union type | — | ✓ | ✓ | ✓ | ✓ |
| `match`/`case` | — | ✓ | ✓ | ✓ | ✓ |
| `ExceptionGroup` / `except*` | — | — | ✓ | ✓ | ✓ |
| `Self` type | — | — | ✓ | ✓ | ✓ |
| `type` alias syntax | — | — | — | ✓ | ✓ |
| `def f[T](...)` generics | — | — | — | ✓ | ✓ |
| `@override` | — | — | — | ✓ | ✓ |
| `TypeIs` | — | — | — | — | ✓ |
| Free-threaded (experimental) | — | — | — | — | ✓ |

---

## What an Agent May Safely Infer

- Code using `list[int]` requires Python 3.9+.
- Code using `X | Y` in annotations requires Python 3.10+ (or `from __future__ import annotations` for type checkers).
- Code using `match` requires Python 3.10+.
- Code using `type X = ...` requires Python 3.12+.

## What an Agent Must Not Infer Without Evidence

- That `X | Y` works in `isinstance()` before Python 3.10 — it does not.
- That `from __future__ import annotations` makes `X | Y` valid at runtime before 3.10 — it only defers evaluation, but `isinstance(x, int | str)` will still fail.
- That free-threaded Python 3.13 is safe for general use.

## What Requires Whole-Program Analysis

- Whether a codebase's minimum supported Python version can be safely raised.
- Whether all uses of deprecated stdlib modules have been replaced.
