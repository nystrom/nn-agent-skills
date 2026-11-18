# Python Standard Library Reference

This skill documents what actually exists in the Python standard library, with correct function names and signatures. Every module listed here is available without installation.

---

## `os` and `os.path`

```python
import os
import os.path   # or: from os import path

# Filesystem
os.getcwd()                          # current working directory
os.chdir(path)                       # change directory
os.listdir(path=".")                 # list directory contents (names only, not paths)
os.mkdir(path, mode=0o777)           # create one directory
os.makedirs(path, exist_ok=False)    # create directory tree
os.remove(path)                      # delete a file
os.unlink(path)                      # alias for remove
os.rmdir(path)                       # remove empty directory
os.rename(src, dst)                  # rename/move
os.replace(src, dst)                 # rename, overwriting dst atomically
os.stat(path)                        # file metadata: .st_size, .st_mtime, etc.

# Environment
os.environ                            # dict-like; os.environ["PATH"]
os.environ.get("VAR", "default")
os.getenv("VAR", "default")          # same as environ.get
os.putenv(key, value)                # sets env for subprocess (prefer os.environ[key] = value)

# Path operations
os.path.join("dir", "subdir", "file")  # join path components (OS-appropriate separator)
os.path.exists(path)
os.path.isfile(path)
os.path.isdir(path)
os.path.isabs(path)
os.path.abspath(path)                  # resolve to absolute path
os.path.basename(path)                 # filename component
os.path.dirname(path)                  # directory component
os.path.split(path)                    # (dirname, basename) tuple
os.path.splitext(path)                 # ("path/file", ".ext") tuple
os.path.expanduser("~/file")           # expand ~ to home directory
os.path.getsize(path)                  # file size in bytes

# Process
os.getpid()
os.cpu_count()
```

**What does NOT exist in `os`:**
- `os.path.read()` — use `open(path).read()`
- `os.path.write()` — use `open(path, "w").write()`
- `os.ls()` — use `os.listdir()`

---

## `pathlib`

```python
from pathlib import Path

p = Path("/tmp/dir")
p = Path.home()            # home directory
p = Path.cwd()             # current working directory

# Building paths
p / "subdir" / "file.txt"  # path joining with /
str(p)                      # convert to string

# File operations
p.read_text(encoding="utf-8")       # read entire file as str
p.write_text("content", encoding="utf-8")
p.read_bytes()                       # read as bytes
p.write_bytes(b"data")

# Navigation
p.parent                    # parent directory as Path
p.name                      # final component ("file.txt")
p.stem                      # filename without suffix ("file")
p.suffix                    # extension (".txt")
p.suffixes                  # all suffixes [".tar", ".gz"]

# Tests
p.exists()
p.is_file()
p.is_dir()
p.is_absolute()

# Creation
p.mkdir(parents=True, exist_ok=True)  # create directory
p.touch()                              # create file or update mtime
p.unlink(missing_ok=False)            # delete file (3.8+: missing_ok)
p.rmdir()                             # remove empty directory

# Iteration
list(p.iterdir())                   # immediate children
list(p.glob("*.py"))                # glob pattern (not recursive)
list(p.rglob("*.py"))               # recursive glob
list(p.glob("**/*.py"))             # equivalent to rglob

# Resolving
p.resolve()                # absolute, resolves symlinks
p.relative_to("/tmp")      # relative path from given base
```

---

## `sys`

```python
import sys

sys.argv              # list of command-line arguments; argv[0] is script name
sys.path              # list of directories Python searches for modules
sys.version           # Python version string
sys.version_info      # named tuple: (major, minor, micro, releaselevel, serial)
sys.platform          # "linux", "darwin", "win32"
sys.executable        # path to current Python interpreter
sys.stdin / sys.stdout / sys.stderr
sys.exit(code=0)      # exit; raises SystemExit (caught by except SystemExit)
sys.getrecursionlimit()
sys.setrecursionlimit(n)
sys.getsizeof(obj)    # size of object in bytes (shallow)
sys.modules           # dict of currently imported modules
```

---

## `collections`

```python
from collections import (
    Counter, defaultdict, deque, namedtuple,
    OrderedDict, ChainMap, UserDict, UserList
)

# Counter — count hashable objects
c = Counter("abracadabra")       # Counter({'a': 5, 'b': 2, 'r': 2, 'c': 1, 'd': 1})
c = Counter(["a", "b", "a"])
c.most_common(3)                  # top 3 [(element, count), ...]
c["missing"]                      # returns 0 (not KeyError)
c.total()                         # sum of all counts (Python 3.10+)
c + other_counter                 # add counts
c - other_counter                 # subtract (drops zero/negative)

# defaultdict — dict with default factory
d = defaultdict(list)
d["key"].append(1)               # no KeyError; creates [] automatically
d = defaultdict(int)             # d["new"] == 0

# deque — double-ended queue
dq = deque([1, 2, 3], maxlen=5)  # optional maxlen; old items dropped on append
dq.append(x)                      # add to right
dq.appendleft(x)                  # add to left
dq.pop()                          # remove from right
dq.popleft()                      # remove from left (O(1), unlike list.pop(0))
dq.rotate(n)                      # rotate n steps right (negative = left)
dq.extend(iterable)
dq.extendleft(iterable)           # each element goes to left (reverses order)

# namedtuple — immutable named fields
Point = namedtuple("Point", ["x", "y"])
Point = namedtuple("Point", "x y")  # space-separated string also works
p = Point(1, 2)
p.x, p.y                            # field access by name
p._replace(x=10)                    # new instance with updated field
p._asdict()                         # OrderedDict of fields

# OrderedDict — dict that remembers insertion order
# Note: regular dict preserves insertion order in Python 3.7+
# OrderedDict still has .move_to_end() which regular dict lacks
od = OrderedDict()
od.move_to_end("key")              # move to end (or beginning with last=False)

# ChainMap — multiple dicts as one
cm = ChainMap(dict1, dict2, dict3)
cm["key"]    # searches dict1, then dict2, then dict3
cm.maps      # list of underlying dicts
```

---

## `itertools`

```python
import itertools

# Infinite iterators
itertools.count(start=0, step=1)    # 0, 1, 2, ...
itertools.cycle(iterable)           # a, b, c, a, b, c, ...
itertools.repeat(obj, times=None)   # obj, obj, obj, ... (or n times)

# Finite iterators
itertools.chain(*iterables)                    # chain([1,2], [3,4]) → 1, 2, 3, 4
itertools.chain.from_iterable(iterable)        # flattens one level
itertools.islice(iterable, stop)               # islice(iter, 3) → first 3
itertools.islice(iterable, start, stop, step)
itertools.takewhile(predicate, iterable)       # yield while predicate is True
itertools.dropwhile(predicate, iterable)       # skip while predicate is True
itertools.filterfalse(predicate, iterable)     # yield where predicate is False
itertools.compress(data, selectors)            # compress("ABCD", [1,0,1,0]) → A, C
itertools.accumulate(iterable, func=operator.add, initial=None)  # running total
itertools.starmap(func, iterable)              # starmap(pow, [(2,3), (3,2)]) → 8, 9
itertools.zip_longest(*iterables, fillvalue=None)
itertools.pairwise(iterable)                   # (a,b), (b,c), (c,d) — Python 3.10+

# Grouping
itertools.groupby(iterable, key=None)
# NOTE: only groups consecutive equal-key elements; sort first for "group all by key"
for key, group in itertools.groupby(sorted(data, key=fn), key=fn):
    items = list(group)

# Combinatorics
itertools.product(*iterables, repeat=1)        # Cartesian product
itertools.permutations(iterable, r=None)       # all orderings of length r
itertools.combinations(iterable, r)            # r-length combos, no repeats
itertools.combinations_with_replacement(iterable, r)
```

**What does NOT exist in `itertools`:**
- `itertools.flatten()` — use `itertools.chain.from_iterable()`
- `itertools.zip_strict()` — use `zip(..., strict=True)` (Python 3.10+, built-in `zip`)
- `itertools.first()` — use `next(iter(iterable), default)`

---

## `functools`

```python
import functools

# Caching
@functools.lru_cache(maxsize=128)    # bounded cache; maxsize=None for unlimited
def fib(n): ...

@functools.cache                     # Python 3.9+; alias for lru_cache(maxsize=None)
def fib(n): ...

# cache_info and cache_clear on cached functions:
fib.cache_info()    # CacheInfo(hits=..., misses=..., maxsize=..., currsize=...)
fib.cache_clear()

@functools.cached_property           # lazy attribute computed once per instance
class C:
    @functools.cached_property
    def expensive(self):
        return compute()

# Partial application
add5 = functools.partial(operator.add, 5)
add5(3)   # 8

# Reduction
functools.reduce(func, iterable, initializer=None)
functools.reduce(operator.add, [1, 2, 3, 4])   # 10

# Decorator utilities
@functools.wraps(wrapped_func)       # preserve __name__, __doc__, etc.
def wrapper(*args, **kwargs): ...

# Comparison helpers
@functools.total_ordering            # define __eq__ and one of __lt__/__gt__ etc.;
class MyClass:                       # total_ordering fills in the rest
    def __eq__(self, other): ...
    def __lt__(self, other): ...

# Single dispatch (function overloading on first argument type)
@functools.singledispatch
def process(obj):
    raise NotImplementedError

@process.register(str)
def _(obj: str): ...

@process.register(int)
def _(obj: int): ...
```

---

## `contextlib`

```python
from contextlib import (
    contextmanager, asynccontextmanager,
    suppress, nullcontext, ExitStack
)

# Custom context managers
@contextmanager
def managed_resource():
    resource = acquire()
    try:
        yield resource
    finally:
        release(resource)

with managed_resource() as r:
    use(r)

# Suppress specific exceptions
with suppress(FileNotFoundError, KeyError):
    os.remove("maybe_missing.txt")

# Null context (useful when context manager is optional)
cm = open(path) if path else nullcontext(default_value)
with cm as f:
    ...

# ExitStack — dynamic number of context managers
with ExitStack() as stack:
    files = [stack.enter_context(open(f)) for f in filenames]
    # all files closed on exit, even if some fail to open
```

---

## `copy`

```python
import copy

copy.copy(obj)       # shallow copy — new container, same references inside
copy.deepcopy(obj)   # deep copy — recursively copies all nested objects
```

**When to use which:**
- Shallow copy: safe for flat structures (lists of primitives); shares mutable nested objects.
- Deep copy: safe for nested mutable structures; slower, but fully independent.

---

## `re`

```python
import re

# Compile pattern (recommended for reuse)
pattern = re.compile(r"\d+")

# Match — only at the START of string
m = re.match(r"\d+", "123abc")   # matches "123"
m = re.match(r"\d+", "abc123")   # None — no match at start

# Search — anywhere in string
m = re.search(r"\d+", "abc123def")   # matches "123"

# Find all (non-overlapping)
re.findall(r"\d+", "a1b22c333")   # ["1", "22", "333"]

# Find all with groups
re.findall(r"(\w+)=(\w+)", "a=1 b=2")   # [("a", "1"), ("b", "2")]

# Iterator of match objects
for m in re.finditer(r"\d+", text):
    print(m.group(), m.start(), m.end())

# Substitute
re.sub(r"\d+", "NUM", "a1b2c3")   # "aNUMbNUMcNUM"
re.sub(r"(\w+)", r"[\1]", text)   # backreference in replacement
re.subn(pattern, repl, string)     # returns (new_string, count)

# Split
re.split(r"\s+", "a  b\tc")   # ["a", "b", "c"]
re.split(r"(\s+)", "a  b")    # captures the separator: ["a", "  ", "b"]

# Match object methods
m = re.search(r"(\w+)@(\w+)", "user@example")
m.group(0)    # entire match: "user@example"
m.group(1)    # first group: "user"
m.group(2)    # second group: "example"
m.groups()    # ("user", "example")
m.groupdict() # named groups as dict
m.start(), m.end(), m.span()

# Named groups
m = re.search(r"(?P<user>\w+)@(?P<domain>\w+)", "user@example")
m.group("user")    # "user"
m.groupdict()      # {"user": "user", "domain": "example"}

# Flags
re.IGNORECASE  # re.I
re.MULTILINE   # re.M — ^ and $ match line boundaries
re.DOTALL      # re.S — . matches newlines
re.VERBOSE     # re.X — allow whitespace and comments in pattern
```

**Agent trap:** `re.match()` only matches at the **start** of the string. Use `re.search()` to match anywhere. This is a frequent source of "no match" bugs.

---

## `json`

```python
import json

# Encode to string
json.dumps(obj)                        # Python object → JSON string
json.dumps(obj, indent=2)              # pretty-print
json.dumps(obj, sort_keys=True)
json.dumps(obj, default=str)           # custom serializer for non-JSON types

# Encode to file
with open("file.json", "w") as f:
    json.dump(obj, f, indent=2)        # dumps → string; dump → file (no 's')

# Decode from string
json.loads(string)                     # JSON string → Python object

# Decode from file
with open("file.json") as f:
    obj = json.load(f)                 # loads → string; load → file (no 's')
```

**JSON ↔ Python type mapping:**

| JSON | Python |
|------|--------|
| object | dict |
| array | list |
| string | str |
| number (int) | int |
| number (float) | float |
| true/false | True/False |
| null | None |

**What does NOT exist:**
- `json.parse()` — it's `json.loads()`
- `json.stringify()` — it's `json.dumps()` (JavaScript convention)

---

## `datetime`

```python
from datetime import datetime, date, time, timedelta, timezone

# Creating
datetime.now()                    # local time, naive (no timezone)
datetime.now(tz=timezone.utc)     # UTC, aware
datetime.utcnow()                 # DEPRECATED in 3.12 — use now(tz=timezone.utc)
datetime.today()                  # same as now() without tz
datetime.fromisoformat("2024-01-15T10:30:00")   # parse ISO 8601
datetime.strptime("2024-01-15", "%Y-%m-%d")

date.today()
date.fromisoformat("2024-01-15")

# Formatting
dt.isoformat()                    # "2024-01-15T10:30:00"
dt.strftime("%Y-%m-%d %H:%M:%S")

# Arithmetic
dt + timedelta(days=7, hours=3)
dt - timedelta(weeks=2)
dt2 - dt1                         # returns timedelta

# Components
dt.year, dt.month, dt.day
dt.hour, dt.minute, dt.second, dt.microsecond
dt.date()                         # extract date part
dt.time()                         # extract time part
dt.weekday()                      # 0=Monday, 6=Sunday
dt.isoweekday()                   # 1=Monday, 7=Sunday

# timedelta
td = timedelta(days=1, seconds=3600)
td.total_seconds()                # total as float
td.days, td.seconds, td.microseconds   # components (seconds is NOT total)

# Timezone
from datetime import timezone
utc = timezone.utc
eastern = timezone(timedelta(hours=-5))   # manual timezone (prefer zoneinfo)
dt.replace(tzinfo=timezone.utc)    # attach timezone (does NOT convert)
dt.astimezone(other_tz)            # convert between timezones

# zoneinfo (Python 3.9+) — named timezones
from zoneinfo import ZoneInfo
tz = ZoneInfo("America/New_York")
dt = datetime.now(tz=tz)
```

**Agent trap:** `datetime.utcnow()` returns a naive datetime (no timezone info). The correct way to get current UTC time is `datetime.now(tz=timezone.utc)`.

---

## `math`

```python
import math

math.floor(x)      # round down → int
math.ceil(x)       # round up → int
math.trunc(x)      # truncate toward zero → int
round(x, ndigits)  # built-in; banker's rounding to even for .5

math.sqrt(x)       # square root (float)
math.isqrt(n)      # integer square root (Python 3.8+)
math.pow(x, y)     # x**y as float
math.log(x)        # natural log
math.log(x, base)  # log base b
math.log10(x)
math.log2(x)

math.gcd(*integers)   # greatest common divisor (variadic in 3.9+)
math.lcm(*integers)   # least common multiple (Python 3.9+)
math.factorial(n)
math.comb(n, k)       # binomial coefficient n choose k (3.8+)
math.perm(n, k)       # permutations (3.8+)

math.fabs(x)       # float absolute value
math.copysign(x, y)  # magnitude of x with sign of y

math.inf           # float infinity
math.nan
math.e
math.pi
math.tau           # 2 * pi

math.isfinite(x)
math.isinf(x)
math.isnan(x)
math.isclose(a, b, rel_tol=1e-9, abs_tol=0.0)

# Trigonometry (all in radians)
math.sin(x), math.cos(x), math.tan(x)
math.asin(x), math.acos(x), math.atan(x)
math.atan2(y, x)
math.degrees(x), math.radians(x)
```

---

## `random`

```python
import random

random.random()              # float in [0.0, 1.0)
random.uniform(a, b)         # float in [a, b]
random.randint(a, b)         # int in [a, b] inclusive (both ends)
random.randrange(start, stop, step=1)   # like range() but returns random element
random.choice(seq)           # random element from non-empty sequence
random.choices(population, weights=None, k=1)  # with replacement
random.sample(population, k)  # k unique elements (no replacement)
random.shuffle(x)            # shuffle list IN PLACE (returns None)
random.seed(a=None)          # seed the RNG

# For cryptographic randomness, use secrets module:
import secrets
secrets.token_hex(16)
secrets.token_urlsafe(16)
secrets.choice(sequence)
```

**What does NOT exist:**
- `random.sample` does not accept a `weights` parameter — use `random.choices` for weighted sampling

---

## `io`

```python
import io

# In-memory text stream (like a file for strings)
buf = io.StringIO()
buf.write("hello\n")
buf.write("world\n")
buf.getvalue()    # "hello\nworld\n"

buf = io.StringIO("existing content")
buf.read()        # read existing content

# In-memory binary stream
buf = io.BytesIO(b"initial data")
buf.read()
buf.write(b"more")
buf.seek(0)       # rewind
buf.getvalue()    # get all bytes
```

---

## `logging`

```python
import logging

# Basic configuration (call once at startup)
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    filename="app.log",    # omit for stderr
)

# Get a named logger (preferred over root logger)
logger = logging.getLogger(__name__)

logger.debug("detailed info")
logger.info("normal info")
logger.warning("something unexpected")
logger.error("something failed")
logger.critical("program cannot continue")
logger.exception("error with traceback")   # logs ERROR + current exception traceback

# Structured logging
logger.info("request completed", extra={"duration_ms": 42, "status": 200})

# Log levels (numeric)
# DEBUG=10, INFO=20, WARNING=30, ERROR=40, CRITICAL=50

# Handlers
handler = logging.StreamHandler()              # stderr
handler = logging.FileHandler("app.log")
handler = logging.handlers.RotatingFileHandler("app.log", maxBytes=10_000_000, backupCount=5)
# (handlers module needs separate import)
from logging import handlers
```

---

## `subprocess`

```python
import subprocess

# Run a command and wait for completion (Python 3.5+)
result = subprocess.run(
    ["ls", "-la"],            # always pass as list, not string
    capture_output=True,      # capture stdout and stderr
    text=True,                # decode as text (default encoding)
    check=True,               # raise CalledProcessError if exit code != 0
    cwd="/tmp",               # working directory
    env={"PATH": "/usr/bin"}, # environment (replaces current env)
    timeout=30,               # seconds
)
result.stdout    # str (with text=True) or bytes
result.stderr
result.returncode

# Read stdout line by line
result = subprocess.run(["command"], capture_output=True, text=True)
for line in result.stdout.splitlines():
    ...

# Exceptions
subprocess.CalledProcessError    # raised by check=True on nonzero exit
subprocess.TimeoutExpired        # raised when timeout exceeded
```

**Agent trap:** Never pass a shell command as a single string without `shell=True`. With `shell=True`, the command is interpreted by the shell (security risk for user input). Always prefer a list: `["command", "arg1", "arg2"]`.

---

## `threading`

```python
import threading

# Thread
t = threading.Thread(target=func, args=(1, 2), kwargs={"key": "val"}, daemon=True)
t.start()
t.join(timeout=None)    # wait for thread to finish
t.is_alive()

# Synchronization primitives
lock = threading.Lock()
with lock:              # preferred over acquire/release
    critical_section()

rlock = threading.RLock()   # reentrant lock (same thread can acquire multiple times)

event = threading.Event()
event.set()
event.clear()
event.wait(timeout=None)    # block until set
event.is_set()

sem = threading.Semaphore(n)
with sem:
    limited_resource()

cond = threading.Condition(lock=None)
with cond:
    cond.wait()           # release lock and block until notify
    cond.notify()         # wake one waiting thread
    cond.notify_all()

# Thread-local storage
local = threading.local()
local.value = 42   # each thread has its own .value
```

**Note on the GIL:** Python's Global Interpreter Lock means only one thread executes Python bytecode at a time. `threading` is useful for I/O-bound concurrency, not CPU-bound. Use `multiprocessing` for CPU-bound parallel work.

---

## `asyncio`

```python
import asyncio

# Run an async function from sync context
asyncio.run(main())   # Python 3.7+; creates event loop, runs coroutine, closes loop

# Coroutines
async def fetch(url):
    await some_async_operation()
    return result

# Tasks (concurrent execution)
task = asyncio.create_task(coroutine())   # schedule for concurrent execution
result = await task

# Gather — run multiple coroutines concurrently
results = await asyncio.gather(coro1(), coro2(), coro3())
# with exception handling:
results = await asyncio.gather(coro1(), coro2(), return_exceptions=True)

# Wait with timeout
try:
    result = await asyncio.wait_for(coro(), timeout=5.0)
except asyncio.TimeoutError:
    ...

# Sleep
await asyncio.sleep(1.0)   # yields control; never use time.sleep() in async code

# Queue
q = asyncio.Queue(maxsize=0)
await q.put(item)
item = await q.get()
q.task_done()
await q.join()    # block until all items processed

# Synchronization
lock = asyncio.Lock()
async with lock:
    ...

event = asyncio.Event()
await event.wait()
event.set()

# Get current event loop (rarely needed)
loop = asyncio.get_event_loop()       # deprecated pattern
loop = asyncio.get_running_loop()     # preferred; only inside async context
```

---

## `typing` — What Requires Importing

**Built-in types usable directly as annotations (no import needed in 3.9+):**
`int`, `float`, `str`, `bool`, `bytes`, `list`, `dict`, `tuple`, `set`, `frozenset`, `type`

**Generic aliases available without import in 3.9+ (use instead of capitalized typing equivalents):**
`list[int]`, `dict[str, int]`, `tuple[int, ...]`, `set[str]`, `frozenset[str]`

**Must import from `typing`** (never auto-available as builtins):

```python
from typing import (
    Any,              # escape hatch; compatible with all types
    Union,            # Union[X, Y] — prefer X | Y in 3.10+
    Optional,         # Optional[X] == Union[X, None] — prefer X | None in 3.10+
    Callable,         # Callable[[Arg1, Arg2], Return]
    TypeVar,          # generic type variable
    Generic,          # base class for generic classes
    Protocol,         # structural subtyping (3.8+)
    TypedDict,        # typed dict (3.8+)
    Literal,          # Literal["a", "b"] (3.8+)
    Final,            # Final[int] — cannot reassign (3.8+)
    ClassVar,         # ClassVar[int] — class variable, not instance (3.8+)
    overload,         # declare multiple type signatures
    cast,             # cast(Type, expr) — type checker hint only
    TYPE_CHECKING,    # bool; True only during type checking, not at runtime
    get_type_hints,   # resolve annotations including string forward refs
    Annotated,        # Annotated[T, metadata] (3.9+)
    TypeGuard,        # user-defined type narrowing function (3.10+)
    ParamSpec,        # captures function parameter types (3.10+)
    TypeAlias,        # explicit type alias declaration (3.10+)
    Never,            # return type of functions that never return (3.11+)
    Self,             # refers to current class in methods (3.11+)
    TypeVarTuple,     # variadic generics (3.11+)
    Unpack,           # used with TypeVarTuple (3.11+)
    assert_never,     # raise AssertionError at runtime if reached (3.11+)
    TypeIs,           # stricter TypeGuard with bidirectional narrowing (3.13+)
    ReadOnly,         # mark TypedDict field as read-only (3.13+)
)
```

**From `collections.abc` (3.9+ alternative for some structural types):**
```python
from collections.abc import (
    Callable,         # same as typing.Callable; prefer this in 3.9+
    Iterator,
    Generator,
    AsyncGenerator,
    Awaitable,
    Coroutine,
    Sequence,         # read-only sequence
    MutableSequence,
    Mapping,          # read-only dict-like
    MutableMapping,
    Set,              # read-only set-like
    MutableSet,
    Hashable,
    Sized,
    Iterable,
    AsyncIterable,
)
```

**`typing_extensions`** — backports newer typing features to older Python:
```python
# Pattern: import from typing if available, else typing_extensions
try:
    from typing import TypeAlias        # Python 3.10+
except ImportError:
    from typing_extensions import TypeAlias  # Python 3.8/3.9

# Install: pip install typing_extensions
# Common backports: TypeAlias, ParamSpec, TypeGuard, Self, Never,
#                   TypeVarTuple, Unpack, assert_never, TypeIs, ReadOnly
```

**`TYPE_CHECKING` guard:** imports inside `if TYPE_CHECKING:` are only processed by type checkers, not at runtime. Use to avoid circular imports and to import expensive modules only for annotation purposes.

```python
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mymodule import HeavyClass

def f(x: "HeavyClass") -> None:  # or just: x: HeavyClass with future annotations
    ...
```

---

## `dataclasses`

```python
from dataclasses import dataclass, field, fields, asdict, astuple, replace

@dataclass
class Point:
    x: float
    y: float
    label: str = "origin"
    tags: list[str] = field(default_factory=list)

# field() options:
field(
    default=...,            # default value
    default_factory=list,   # callable that produces the default
    init=True,              # include in __init__
    repr=True,              # include in __repr__
    compare=True,           # use in __eq__ and ordering
    hash=None,              # include in __hash__
    metadata=None,          # arbitrary metadata dict
)

# Utilities:
fields(Point)              # tuple of Field objects
asdict(p)                  # recursively convert to dict
astuple(p)                 # recursively convert to tuple
replace(p, x=10)           # new instance with updated fields (non-mutating)

# Common options:
@dataclass(frozen=True)     # immutable (fields cannot be reassigned); makes it hashable
@dataclass(order=True)      # generate __lt__, __le__, etc. based on field order
@dataclass(slots=True)      # use __slots__ for memory efficiency (3.10+)
@dataclass(kw_only=True)    # all fields keyword-only (3.10+)
```

---

## `enum`

```python
from enum import Enum, IntEnum, Flag, IntFlag, auto, unique

class Color(Enum):
    RED = 1
    GREEN = 2
    BLUE = 3

Color.RED           # <Color.RED: 1>
Color.RED.name      # "RED"
Color.RED.value     # 1
Color(1)            # Color.RED — construct from value
Color["RED"]        # Color.RED — construct from name
list(Color)         # all members

@unique             # raises ValueError if any values are duplicated
class Status(Enum):
    PENDING = "pending"
    DONE = "done"

class Permission(Flag):  # supports bitwise operations
    READ = auto()
    WRITE = auto()
    EXECUTE = auto()

Permission.READ | Permission.WRITE   # combined flag
```

---

## `abc`

```python
from abc import ABC, abstractmethod

class Shape(ABC):
    @abstractmethod
    def area(self) -> float: ...

    @abstractmethod
    def perimeter(self) -> float: ...

class Circle(Shape):
    def __init__(self, r: float):
        self.r = r

    def area(self) -> float:
        return math.pi * self.r ** 2

    def perimeter(self) -> float:
        return 2 * math.pi * self.r

Shape()    # TypeError: Can't instantiate abstract class Shape
Circle(5)  # OK
```

---

## `hashlib` and `hmac`

```python
import hashlib
import hmac

# Hash a value
h = hashlib.sha256(b"data")
h = hashlib.sha256()
h.update(b"part1")
h.update(b"part2")
h.hexdigest()   # hex string
h.digest()      # raw bytes

# One-shot
hashlib.sha256(b"data").hexdigest()
hashlib.md5(b"data").hexdigest()   # not for security; use sha256+
hashlib.blake2b(b"data").hexdigest()

# Available algorithms
hashlib.algorithms_available   # set of algorithm names on this platform
hashlib.algorithms_guaranteed  # always available

# Password hashing
hashlib.scrypt(password, salt=salt, n=2**14, r=8, p=1)
# Or use: import bcrypt  (third-party, preferred for passwords)

# HMAC (message authentication)
mac = hmac.new(key, msg, hashlib.sha256)
mac.hexdigest()
hmac.compare_digest(a, b)   # constant-time comparison (prevents timing attacks)
```

---

## What an Agent May Safely Infer

- `re.match()` only matches at the start; use `re.search()` to match anywhere.
- `json.dump`/`json.load` operate on files; `json.dumps`/`json.loads` operate on strings.
- `random.shuffle()` modifies in place and returns `None`.
- `itertools.groupby()` only groups consecutive equal-key elements; sort first for full grouping.
- `datetime.utcnow()` is deprecated; use `datetime.now(tz=timezone.utc)`.

## What an Agent Must Not Infer Without Evidence

- That `list.add()` exists — it's `list.append()`.
- That `dict.get_default()` exists — it's `dict.get(key, default)`.
- That `str.contains()` exists — use `substring in string`.
- That `json.parse()` or `json.stringify()` exist — those are JavaScript.
- That `itertools.flatten()` exists — use `itertools.chain.from_iterable()`.
- That typing constructs like `TypeAlias`, `Self`, `Never` are available before their introduction version — use `typing_extensions` for backporting.
