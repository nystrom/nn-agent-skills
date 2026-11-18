# Python Error Taxonomy

This skill maps Python exception messages to root causes and fixes. For each error type, it also lists what an agent commonly guesses wrong.

---

## `TypeError`

**Message pattern:** `TypeError: unsupported operand type(s) for +: 'int' and 'str'`

**Root cause:** An operation was applied to values of the wrong type.

**Common triggers and fixes:**

```python
# Arithmetic on incompatible types
1 + "2"          # TypeError — coerce first: int("2") or str(1) + "2"

# Calling a non-callable
x = 42
x()              # TypeError: 'int' object is not callable

# Wrong number of arguments
def f(a, b): ...
f(1)             # TypeError: f() missing 1 required positional argument: 'b'

# None where a value is expected
result = None
result + 1       # TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'
# Root cause: the function that produced `result` returned None, not a number

# Iteration on a non-iterable
for x in 42:     # TypeError: 'int' object is not iterable
    ...
```

**Agent trap:** `'NoneType' object is not subscriptable` and `'NoneType' object is not iterable` are **TypeErrors** — they mean a variable is `None` when something else was expected. The fix is upstream: find what returned `None` instead of the expected value.

---

## `AttributeError`

**Message pattern:** `AttributeError: 'list' object has no attribute 'add'`

**Root cause:** Accessing a method or attribute that does not exist on that type.

**Common hallucinated names and their correct equivalents:**

| Wrong | Correct | Type |
|-------|---------|------|
| `list.add(x)` | `list.append(x)` | list |
| `list.remove_at(i)` | `del list[i]` or `list.pop(i)` | list |
| `dict.get_default(k, v)` | `dict.get(k, v)` | dict |
| `str.split_lines()` | `str.splitlines()` | str |
| `str.upcase()` / `str.to_upper()` | `str.upper()` | str |
| `str.downcase()` / `str.to_lower()` | `str.lower()` | str |
| `str.trim()` | `str.strip()` | str |
| `str.contains(s)` | `s in str` | str |
| `set.add_all(iterable)` | `set.update(iterable)` | set |
| `object.to_string()` | `str(object)` | any |

**Agent trap:** Always look up the actual method name rather than guessing from other languages. Python method names are lowercase with underscores, not camelCase.

---

## `NameError` and `UnboundLocalError`

**NameError message:** `NameError: name 'x' is not defined`
**UnboundLocalError message:** `UnboundLocalError: local variable 'x' referenced before assignment`

**Root causes:**

```python
# NameError: variable simply doesn't exist in scope
print(undefined_var)   # NameError

# UnboundLocalError: variable assigned somewhere in function, but used before assignment
x = 10

def f():
    print(x)   # UnboundLocalError — x is treated as local because of the assignment below
    x = 20     # Python sees this assignment and makes x local for the whole function
```

**Why UnboundLocalError is confusing:** If a function *ever* assigns to a variable name, Python treats that name as **local to the entire function**. A reference before the assignment raises `UnboundLocalError` even though a global with that name exists.

**Fix:** Use `global x` or `nonlocal x` to reference an outer variable, or restructure to avoid the early reference.

---

## `ImportError` and `ModuleNotFoundError`

**Message patterns:**
- `ModuleNotFoundError: No module named 'requests'`
- `ImportError: cannot import name 'TypeAlias' from 'typing'`
- `ImportError: attempted relative import with no known parent package`

**Root causes and fixes:**

```python
# Module not installed
import requests   # ModuleNotFoundError if requests not installed
# Fix: pip install requests

# Name doesn't exist in that module (version mismatch, typo, or hallucinated name)
from typing import TypeAlias   # ImportError on Python < 3.10
# Fix: from typing_extensions import TypeAlias  (for older Python)

# Circular import
# a.py imports b.py which imports a.py
# Fix: restructure to remove the cycle, or use local imports

# Relative import outside a package
from . import utils   # ImportError if running the file directly, not as part of a package
# Fix: run as `python -m package.module` not `python module.py`
```

**Agent trap:** Before using `from typing import X`, verify `X` exists in the target Python version. Many typing constructs were added in 3.8, 3.9, 3.10, 3.11, or 3.13. Use `typing_extensions` for backporting. See `python/types` skill for the version-by-version breakdown.

---

## `KeyError`

**Message pattern:** `KeyError: 'username'`

**Root cause:** Accessing a dictionary key that does not exist.

```python
d = {"name": "Alice"}
d["username"]        # KeyError: 'username'

# Safe alternatives:
d.get("username")            # returns None if missing
d.get("username", "guest")   # returns default if missing
"username" in d              # check existence

# defaultdict — auto-creates missing keys
from collections import defaultdict
d = defaultdict(list)
d["new_key"].append(1)  # no KeyError; creates empty list automatically
```

**Agent trap:** `dict["key"]` raises `KeyError` if the key is absent. `dict.get("key")` returns `None`. These are not interchangeable — use `get()` when absence is expected, `[]` when absence is a bug.

---

## `IndexError`

**Message pattern:** `IndexError: list index out of range`

**Root cause:** Accessing a sequence index that is out of bounds.

```python
xs = [1, 2, 3]
xs[3]    # IndexError — valid indices are 0, 1, 2
xs[-4]   # IndexError — valid negative indices are -1, -2, -3

# Safe access:
xs[i] if 0 <= i < len(xs) else default
```

**Agent trap:** Python lists are 0-indexed. The last element is `xs[-1]` or `xs[len(xs)-1]`. `xs[len(xs)]` is always out of bounds.

---

## `ValueError`

**Message pattern:** `ValueError: invalid literal for int() with base 10: 'abc'`

**Root cause:** A function received a value of the right type but an invalid value.

```python
int("abc")          # ValueError — not a valid integer string
float("not a num")  # ValueError
int("3.14")         # ValueError — use float("3.14") first, or int(float("3.14"))

[1, 2, 3].index(99)  # ValueError: 99 is not in list
[1, 2, 3].remove(99) # ValueError: list.remove(x): x not in list

import math
math.sqrt(-1)        # ValueError: math domain error (use cmath.sqrt for complex)
```

---

## `ZeroDivisionError`

**Message pattern:** `ZeroDivisionError: division by zero`

```python
1 / 0       # ZeroDivisionError
1 // 0      # ZeroDivisionError
1 % 0       # ZeroDivisionError

# Note: float division by zero gives inf, not an exception, in NumPy arrays
import numpy as np
np.float64(1.0) / np.float64(0.0)  # inf (with RuntimeWarning), not an exception
```

---

## `StopIteration` leaking from generators

**Message pattern:** `StopIteration` propagates out of a function decorated with `@asyncio.coroutine` or similar.

**Root cause (PEP 479, Python 3.7+):** If `StopIteration` is raised *inside* a generator function (including one called from a generator), it converts to `RuntimeError: generator raised StopIteration`.

```python
def inner():
    raise StopIteration   # intent: stop iteration

def gen():
    inner()               # RuntimeError in 3.7+

# Fix: raise the correct exception type or return
def gen():
    return  # implicit StopIteration at the generator boundary — correct
```

---

## `RecursionError`

**Message pattern:** `RecursionError: maximum recursion depth exceeded`

**Root cause:** Infinite recursion or recursion too deep for Python's stack.

Default limit: 1000 frames. Change with `sys.setrecursionlimit(n)` (rarely the right fix — usually the recursion is unbounded).

---

## `RuntimeWarning: coroutine was never awaited`

**Message:** `RuntimeWarning: coroutine 'f' was never awaited`

**Root cause:** An `async def` function was called without `await`.

```python
async def fetch(url): ...

result = fetch(url)   # Wrong: returns a coroutine object, does not run it
result = await fetch(url)  # Correct (inside async context)

# To run from sync context:
import asyncio
result = asyncio.run(fetch(url))
```

**Agent trap:** `async def` functions return coroutines, not values. Forgetting `await` is the single most common async mistake. The `RuntimeWarning` appears only if the coroutine is garbage-collected without being awaited — some code paths may silently do nothing without any warning.

---

## `SyntaxError` and `IndentationError`

**SyntaxError:** invalid Python syntax — unterminated strings, missing colons, invalid expressions.

**IndentationError:** inconsistent indentation. Most common cause: mixing tabs and spaces.

```
IndentationError: unexpected indent
IndentationError: unindent does not match any outer indentation level
TabError: inconsistent use of tabs and spaces in indentation
```

**Fix:** Configure your editor to always use spaces (PEP 8 recommendation). Never mix tabs and spaces in the same file. Run `python -tt file.py` to detect tab/space mixing.

---

## `OSError` / `FileNotFoundError` / `PermissionError`

These are all subclasses of `OSError`:

```python
open("missing.txt")        # FileNotFoundError (subclass of OSError)
open("/root/secret", "w")  # PermissionError (subclass of OSError)
```

**Hierarchy:**
```
OSError
├── FileNotFoundError  (errno 2)
├── PermissionError    (errno 13)
├── FileExistsError    (errno 17)
├── IsADirectoryError  (errno 21)
├── TimeoutError       (errno 110)
└── ConnectionError
    ├── BrokenPipeError
    ├── ConnectionAbortedError
    ├── ConnectionRefusedError
    └── ConnectionResetError
```

Catch the specific subclass when you intend to handle a specific condition; catch `OSError` to handle any filesystem/IO error.

---

## `NotImplementedError` vs `NotImplemented`

**`NotImplementedError`** (exception): raised by abstract methods to signal that a subclass must implement them.

**`NotImplemented`** (singleton, not an exception): returned by binary operator methods (`__add__`, etc.) to tell Python to try the reflected operation. It is **not** raised.

```python
class Base:
    def process(self):
        raise NotImplementedError("subclasses must implement process()")

class MyNum:
    def __add__(self, other):
        if not isinstance(other, MyNum):
            return NotImplemented   # not raise — return!
        return MyNum(self.value + other.value)
```

**Agent trap:** Returning `NotImplemented` instead of raising `NotImplementedError`, or raising `NotImplemented` (which silently becomes a truthy non-error value in some contexts), are both bugs.

---

## `AssertionError`

Raised when an `assert` statement fails. Assertions are stripped when Python runs with `-O` (optimize). **Never use assert for input validation in production code** — use explicit `if`/`raise` instead.

---

## What an Agent May Safely Infer

- `'NoneType' object is not ...` means a variable is `None`; look for what returned `None` upstream.
- `UnboundLocalError` means Python detected an assignment to that name somewhere in the function; use `global`/`nonlocal` or restructure.
- `ModuleNotFoundError` on a standard library module (e.g., `requests`, `numpy`) means it is not installed, not that the name is wrong.
- `RuntimeWarning: coroutine was never awaited` always means a missing `await`.

## What an Agent Must Not Infer Without Evidence

- That catching `Exception` covers `KeyboardInterrupt` or `SystemExit` — those inherit from `BaseException`, not `Exception`.
- That `list.add()` exists — it does not; the method is `append()`.
- That a `ValueError` from `int()` means the string is empty — it means the string is non-numeric; empty string also raises `ValueError`.
- That `StopIteration` inside a generator is safe in Python 3.7+ — it becomes `RuntimeError`.
