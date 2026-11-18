# C++ Toolchain

The tools an agent invokes or reasons about when building and diagnosing C++:
compilers (`clang++`/`g++`/MSVC), the `-std`/warning/optimization flags,
sanitizers, CMake, and the formatters/linters. Unlike single-implementation
languages, C++ behavior and diagnostics vary by compiler and standard-library —
so the compiler and its flags are part of the semantics.

---

## Compilers and Core Flags

```bash
clang++ -std=c++20 -Wall -Wextra -O2 a.cpp -o a
g++     -std=c++23 -Wall -Wextra -Wpedantic a.cpp -o a
clang++ -std=c++20 -fsyntax-only a.cpp     # parse/type-check only, no output
```

- `-std=` selects the language standard (see versions). Set it explicitly.
- `-Wall -Wextra` enable the important warning sets (neither is "all warnings").
  `-Werror` turns warnings into errors.
- `-O0`/`-O2`/`-O3`/`-Os` set optimization; `-g` adds debug info.
- `-fsyntax-only` checks without codegen — the fast "does it compile" loop.

Warnings are not errors by default; UB is generally **not** diagnosed by the
compiler at all (see sanitizers).

---

## Sanitizers Catch UB and Memory Bugs at Runtime

Sanitizers instrument the build to detect at runtime what the type system cannot.

```bash
clang++ -std=c++20 -fsanitize=address,undefined -g a.cpp -o a && ./a
clang++ -std=c++20 -fsanitize=thread -g a.cpp -o a           # data races
```

- **ASan** (`address`) — out-of-bounds, use-after-free, leaks.
- **UBSan** (`undefined`) — signed overflow, null deref, misaligned access, etc.
- **TSan** (`thread`) — data races.

ASan and TSan cannot be combined; ASan+UBSan can. They add overhead, so they are
for testing, not production. This is the primary way to *demonstrate* that code
hits UB rather than merely "seems to work".

---

## CMake Is the De Facto Build System

```cmake
cmake_minimum_required(VERSION 3.20)
project(demo CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(app main.cpp)
target_link_libraries(app PRIVATE somelib)
```

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

`CMAKE_CXX_STANDARD` sets `-std`; `target_compile_features` can require specific
features. Prefer targets and `target_*` commands over global flags.

---

## Formatting and Linting

- `clang-format` — style/formatting (`-i` to edit in place), configured by
  `.clang-format`. Behavior-neutral.
- `clang-tidy` — static analysis and modernization checks
  (`-checks=...`, `--fix` to apply). Flags bugs and non-idiomatic code; advisory.
- `cppcheck` — additional static analysis.

These are separate from the compiler; a clean compile does not mean clang-tidy is
happy, and vice versa.

---

## Debugging

- `lldb` / `gdb` — interactive debuggers; pair with `-g`.
- Sanitizer output already gives file:line for the fault — read it before reaching
  for a debugger.
- `-fno-omit-frame-pointer` improves stack traces under sanitizers/profilers.

---

## What an Agent May Safely Infer

- `-std=` must be set explicitly; the default is not the latest standard.
- `-Wall -Wextra` are not "all" warnings; `-Werror` makes them fatal.
- The compiler does not diagnose most UB; sanitizers (ASan/UBSan/TSan) catch it at runtime.
- `-fsyntax-only` is the fast compile-check; `clang-format`/`clang-tidy` are separate tools.
- CMake `CMAKE_CXX_STANDARD` maps to `-std`; prefer target-based configuration.

## What an Agent Must Not Infer Without Evidence

- That a clean compile means no UB — most UB is invisible without sanitizers.
- That `-Wall` enables every warning, or that warnings block the build by default.
- That behavior is identical across `clang++`/`g++`/MSVC — it can differ, especially at the edges.
- That `clang-tidy` findings are compile errors — they are advisory.
- That ASan and TSan can be enabled together — they cannot.

## What Requires Checking the Code

- The exact compiler, version, and `-std`/`-O` flags used (they change behavior).
- Whether the build/CI runs sanitizers (determines whether UB is being caught).
- Which standard library (libc++ vs libstdc++) is linked, for C++20/23 feature support.
- Whether warnings are treated as errors in the project's build.
