# C++ Semantics

How C++ actually evaluates, initializes, copies, moves, and destroys objects — the
model behind RAII and the rule of 0/3/5. C++ has deterministic destruction and
value semantics by default (objects are copied, not referenced, unless you ask
otherwise). Reasoning about C++ as if it were Java/C#/Python (reference semantics,
GC) or even as if moves were like Rust moves produces wrong code.

---

## Value Semantics by Default

A variable *is* an object, not a handle to one. Assignment and pass-by-value
**copy** the whole object; there is no implicit sharing.

```cpp
std::vector<int> a = {1, 2, 3};
std::vector<int> b = a;   // full copy: b has its own elements
b.push_back(4);           // a is unchanged
```

To share or refer without copying, use references (`&`), pointers, or smart
pointers explicitly. This is the opposite default of Java/Python.

---

## RAII and Deterministic Destruction

An object's destructor runs deterministically when it goes out of scope, in
reverse order of construction. Resource cleanup is tied to object lifetime (RAII),
not to a garbage collector or `finally`.

```cpp
{
    std::lock_guard<std::mutex> g(m);   // acquires
    std::ofstream f("x");
    // ...
}   // f destroyed (file closed), then g destroyed (mutex released) — reverse order
```

This is why C++ needs no `finally`: the destructor is the cleanup. A leaked
resource usually means an object that outlived its intended scope (e.g. `new`
without a matching `delete`, or a missing smart pointer).

---

## Value Categories: lvalue, xvalue, prvalue

Every expression has a type **and** a value category. The categories drive
overload resolution (especially move vs copy):

- **lvalue** — names a persistent object (`x`, `obj.field`, `*p`).
- **prvalue** — a pure value with no identity yet (`42`, `a + b`, `T{}`).
- **xvalue** — an "expiring" object, typically the result of `std::move(x)` or a
  function returning `T&&`.

`std::move(x)` does **not** move anything; it is a cast to an xvalue (`T&&`) that
*permits* a move constructor/assignment to be selected. The actual move happens in
that constructor.

---

## Move Semantics and the Moved-From State

Moving transfers resources from a source to a destination. Unlike Rust, the
moved-from object is **still alive and must be destroyed** — it is left in a
"valid but unspecified" state.

```cpp
std::string s = "hello";
std::string t = std::move(s);   // t owns the buffer; s is valid-but-unspecified
// s.size() is legal but its value is unspecified; assigning to s is fine
```

You may safely destroy or reassign a moved-from object; you must not assume its
value. Using its value (beyond re-assignment) is a bug, not UB per se, but
unspecified.

---

## The Rule of 0/3/5

If a class manages a resource, the special members (destructor, copy ctor, copy
assign, move ctor, move assign) must be consistent:

- **Rule of 0**: prefer to manage resources with members that already do it
  (`std::string`, `std::vector`, `std::unique_ptr`) and declare none of the five.
- **Rule of 3**: if you declare a destructor, copy ctor, or copy assign, you
  probably need all three.
- **Rule of 5**: add the move ctor and move assign for efficiency.

Declaring a destructor suppresses the implicit move operations, silently forcing
copies — a common performance and correctness surprise.

---

## Copy Elision and (N)RVO

The compiler may (and since C++17, in some cases **must**) elide copies/moves when
constructing from a prvalue.

```cpp
std::string make() { return std::string("hi"); }   // C++17: guaranteed no copy/move
std::string s = make();                              // constructed in place
```

Named RVO (returning a named local) is permitted but not guaranteed. Do not write
`return std::move(local);` — it can *pessimize* by disabling NRVO.

---

## Initialization Has Many Forms

C++ has several initialization syntaxes with different meaning:

```cpp
int a;         // default-init: indeterminate value for a local int (reading it is UB)
int b{};       // value-init: zero
int c = 5;     // copy-init
int d{5};      // list-init: also forbids narrowing conversions
std::vector<int> v(3, 0);   // 3 elements of 0
std::vector<int> w{3, 0};   // 2 elements: 3 and 0  (braces prefer initializer_list)
```

`{}` prevents narrowing and prefers `initializer_list` constructors — the `v` vs
`w` difference is a classic trap.

---

## Most Vexing Parse

A declaration that looks like an object construction can be parsed as a function
declaration.

```cpp
std::string s();          // NOT an empty string — declares a function s() returning string
std::string s2{};         // an empty string (use braces)
Widget w(Reader());       // declares a function, not a Widget
```

Prefer `{}` initialization to avoid it.

---

## What an Agent May Safely Infer

- Variables have value semantics: assignment/pass-by-value copies the whole object.
- Destructors run deterministically at scope end, in reverse construction order.
- `std::move` is a cast to rvalue; the move happens in the move constructor/assignment.
- A moved-from object is alive and must be destroyed; its value is unspecified.
- Declaring a destructor suppresses implicit move operations (forces copies).

## What an Agent Must Not Infer Without Evidence

- That objects are reference-typed/GC'd like Java or Python — they are values.
- That `std::move` moves by itself, or that a moved-from object is unusable (as in Rust).
- That reading an uninitialized local (`int a;`) is defined — it is UB.
- That `T x();` constructs an object — it declares a function (most vexing parse).
- That `return std::move(local);` helps — it usually disables NRVO.

## What Requires Checking the Code

- Whether a class follows the rule of 0/3/5 (are moves suppressed by a declared dtor?).
- Which constructor `{...}` selects (initializer_list vs others) for a given type.
- Whether a copy is elided (guaranteed only for prvalue init since C++17).
- Which `-std` the translation unit is compiled with (affects guaranteed elision, etc.).
