---
name: cpp-grounding
description: >-
  Authoritative grounding in real C++ semantics for coding agents: value
  semantics and RAII, value categories and move semantics, the rule of 0/3/5,
  templates and overload resolution, undefined behavior (signed overflow,
  dangling refs, iterator invalidation, uninitialized reads), the standard
  versions C++11 through 23 (and C++26 in progress), and the compiler/sanitizer/
  CMake toolchain. Read before reasoning about, explaining, or editing C++ — the
  language has deterministic destruction and value semantics unlike GC'd
  languages, no memory-safety net, and behavior that depends on the `-std` flag
  and compiler. Pull the topic reference that matches the question.
---

# C++ grounding

Ground yourself in what C++ actually does — value semantics by default,
deterministic destruction (RAII), and no safety net for undefined behavior —
before editing or explaining it. A program can exhibit UB and still appear to
work; the compiler will not stop you, and behavior depends on the `-std` and the
compiler. Read the reference that matches your question:

| Question | Read |
|----------|------|
| Value semantics, RAII, value categories, move, rule of 0/3/5, copy elision, initialization, most-vexing-parse | `references/semantics.md` |
| Templates, `const`/`constexpr`/`consteval`, references vs pointers, smart pointers, `auto`/CTAD, ADL, concepts | `references/types.md` |
| Undefined behavior: signed overflow, dangling refs/iterators, uninitialized reads, narrowing, `nullptr`, moved-from | `references/sharp-edges.md` |
| What each standard added (C++11–23, C++26 in progress); `-std`; support vs standard | `references/versions.md` |
| Compilers and flags, sanitizers (ASan/UBSan/TSan), CMake, clang-format/clang-tidy, debugging | `references/toolchain.md` |

## Grounding the Active Version

Whenever writing, editing, or explaining C++ code, you **MUST** first determine the active C++ standard and compiler version to reference correct features and APIs.

To detect the active C++ version and environment:
1. Check `CMakeLists.txt` for the `CMAKE_CXX_STANDARD` setting (e.g. `set(CMAKE_CXX_STANDARD 17)`).
2. Look at build configuration files (like `Makefile`, `meson.build`, or compiler flags in `.clang-tidy`).
3. If still unresolved, run:
   ```bash
   g++ --version
   # or when using clang:
   clang++ --version
   ```

## What an agent must not infer

Do not reason about C++ as if it were garbage-collected or reference-typed (Java,
C#, Python): objects are values, copied by default, destroyed deterministically at
scope end. Do not assume "it compiles and runs" means correct — undefined behavior
(signed overflow, dangling references, uninitialized reads, data races) has no
diagnostic and may work until it disastrously does not; use sanitizers to catch it.
Do not attribute a feature to the wrong standard, or assume a standard's features
are available without checking compiler/library support (modules and coroutines
especially). Each reference has a "What an agent may/must not infer" section —
consult it rather than pattern-matching across languages or standards.
