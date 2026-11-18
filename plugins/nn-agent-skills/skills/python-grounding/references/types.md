# Python Type System Reference

Python's type system is **gradual**: unannotated code is treated as `Any` (dynamically typed), and type checkers only enforce what is annotated. This document covers annotation syntax and semantics for Python 3.9–3.13.

## What Requires Importing from `typing`

This is the most common source of `ImportError` in typed Python code. The rule is:

**Built-in types usable directly as annotations (no import, any version):**
`int`, `float`, `str`, `bool`, `bytes`, `None`, `list`, `dict`, `tuple`, `set`, `frozenset`, `type`

**Generic aliases available without import in Python 3.9+** (before 3.9, must import capitalized equivalents from `typing`):
`list[int]`, `dict[str, int]`, `tuple[int, ...]`, `set[str]`, `frozenset[str]`, `type[C]`

**Must always import from `typing`** — these are never built-ins at any version:

```python
from typing import (
    Any,          # compatible with all types; escapes type checking
    Union,        # Union[X, Y] — use X | Y in 3.10+
    Optional,     # Optional[X] == X | None — use X | None in 3.10+
    Callable,     # Callable[[ArgType, ...], ReturnType]
    TypeVar,      # declare a type variable
    Generic,      # base for generic classes
    Protocol,     # structural subtyping — 3.8+
    TypedDict,    # typed dictionary — 3.8+
    Literal,      # Literal["a", "b"] — 3.8+
    Final,        # Final[int] — 3.8+
    ClassVar,     # ClassVar[int] — 3.8+
    overload,     # multiple type signatures — always needed
    cast,         # cast(T, expr) — type checker only
    TYPE_CHECKING,# True only during type checking; guard import-time cycles
    get_type_hints,# resolve string annotations at runtime
    Annotated,    # Annotated[T, metadata] — 3.9+
    TypeGuard,    # user-defined narrowing — 3.10+
    ParamSpec,    # capture parameter types — 3.10+
    TypeAlias,    # explicit alias — 3.10+
    Never,        # return type of non-returning functions — 3.11+
    Self,         # refers to enclosing class — 3.11+
    TypeVarTuple, # variadic generics — 3.11+
    Unpack,       # used with TypeVarTuple — 3.11+
    assert_never, # runtime exhaustiveness check — 3.11+
    TypeIs,       # bidirectional narrowing — 3.13+
    ReadOnly,     # TypedDict read-only field — 3.13+
)
```

**Deprecated but still valid (avoid in new code targeting 3.9+):**

```python
from typing import List, Dict, Tuple, Set, FrozenSet, Type   # use built-ins instead
# List[int] → list[int] (3.9+)
# Dict[str, int] → dict[str, int] (3.9+)
# Optional[X] → X | None (3.10+)
# Union[X, Y] → X | Y (3.10+)
```

**`typing_extensions`** — backports new typing features to older Python versions:

```python
# Install: pip install typing_extensions
# Pattern for code that must run on multiple Python versions:
try:
    from typing import Self          # Python 3.11+
except ImportError:
    from typing_extensions import Self

# typing_extensions commonly backports:
# TypeAlias (3.10), ParamSpec (3.10), TypeGuard (3.10)
# Self (3.11), Never (3.11), assert_never (3.11)
# TypeVarTuple, Unpack (3.11), TypeIs (3.13), ReadOnly (3.13)
# Also: Protocol, TypedDict, Literal, Final (3.8 — backports to 3.6/3.7)
```

**`TYPE_CHECKING` guard for import-time cycles:**

```python
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mymodule import HeavyClass   # only imported during type checking

def f(x: HeavyClass) -> None:        # safe: annotation is a string at runtime
    ...
```

**`collections.abc` alternative for structural types (3.9+):**

```python
from collections.abc import (
    Callable,         # same semantics as typing.Callable
    Iterable, Iterator, Generator,
    Sequence, MutableSequence,
    Mapping, MutableMapping,
    Set, MutableSet,
    Awaitable, Coroutine, AsyncGenerator,
)
# These are preferred over typing.Callable etc. for 3.9+
```

---

## Annotation Syntax by Version

### Python 3.9 (PEP 585)

Built-in collection types can be used directly as generic aliases. The `typing` module equivalents still work but are deprecated for new code.

```python
# 3.9+: use built-in generics directly
def process(items: list[int]) -> dict[str, list[int]]:
    ...

# Older equivalent (still legal, prefer built-in)
from typing import List, Dict
def process(items: List[int]) -> Dict[str, List[int]]:
    ...
```

Full list of built-in generics (3.9+): `list`, `dict`, `tuple`, `set`, `frozenset`, `type`, `collections.deque`, `collections.defaultdict`, `collections.OrderedDict`, `collections.Counter`, `collections.ChainMap`.

### Python 3.10 (PEP 604)

Union types can be written with `|` instead of `Union[X, Y]`:

```python
# 3.10+
def f(x: int | str | None) -> int | None:
    ...

# Equivalent for all versions
from typing import Optional, Union
def f(x: Union[int, str, None]) -> Optional[int]:
    ...
```

**`Optional[X]` is exactly `X | None`.** Use `| None` in new code for 3.10+.

### Python 3.12 (PEP 695)

New `type` statement for type aliases; new generic syntax:

```python
# 3.12+: type alias
type Vector = list[float]

# 3.12+: generic function
def first[T](items: list[T]) -> T:
    return items[0]

# 3.12+: generic class
class Stack[T]:
    def push(self, item: T) -> None: ...
    def pop(self) -> T: ...
```

The old `TypeVar` approach still works for 3.9–3.11 compatibility.

### `from __future__ import annotations` (PEP 563)

Makes all annotations **strings** (deferred evaluation). Allows forward references without quoting. Does not affect runtime behavior of `__annotations__`.

```python
from __future__ import annotations

class Node:
    def next(self) -> Node:  # legal without quotes
        ...
```

**Warning:** libraries that inspect `__annotations__` at runtime (dataclasses, Pydantic, attrs) must use `typing.get_type_hints()` to resolve strings. If omitted, you get strings instead of types.

---

## `Any`

`Any` is compatible with every type in both directions. It is an escape hatch, not a type error suppressor.

```python
from typing import Any

def process(data: Any) -> Any:   # accepts and returns anything
    ...
```

**Rule:** `object` and `Any` are different. `object` is a real type (the base class); you cannot call arbitrary methods on `object`. `Any` bypasses all type checking.

---

## TypeVar

Used to express generic relationships between argument and return types.

```python
from typing import TypeVar

T = TypeVar("T")

def identity(x: T) -> T:
    return x

# Constrained TypeVar: T must be one of the listed types
AnyStr = TypeVar("AnyStr", str, bytes)

# Bounded TypeVar: T must be a subtype of the bound
Comparable = TypeVar("Comparable", bound="SupportsLessThan")
```

**Naming convention:** `T`, `S`, `KT`, `VT` for simple cases. The `TypeVar` name string must match the variable name.

**Python 3.12+:** use `def f[T](x: T) -> T:` instead.

---

## ParamSpec (Python 3.10+, PEP 612)

Captures the parameter signature of a callable for use in decorators:

```python
from typing import Callable, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")

def logged(func: Callable[P, R]) -> Callable[P, R]:
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        print(f"calling {func.__name__}")
        return func(*args, **kwargs)
    return wrapper
```

Without `ParamSpec`, the decorator's return type loses the wrapped function's parameter types.

---

## TypeVarTuple (Python 3.11+, PEP 646)

Variadic generics. Enables typing of `*args` with heterogeneous types:

```python
from typing import TypeVarTuple, Unpack

Ts = TypeVarTuple("Ts")

def zip_together(*iterables: Unpack[Ts]) -> tuple[Unpack[Ts]]:
    ...
```

Primarily used for NumPy-style shape typing and similar variadic APIs.

---

## Protocol (PEP 544, Python 3.8+)

Structural subtyping (duck typing with static verification). A class implements a Protocol if it has the required methods — no explicit inheritance needed.

```python
from typing import Protocol

class Drawable(Protocol):
    def draw(self) -> None: ...

class Circle:
    def draw(self) -> None:
        print("drawing circle")

def render(shape: Drawable) -> None:
    shape.draw()

render(Circle())  # type checks without Circle inheriting Drawable
```

Use `@runtime_checkable` to allow `isinstance(x, Protocol)` checks at runtime (only checks method names, not signatures).

---

## TypedDict (PEP 589)

Typed dictionaries with known keys:

```python
from typing import TypedDict, NotRequired, Required

class Movie(TypedDict):
    title: str
    year: int
    rating: NotRequired[float]  # optional key (Python 3.11+)

# Functional form (useful when keys are not valid identifiers)
Movie = TypedDict("Movie", {"title": str, "year": int})
```

**Rule:** `TypedDict` instances are plain `dict` at runtime. Type checkers enforce key presence and value types.

---

## dataclasses

`@dataclass` auto-generates `__init__`, `__repr__`, `__eq__`. Does not change runtime behavior beyond that.

```python
from dataclasses import dataclass, field

@dataclass
class Point:
    x: float
    y: float
    label: str = "origin"
    tags: list[str] = field(default_factory=list)  # mutable default must use field()

@dataclass(frozen=True)  # makes instances immutable (and hashable)
class FrozenPoint:
    x: float
    y: float
```

**`KW_ONLY` sentinel (Python 3.10+):** all fields after it are keyword-only:

```python
from dataclasses import dataclass, KW_ONLY

@dataclass
class Options:
    name: str
    _: KW_ONLY
    verbose: bool = False
    timeout: int = 30
```

---

## Overload (typing.overload)

Declares multiple type signatures for a single function:

```python
from typing import overload

@overload
def process(x: int) -> int: ...
@overload
def process(x: str) -> str: ...

def process(x: int | str) -> int | str:
    if isinstance(x, int):
        return x * 2
    return x.upper()
```

**Rule:** `@overload` stubs are type-checker-only. The actual implementation is the non-decorated version. All overloads must be followed by the implementation in the same file.

---

## Annotated (PEP 593, Python 3.9+)

Attaches metadata to a type without changing its type-checker meaning:

```python
from typing import Annotated

UserId = Annotated[int, "positive integer"]
```

Used by Pydantic, FastAPI, and similar frameworks to carry validation metadata while preserving the underlying type.

---

## Literal (PEP 586)

Restricts a type to specific literal values:

```python
from typing import Literal

def set_direction(d: Literal["N", "S", "E", "W"]) -> None:
    ...
```

---

## ClassVar and Final

```python
from typing import ClassVar, Final

class Config:
    MAX_RETRIES: ClassVar[int] = 3  # class variable, not instance variable
    VERSION: Final = "1.0"          # cannot be reassigned
```

---

## Type Narrowing

Type checkers narrow types inside conditionals:

```python
def f(x: int | str) -> None:
    if isinstance(x, int):
        x   # narrowed to int here
    else:
        x   # narrowed to str here
```

**`assert isinstance(x, T)`** also narrows, but only when `--strict` or similar is enabled — behavior varies by checker. Prefer explicit `isinstance` checks.

**`TypeGuard` (Python 3.10+, PEP 647):** annotate a function as a type guard:

```python
from typing import TypeGuard

def is_str_list(val: list[object]) -> TypeGuard[list[str]]:
    return all(isinstance(x, str) for x in val)
```

**`TypeIs` (Python 3.13+, PEP 742):** stricter alternative to `TypeGuard` with bidirectional narrowing.

---

## What a Type Checker Can and Cannot Do

### Can verify:
- Argument types at call sites
- Return type consistency
- Attribute access on typed objects
- Exhaustiveness in `match` / `if isinstance` chains with `assert_never`

### Cannot verify (without annotations):
- Runtime values
- Dynamic attribute setting (`setattr`, `__dict__` manipulation)
- Types from untyped third-party libraries (shows as `Any`)
- Types of variables annotated `Any`

---

## What an Agent May Safely Infer

- `Optional[X]` is always `X | None`.
- `list[int]` and `List[int]` are equivalent in type checkers; prefer `list[int]` for Python 3.9+.
- A class that implements all methods of a Protocol satisfies that Protocol.
- `@dataclass` fields with mutable defaults must use `field(default_factory=...)`.

## What an Agent Must Not Infer Without Evidence

- That unannotated code is type-safe — it is `Any` and bypasses checking.
- That `from __future__ import annotations` changes runtime behavior.
- That `@overload` stubs execute — only the implementation runs.
- The exact type of a variable after `setattr` or dictionary unpacking.

## What Requires Whole-Program Analysis

- Whether all subclasses of an abstract class implement all abstract methods.
- Whether a Protocol is satisfied by a class defined in another module.
- Exhaustiveness of `match` arms over a `Union` type.
