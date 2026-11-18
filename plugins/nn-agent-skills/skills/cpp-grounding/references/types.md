# C++ Types and Templates

C++'s type system: templates (compile-time generics resolved by instantiation),
`const`/`constexpr`, references vs pointers, smart pointers, and the resolution
rules (overloading, ADL, concepts). Templates are not Java generics and not C#
generics — they are instantiated per type, duck-typed, and diagnosed late.

---

## Templates Instantiate; They Are Duck-Typed

A template is a pattern; the compiler generates a concrete class/function per set
of template arguments used. Requirements are checked against the actual type at
instantiation, not declared up front (pre-concepts).

```cpp
template <class T> T add(T a, T b) { return a + b; }
add(1, 2);          // instantiates add<int>
add(std::string("a"), std::string("b"));   // instantiates add<std::string>
// add(SomeTypeWithoutPlus{}, ...);   // error only when instantiated, deep in the template
```

This is why template errors are verbose and appear at the use site. Concepts
(C++20) move the check earlier and improve diagnostics.

---

## `const` vs `constexpr` vs `consteval`

- `const` — runtime immutability of a binding; the value need not be known at
  compile time.
- `constexpr` — *may* be evaluated at compile time; usable in constant expressions
  if its inputs are constant.
- `consteval` (C++20) — *must* be evaluated at compile time (immediate function).

```cpp
const int a = runtime();        // fixed after init, computed at runtime
constexpr int b = 2 * 21;       // compile-time constant
consteval int sq(int x){ return x*x; }   // every call must be a constant expression
```

`constexpr` does not guarantee compile-time evaluation unless used in a context
that requires it.

---

## References vs Pointers

A reference is an alias for an existing object: it cannot be null, cannot be
reseated, and must be initialized. A pointer can be null, reseated, and arithmetic
'd.

```cpp
int x = 1, y = 2;
int& r = x;    // r aliases x forever
r = y;         // assigns y's value into x; does NOT rebind r
int* p = &x;   // p can be null, can point elsewhere later
p = &y;        // rebinds p
```

A dangling reference (to a destroyed object) is UB just like a dangling pointer.

---

## Smart Pointers Express Ownership

- `std::unique_ptr<T>` — sole owner, move-only, zero overhead. The default.
- `std::shared_ptr<T>` — shared ownership via atomic reference count; heavier.
- `std::weak_ptr<T>` — non-owning observer of a `shared_ptr` (breaks cycles).

```cpp
auto u = std::make_unique<T>(args);     // preferred over new
auto s = std::make_shared<T>(args);
```

Prefer `make_unique`/`make_shared` over raw `new`. A raw `T*` should mean
"non-owning observer"; ownership belongs to a smart pointer or container.

---

## `auto` and CTAD

`auto` deduces a variable's type; it strips top-level `const`/reference unless you
write `const auto&`. Class template argument deduction (CTAD, C++17) lets you omit
template args on construction.

```cpp
auto i = 5;                 // int
const auto& r = expr;       // preserves const and binds by reference
std::vector v{1, 2, 3};     // CTAD: deduces std::vector<int>
std::pair p{1, 2.0};        // std::pair<int, double>
```

`auto x = expr;` copies; use `auto&`/`const auto&` to avoid a copy.

---

## Overload Resolution and ADL

Calling an overloaded name picks the best match by conversion rank. **Argument-
dependent lookup** also searches the namespaces of the argument types, which is
why `std::` free functions are found without qualification in some cases.

```cpp
std::string a, b;
using std::swap;
swap(a, b);     // ADL finds std::swap; the `using` enables the customization point
```

The `using std::swap; swap(x, y);` idiom is deliberate: it lets a user-provided
`swap` in the argument's namespace win, falling back to `std::swap`.

---

## SFINAE vs Concepts

Before C++20, overloads were constrained with SFINAE (`std::enable_if`,
substitution failure). C++20 concepts express the same constraints readably and
diagnose better.

```cpp
// C++20
template <std::integral T> T half(T x) { return x / 2; }
```

Concepts are a constraint system, not a runtime type; they still resolve at
compile time.

---

## What an Agent May Safely Infer

- Templates instantiate per type and are checked at the use site (pre-concepts).
- `const` is runtime immutability; `constexpr` may be, `consteval` must be, compile-time.
- References cannot be null or reseated; assigning through one mutates the referent.
- `unique_ptr` is the default owner; raw pointers should be non-owning.
- `auto x = e` copies and strips const/ref; use `const auto&` to bind without copying.

## What an Agent Must Not Infer Without Evidence

- That templates behave like Java generics (type-erased) — they are instantiated per type.
- That `constexpr` forces compile-time evaluation — only `consteval` does.
- That a reference can be rebound or be null — it cannot.
- That `auto&` and `auto` mean the same thing — one binds, one copies.
- That a raw `T*` owns its pointee — ownership lives in a smart pointer/container.

## What Requires Checking the Code

- Which overload/specialization a call resolves to (conversion ranks, ADL).
- Whether a `constexpr` is actually evaluated at compile time in a given use.
- Whether `auto` deduced a copy or a reference for a hot path.
- Which `-std` is in effect (concepts/CTAD require C++20/17 respectively).
