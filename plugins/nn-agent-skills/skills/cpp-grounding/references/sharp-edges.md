# C++ Sharp Edges

The behaviors that most often produce broken C++ or wrong explanations — above
all **undefined behavior** (UB), where the standard imposes no requirements at
all and the compiler may do anything, including "work" until it catastrophically
does not. C++ has no memory safety net: the language will not stop you, and the
symptom often appears far from the cause.

---

## Undefined Behavior Is Not "Implementation-Defined"

UB means the program has no defined meaning; the optimizer may assume it never
happens and delete surrounding code. This is different from *implementation-defined*
(a documented choice) and *unspecified* (an undocumented choice among valid
options). Common UB:

- Signed integer overflow (`INT_MAX + 1`).
- Out-of-bounds array/pointer access.
- Dereferencing null or a dangling pointer/reference.
- Use-after-free / use-after-move-of-a-value you then read.
- Reading an uninitialized value.
- Data race (two threads, one writes, no synchronization).
- Violating strict aliasing (accessing an object through an incompatible type).

"It ran fine on my machine" is not evidence of correctness for UB.

---

## Signed Overflow Is UB; Unsigned Wraps

```cpp
int x = INT_MAX; x + 1;          // UB — compiler may assume it never overflows
unsigned u = UINT_MAX; u + 1;    // defined: wraps to 0 (modular)
```

Because signed overflow is UB, compilers optimize on the assumption it cannot
occur (e.g. `x + 1 > x` folds to `true`). Unsigned arithmetic is modular and
defined — which brings its own traps (`0u - 1` is a huge number; mixing signed/
unsigned in comparisons flips results).

---

## Iterator / Reference Invalidation

Mutating a container can invalidate iterators, pointers, and references into it —
and the standard specifies exactly when. Using an invalidated one is UB.

```cpp
std::vector<int> v = {1, 2, 3};
int& first = v[0];
v.push_back(4);     // may reallocate: `first` is now dangling
first = 9;          // UB
```

`vector` reallocation invalidates everything; `push_back`/`insert`/`erase` have
specific rules. `std::string` behaves like `vector`. Node-based containers
(`list`, `map`) invalidate less.

---

## Dangling References From Temporaries

A reference bound to a temporary that has been destroyed dangles.

```cpp
std::string_view sv = std::string("hello");   // temporary string dies at end of statement
std::cout << sv;                               // UB — sv views freed memory

const std::string& bad = std::vector<std::string>{"a"}[0];  // element gone after the statement
```

`std::string_view` and `std::span` are non-owning; never let them outlive their
backing storage. A `const&` local extends a temporary's lifetime, but a `const&`
to a *subobject* of a temporary, or one stored in a struct, does not.

---

## Integer Promotion and Narrowing

Small integer types promote to `int` in arithmetic; conversions can narrow
silently (except in `{}` init, which forbids narrowing).

```cpp
char a = 200, b = 100;
int s = a + b;         // computed as int; fine
uint8_t x = 300;       // narrowing to 44 with = (silent); {300} would be a compile error
if (-1 < 1u) {}        // FALSE: -1 converts to a huge unsigned
```

Prefer `{}` initialization to catch narrowing at compile time, and avoid mixed
signed/unsigned comparisons.

---

## `NULL`, `0`, and `nullptr`

`nullptr` (C++11) is a typed null pointer constant. `NULL`/`0` are integers that
can select the wrong overload.

```cpp
void f(int);
void f(char*);
f(NULL);       // may call f(int) — NULL is often 0
f(nullptr);    // calls f(char*) unambiguously
```

Always use `nullptr`.

---

## Uninitialized Locals Hold Garbage

Local variables of built-in type are **not** zero-initialized; reading them before
assignment is UB.

```cpp
int n;             // indeterminate
if (n == 0) {}     // UB — reads an indeterminate value
int m{};           // value-initialized to 0
```

Value-initialize (`{}`) or assign before reading. Class types with a default
constructor are initialized; raw scalars are not.

---

## `std::move` Does Not Null Out

Moving from an object leaves it valid-but-unspecified — **not** empty or null in
general (though library types like `unique_ptr` do become null). Reading a
moved-from value's contents is a logic bug.

```cpp
auto p = std::make_unique<int>(5);
auto q = std::move(p);   // p is now null (unique_ptr guarantees this)
std::string s = "x";
std::string t = std::move(s);   // s is valid but unspecified — do not rely on it being ""
```

---

## What an Agent May Safely Infer

- UB lets the compiler assume it never happens and optimize accordingly; it is not "just a crash".
- Signed overflow is UB; unsigned arithmetic wraps (modular) and is defined.
- Container mutation can invalidate iterators/refs per specified rules; misuse is UB.
- `string_view`/`span` are non-owning; outliving their storage is UB.
- Uninitialized scalar locals are indeterminate; reading them is UB. Use `nullptr`, not `NULL`.

## What an Agent Must Not Infer Without Evidence

- That code "works" implies it is UB-free — UB can appear to work until it doesn't.
- That signed overflow wraps — it is UB (only unsigned wraps).
- That a reference/pointer stays valid after a container reallocation.
- That an uninitialized local is zero — only `{}`/value-init guarantees that.
- That a moved-from object is empty (except types like `unique_ptr` that specify null).

## What Requires Checking the Code

- Whether a pointer/reference/iterator outlives the object or storage it refers to.
- Whether an operation on a container invalidates references held elsewhere.
- Whether arithmetic can overflow a signed type for the actual input range.
- Whether a build uses sanitizers (ASan/UBSan) that would catch these at runtime.
