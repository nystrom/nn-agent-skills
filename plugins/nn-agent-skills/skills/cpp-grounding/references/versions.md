# C++ Standard Versions

C++ evolves on a 3-year cadence: C++11, 14, 17, 20, 23, and C++26 (in progress).
The version is selected per translation unit with `-std=`, and **which features
you can use depends on both the standard and the compiler's support for it** —
these are separate facts. Modules and coroutines, for example, are standardized
but unevenly implemented. Attributing a feature to the wrong standard, or assuming
a standard's features are universally available, is the most common version error.

---

## What Each Standard Added (headline features)

**C++11** — `auto`, lambdas, rvalue references and move semantics, `nullptr`,
range-based `for`, `enum class`, `= default`/`= delete`, uniform `{}` init,
variadic templates, `constexpr`, `std::unique_ptr`/`shared_ptr`, `std::thread`,
`<atomic>`, `std::make_shared`.

**C++14** — generic (polymorphic) lambdas, relaxed `constexpr`, variable
templates, `std::make_unique`, binary literals, `[[deprecated]]`.

**C++17** — structured bindings, `if constexpr`, `std::optional`/`variant`/`any`,
`std::string_view`, fold expressions, class template argument deduction (CTAD),
inline variables, **guaranteed copy elision**, `if`/`switch` init-statements,
`std::filesystem`, parallel algorithms, nested namespace `a::b::c`.

**C++20** — concepts, ranges, modules, coroutines, the spaceship operator `<=>`,
`consteval`/`constinit`, designated initializers, `std::span`, `std::format`,
calendar/time-zone `<chrono>`, `[[likely]]`/`[[unlikely]]`.

**C++23** — `std::expected`, `std::mdspan`, `std::print`/`std::println`,
`std::flat_map`/`flat_set`, deducing `this` (explicit object parameter),
`if consteval`, `std::generator`, `std::ranges` additions, `[[assume]]`.

**C++26** — *in progress, not finalized.* Expected/accepted work includes static
reflection, contracts, and `std::execution` (senders/receivers), plus pack
indexing. Treat any C++26 feature as tentative and compiler-gated until the
standard is ratified and your compiler documents support.

---

## Selecting a Standard

```bash
clang++ -std=c++17 a.cpp
clang++ -std=c++20 a.cpp
clang++ -std=c++23 a.cpp
clang++ -std=c++2c a.cpp     # C++26 (also -std=c++26 on recent compilers)
```

`gnu++NN` variants enable GNU extensions. The **default** `-std` depends on the
compiler version and is not the latest — always set `-std` explicitly rather than
assume. Check `__cplusplus` (e.g. `201703L` for C++17, `202002L` for C++20,
`202302L` for C++23) to detect the active standard in code.

---

## Support Is Not Uniform With the Standard

- **Modules** (C++20) are standardized but implementation and build-system support
  has lagged for years; do not assume `import std;` works everywhere.
- **Coroutines** (C++20) are in the language but the standard library gave few
  ready-made types until later; `std::generator` is C++23.
- Library features may trail language features within the same compiler release.
- `<print>`, `<expected>`, `<mdspan>` (C++23) require a recent enough libc++/libstdc++.

Check the compiler/library version, not just the `-std` flag.

---

## What an Agent May Safely Infer

- Structured bindings, `if constexpr`, `std::optional`, `string_view`, CTAD are C++17.
- Concepts, ranges, `<=>`, `std::span`, `std::format`, coroutines are C++20.
- `std::expected`, `std::print`, `std::mdspan`, deducing `this` are C++23.
- The active standard is selected by `-std=` and observable via `__cplusplus`.
- C++26 is not finalized; its features are tentative and compiler-gated.

## What an Agent Must Not Infer Without Evidence

- That a standard's features are available just because `-std` names it — the
  compiler/library must implement them (modules and coroutines especially).
- That `std::format`/`std::print` or `std::expected` exist pre-C++20/23.
- That the compiler's default `-std` is the latest standard — it usually is not.
- That a C++26 feature is stable and portable — the standard is still in progress.
- That a feature is C++11 just because it "feels old" — e.g. `make_unique` is C++14,
  structured bindings are C++17.

## What Requires Checking the Code

- The `-std` flag actually used to build the translation unit.
- The compiler and standard-library versions (feature support, not just `-std`).
- `__cplusplus` / `__cpp_*` feature-test macros for a precise capability check.
- Whether module/coroutine support is real in the target toolchain.
