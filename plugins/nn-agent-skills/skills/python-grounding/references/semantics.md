# Python Semantics Reference

Use this skill when you need to reason about what Python code *does*, not just what it *looks like*. Syntax tells you if code is legal; this tells you if an edit is safe.

## Scoping: LEGB Rule

Python name lookup follows exactly this order — no exceptions:

1. **L**ocal — names assigned in the current function body
2. **E**nclosing — names in any enclosing `def` or `lambda`, inner to outer
3. **G**lobal — names assigned at module top level, or declared `global`
4. **B**uilt-in — Python built-ins (`len`, `print`, `None`, etc.)

```python
x = "global"

def outer():
    x = "enclosing"
    def inner():
        print(x)  # "enclosing" — not "global"
    inner()

outer()
```

### `global` and `nonlocal`

- `global x` — makes `x` refer to the module-level name for the whole function
- `nonlocal x` — makes `x` refer to the nearest enclosing scope (not global)
- Assignment without declaration creates a *new local*, it does not modify the enclosing scope

```python
count = 0

def increment():
    global count   # without this, assignment creates a new local and raises UnboundLocalError
    count += 1
```

**Edge case:** Reading a name before assigning it in the same function raises `UnboundLocalError`, not `NameError`, even if the global exists:

```python
x = 1
def f():
    print(x)  # UnboundLocalError: x referenced before assignment
    x = 2
```

Python sees the assignment and marks `x` as local for the whole function body.

**Common misconception:** `global` is not needed to *read* a global; only to *assign* to one.

---

## Late Binding in Closures

Closures capture variables by *reference*, not by value. The value is looked up at call time.

```python
# Bug: all lambdas return 9
funcs = [lambda: i for i in range(10)]
funcs[0]()  # 9, not 0

# Fix: capture by default argument (creates a new local binding)
funcs = [lambda i=i: i for i in range(10)]
funcs[0]()  # 0
```

This applies to any function defined inside a loop that references the loop variable.

---

## Mutability and Identity

### Mutable vs Immutable Built-ins

| Immutable | Mutable |
|-----------|---------|
| `int`, `float`, `complex`, `bool` | `list`, `dict`, `set` |
| `str`, `bytes`, `frozenset` | `bytearray` |
| `tuple` (but elements may be mutable) | user-defined classes (by default) |

**Consequence:** passing a `list` to a function and mutating it modifies the caller's list. Passing an `int` does not.

### Identity (`is`) vs Equality (`==`)

- `==` calls `__eq__`; two distinct objects can be equal
- `is` tests object identity (same memory address)

```python
a = [1, 2, 3]
b = [1, 2, 3]
a == b   # True
a is b   # False — different objects

# Only use `is` for singletons:
x is None    # correct
x is True    # correct (but `if x:` is more idiomatic)
x is False   # correct
```

**Common misconception:** `is` does not test equality. For strings and small integers, CPython interns values so `is` may accidentally return `True` — this is an implementation detail, not language behavior. Never rely on it.

### Tuple Mutability Trap

```python
t = ([1, 2], [3, 4])
t[0].append(99)   # legal — the tuple is immutable, the list inside is not
t[0] = [1, 2, 99] # TypeError — tuple is immutable
```

---

## Evaluation Order

Python evaluates expressions **left to right** in almost all contexts:

```python
a, b = b, a   # right side evaluated first as a tuple, then unpacked left to right
f(a(), b())   # a() evaluated before b()
d[k1], d[k2] = v1, v2  # v1, v2 evaluated first; then k1 store, then k2 store
```

**Exception:** augmented assignment (`x += expr`) evaluates `x` first (for compound types, this calls `__iadd__`), then `expr`.

**Walrus operator (`:=`, Python 3.8+):** assignment expression returns the assigned value and can appear inside conditions. Scope is the enclosing function or module, not just the expression.

```python
while chunk := f.read(8192):
    process(chunk)
```

---

## Exception Semantics

### Exception Hierarchy

`BaseException` is the root. `Exception` is the base for most user-catchable errors. `SystemExit`, `KeyboardInterrupt`, and `GeneratorExit` inherit from `BaseException` directly.

**Rule:** bare `except:` catches everything including `SystemExit`. Prefer `except Exception:` unless you explicitly want to catch all.

### `finally` Semantics

`finally` always runs, even if there is a `return`, `break`, or `continue` in the `try` block. A `return` in `finally` overrides any pending `return` in `try`.

```python
def f():
    try:
        return 1
    finally:
        return 2   # caller receives 2, not 1
```

### Chained Exceptions

```python
raise NewError("...") from original   # explicit chaining; sets __cause__
raise NewError("...")                  # in except block: implicit chaining; sets __context__
raise NewError("...") from None        # suppress chaining
```

### Exception Groups (Python 3.11+)

`ExceptionGroup` holds multiple exceptions. Use `except*` to match subsets:

```python
try:
    ...
except* ValueError as eg:
    # eg.exceptions is the matched subset
    for e in eg.exceptions:
        handle(e)
```

---

## Generator and Iterator Protocol

An **iterator** has `__iter__` (returns self) and `__next__` (returns next value or raises `StopIteration`).

A **generator function** contains `yield`; calling it returns a generator object. Generator objects are iterators.

**Key behavior:** generators are lazy — they run only when `next()` is called.

```python
def gen():
    print("start")
    yield 1
    print("middle")
    yield 2

g = gen()        # prints nothing
next(g)          # prints "start", returns 1
next(g)          # prints "middle", returns 2
next(g)          # raises StopIteration
```

**`yield from`:** delegates to a sub-iterator; also propagates `send()` and `throw()` into the sub-generator.

**Generator expressions:** `(expr for x in iterable)` — lazy, single-pass.

---

## Descriptor Protocol

Descriptors implement `__get__`, `__set__`, and/or `__delete__`. They are invoked by attribute access on the class or instance.

- **Data descriptor:** defines `__set__` or `__delete__`; takes priority over instance `__dict__`
- **Non-data descriptor:** only `__get__`; instance `__dict__` takes priority

`property`, `staticmethod`, `classmethod`, and `functools.cached_property` are all descriptors.

```python
class Prop:
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self      # accessed on class
        return obj._value
    def __set__(self, obj, value):
        obj._value = value
```

---

## Method Resolution Order (MRO)

Python uses the **C3 linearization** algorithm. `ClassName.__mro__` shows the lookup order.

```python
class A: pass
class B(A): pass
class C(A): pass
class D(B, C): pass
D.__mro__  # (D, B, C, A, object)
```

`super()` follows the MRO of the *instance*, not the class where `super()` appears. In cooperative multiple inheritance, every class in the chain must call `super().__init__()` for init to work correctly.

---

## Key Dunder Methods

| Method | Triggered by |
|--------|-------------|
| `__init__` | after `__new__`; receives new instance |
| `__new__` | object creation; must return the instance |
| `__del__` | when reference count reaches zero (CPython); timing is not guaranteed |
| `__repr__` | `repr(x)`, fallback for `str(x)` |
| `__str__` | `str(x)`, `print(x)` |
| `__eq__` | `==`; defining it makes the class unhashable unless `__hash__` is also defined |
| `__hash__` | `hash(x)`, dict keys, set membership |
| `__bool__` | `bool(x)`, `if x:`, `while x:` |
| `__len__` | `len(x)`; also used for `bool` if `__bool__` is absent |
| `__contains__` | `x in container` |
| `__getitem__` | `x[key]`, iteration (if `__iter__` absent) |
| `__enter__` / `__exit__` | `with` statement |
| `__call__` | `x(args)` |

**`__eq__` and `__hash__` rule:** if you define `__eq__`, Python sets `__hash__ = None`, making instances unhashable. Define `__hash__` explicitly if the object should still be hashable.

---

## Assignment and Binding Semantics

Assignment binds a name to an object. It does not copy.

```python
a = [1, 2, 3]
b = a       # b and a point to the same list
b.append(4)
print(a)    # [1, 2, 3, 4]
```

Augmented assignment (`+=`) on immutable types rebinds; on mutable types with `__iadd__`, it mutates in place:

```python
a = (1, 2)
a += (3,)   # rebinds a to a new tuple

b = [1, 2]
b += [3]    # calls list.__iadd__, mutates b in place — same object
```

---

## What an Agent May Safely Infer

- Name lookup follows LEGB exactly.
- `is None` and `is not None` are always safe identity checks for `None`.
- Immutable objects cannot be changed through any reference.
- `for x in iterable` calls `iter()` then `next()` repeatedly until `StopIteration`.

## What an Agent Must Not Infer Without Evidence

- That `is` returns the same as `==` for any type.
- That closures capture values at definition time.
- That `finally` blocks do not execute on `return`.
- The MRO of a class without inspecting its full inheritance chain.
- That `__del__` runs at a predictable time.

## What Requires Whole-Program Analysis

- Whether a name is overwritten somewhere else in the module before use.
- Whether a class attribute is shadowed by an instance attribute.
- Whether a generator is exhausted before it is iterated again.
