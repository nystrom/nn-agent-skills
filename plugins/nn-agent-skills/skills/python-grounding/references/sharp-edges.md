# Python Sharp Edges

This skill documents Python behaviors that are non-obvious, surprising, or commonly misunderstood. These are the areas where agents most often generate incorrect code or incorrect explanations.

---

## Mutable Default Arguments

**The trap:** default argument values are evaluated *once at function definition*, not on each call. Mutable defaults are shared across all calls.

```python
# Bug: all callers share the same list
def append_to(item, to=[]):
    to.append(item)
    return to

append_to(1)   # [1]
append_to(2)   # [1, 2] — not [2]

# Fix: use None as sentinel
def append_to(item, to=None):
    if to is None:
        to = []
    to.append(item)
    return to
```

This applies to any mutable default: `list`, `dict`, `set`, and user-defined mutable objects.

**Dataclasses:** use `field(default_factory=list)` — bare `= []` raises a `ValueError` at class definition time.

---

## Late Binding in Loop Closures

**The trap:** closures capture variable *references*, not values. The variable's value at call time is used, not at definition time.

```python
# Bug: all functions return 4
funcs = []
for i in range(5):
    funcs.append(lambda: i)

[f() for f in funcs]  # [4, 4, 4, 4, 4]

# Fix: default argument creates a new local binding per iteration
funcs = []
for i in range(5):
    funcs.append(lambda i=i: i)

[f() for f in funcs]  # [0, 1, 2, 3, 4]
```

The same applies to `def` inside loops, comprehensions with inner functions, and `functools.partial`.

---

## `is` vs `==`

`is` tests identity (same object). `==` tests equality (`__eq__`).

**Integer and string caching (CPython implementation detail):**

CPython caches small integers (typically -5 to 256) and many string literals. This means `is` accidentally returns `True` for them:

```python
a = 256
b = 256
a is b   # True — cached

a = 257
b = 257
a is b   # False — not cached (in typical CPython; depends on context)

# String interning
"hello" is "hello"  # True in most cases
s = "hel" + "lo"
s is "hello"        # may be True or False depending on context
```

**Rule:** never use `is` to test equality of integers, strings, or any value type. Only use `is` with singletons: `None`, `True`, `False`, and sentinel objects.

---

## Class Variables vs Instance Variables

**The trap:** attributes set on the class body are class variables. Assigning to `self.attr` creates an instance variable that shadows the class variable.

```python
class Dog:
    tricks = []   # class variable — shared across all instances

    def add_trick(self, trick):
        self.tricks.append(trick)   # mutates the class variable
```

```python
fido = Dog()
buddy = Dog()
fido.add_trick("roll over")
buddy.tricks   # ["roll over"] — fido's mutation affected buddy
```

```python
# Fix: create instance variable in __init__
class Dog:
    def __init__(self):
        self.tricks = []   # each instance gets its own list

    def add_trick(self, trick):
        self.tricks.append(trick)
```

**Shadowing:** `self.count = 0` creates an instance attribute that shadows `Dog.count`, but `Dog.count` is unchanged.

```python
class Counter:
    count = 0

c = Counter()
c.count = 5      # creates instance attribute; does not change Counter.count
Counter.count    # still 0
```

---

## `__eq__` Makes Classes Unhashable

Defining `__eq__` sets `__hash__ = None`, making instances unhashable (cannot be used as dict keys or set members).

```python
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __eq__(self, other):
        return (self.x, self.y) == (other.x, other.y)

p = Point(1, 2)
hash(p)           # TypeError: unhashable type: 'Point'
{p: "value"}      # TypeError
```

**Fix:** define `__hash__` explicitly:

```python
def __hash__(self):
    return hash((self.x, self.y))
```

Or use `@dataclass(frozen=True)` which auto-generates both consistently.

---

## Exception Variable Scope

The exception variable in an `except` clause is deleted after the `except` block, even if it was defined before:

```python
e = "original"
try:
    raise ValueError("oops")
except ValueError as e:
    pass

print(e)   # NameError: name 'e' is not defined
```

**Fix:** save the exception before the block ends if you need it later:

```python
exc = None
try:
    raise ValueError("oops")
except ValueError as e:
    exc = e

print(exc)   # ValueError: oops
```

---

## Generators Are Exhausted After One Pass

A generator can only be iterated once. After exhaustion, it yields nothing.

```python
gen = (x * 2 for x in range(5))
list(gen)   # [0, 2, 4, 6, 8]
list(gen)   # [] — exhausted

# If you need multiple passes, use a list:
data = list(x * 2 for x in range(5))
```

`zip`, `map`, `filter`, and `itertools` objects are also iterators — they exhaust.

---

## `dict` Key Ordering

Since Python 3.7, `dict` preserves insertion order. This is guaranteed by the language spec, not just CPython. However:

- `dict` is not a sorted structure; order is insertion order, not key order
- Equality (`==`) between dicts ignores order: `{"a": 1, "b": 2} == {"b": 2, "a": 1}` is `True`
- `json.loads` preserves key order in the output dict

---

## `None` as Default and Sentinel Pattern

`None` is a singleton. Testing `if x is None` is always safe. Testing `if not x` is not — it returns `True` for `None`, `0`, `""`, `[]`, `{}`, `set()`, and any object with `__bool__` returning `False`.

```python
# Bug: treats empty list the same as None
def process(items=None):
    if not items:          # True for both None and []
        items = default()

# Fix
def process(items=None):
    if items is None:
        items = default()
```

---

## String Formatting Pitfalls

**`%` formatting:** silently ignores extra arguments; raises `TypeError` for too few.

**`.format()` and f-strings:** raise `IndexError`/`KeyError` for missing positional/keyword arguments.

**f-strings evaluate at definition time:**

```python
name = "world"
greeting = f"Hello, {name}!"   # evaluated immediately; not a template
```

To create a reusable template, use `str.format` or a function.

---

## Integer Division

`/` always returns a `float` in Python 3, even for integer operands:

```python
7 / 2    # 3.5, not 3
7 // 2   # 3 (floor division, returns int for int operands)
-7 // 2  # -4 (floors toward negative infinity, not toward zero)
```

`-7 // 2` is `-4`, not `-3`. This surprises programmers coming from C/Java where truncation is toward zero.

**`divmod(a, b)`** returns `(a // b, a % b)` consistently.

---

## Circular Imports

Python caches modules in `sys.modules` after the first import. If module A imports module B, and module B imports module A, the second import gets a partially-initialized module.

```python
# a.py
from b import func_b   # imports b, which triggers b.py to run

# b.py
from a import func_a   # a is in sys.modules but may not have func_a yet
```

**Fixes:**
1. Move imports inside functions (lazy import)
2. Import the module, not names from it: `import a` instead of `from a import func_a`
3. Restructure to break the cycle

---

## Import Side Effects and `__init__.py`

Importing a module executes its top-level code. This includes:
- Global variable initialization
- Logging configuration
- Database connections
- `@app.route` decorators in Flask

If a module has side effects, importing it triggers them. This is why `if __name__ == "__main__":` guards are important.

**`__all__`:** controls what `from module import *` imports. Does not affect explicit `from module import name`. If `__all__` is absent, `from module import *` imports all names not starting with `_`.

---

## `@property` and Assignment

`@property` without `@name.setter` creates a read-only attribute. Assignment raises `AttributeError`:

```python
class C:
    @property
    def x(self):
        return self._x

c = C()
c.x = 1   # AttributeError: can't set attribute
```

---

## `super()` in Multiple Inheritance

`super()` does not call the parent class; it calls the *next class in the MRO*. In cooperative multiple inheritance, every class must call `super().__init__()` for all `__init__` methods to run:

```python
class A:
    def __init__(self):
        super().__init__()   # must call super even if inheriting object
        self.a = 1

class B(A):
    def __init__(self):
        super().__init__()
        self.b = 2

class C(A):
    def __init__(self):
        super().__init__()
        self.c = 3

class D(B, C):
    def __init__(self):
        super().__init__()

d = D()   # d.a, d.b, d.c all set correctly
# MRO: D → B → C → A → object
```

If any class in the chain does not call `super().__init__()`, classes later in the MRO are not initialized.

---

## `*args` and `**kwargs` Do Not Preserve Order Guarantees for `*args`

`**kwargs` preserves insertion order (Python 3.7+). `*args` is a tuple, order is positional.

---

## `copy` vs Deep Copy

```python
import copy

a = [[1, 2], [3, 4]]
b = a.copy()          # shallow copy: inner lists are the same objects
b[0].append(99)
a[0]                  # [1, 2, 99] — b[0] and a[0] are the same list

c = copy.deepcopy(a)  # recursive copy: all objects are new
c[0].append(99)
a[0]                  # unchanged
```

`list.copy()`, `dict.copy()`, and slice `[:]` are all shallow.

---

## `__slots__`

Defining `__slots__` prevents the creation of `__dict__` on instances. Reduces memory for many instances; prevents dynamic attribute assignment:

```python
class Point:
    __slots__ = ("x", "y")

p = Point()
p.x = 1
p.z = 3   # AttributeError: 'Point' object has no attribute 'z'
```

Classes using `__slots__` cannot have default attribute values set via class body assignment (use `__init__`).

---

## What an Agent May Safely Infer

- A mutable default argument is always a bug waiting to happen.
- `is None` is always the right test for `None`; `== None` works but is less idiomatic and can be overridden by `__eq__`.
- Closing over a loop variable captures the reference, not the value.
- `7 / 2` is `3.5` in Python 3.

## What an Agent Must Not Infer Without Evidence

- That integer `is` comparisons are reliable — caching is an implementation detail.
- That a class is safe to use as a dict key without checking its `__hash__` and `__eq__`.
- That `super()` always calls the immediate parent — it follows the MRO.
- That circular import structures work correctly — they require careful restructuring.

## What Requires Whole-Program Analysis

- Whether removing a module-level side effect breaks callers that depend on it.
- Whether a class is used as a dict key anywhere (before removing `__hash__`).
- Whether a generator is iterated more than once in the codebase.
