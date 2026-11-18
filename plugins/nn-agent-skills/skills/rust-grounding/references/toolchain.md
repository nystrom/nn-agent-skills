# Rust Toolchain

The tools an agent invokes or reasons about when building, checking, formatting,
and diagnosing Rust: `rustup`, `cargo`, `clippy`, `rustfmt`, `rust-analyzer`, and
`miri`. Getting the command and its effect right matters — `cargo check` and
`cargo build` are not interchangeable, and Clippy is not the compiler.

---

## rustup Manages Toolchains

`rustup` installs and switches toolchains (stable/beta/nightly) and components.

```bash
rustup update
rustup default stable
rustup toolchain install nightly
rustup component add clippy rustfmt rust-src
cargo +nightly build          # one-off: use nightly for this command
```

A `rust-toolchain.toml` pins a toolchain per project. Nightly is required for
`#![feature(...)]` gates; stable rejects them.

---

## cargo: check vs build vs test vs run

- `cargo check` — type-checks and borrow-checks **without** producing a binary.
  Fastest way to get compiler errors. Use it for a quick "does it compile" loop.
- `cargo build` — compiles and links artifacts (`--release` for optimized).
- `cargo test` — builds and runs unit/integration/doc tests.
- `cargo run` — builds then runs the binary.
- `cargo clippy` — runs the linter (see below); accepts the same target flags.

```bash
cargo check --all-targets
cargo build --release
cargo test -- --nocapture       # show println! from tests
```

Debug vs release matters beyond speed: integer overflow panics in debug and wraps
in release (see sharp-edges).

---

## Clippy Is a Linter, Not the Compiler

`cargo clippy` runs `rustc` with several hundred extra lints for idiom, correctness,
and performance. It does not change what compiles; it flags patterns.

```bash
cargo clippy --all-targets --all-features -- -D warnings   # fail on any lint
```

Silence a specific lint locally with `#[allow(clippy::needless_return)]`. Clippy
suggestions are advisory; `rustc` errors are not. `cargo clippy --fix` applies
machine-applicable suggestions.

---

## rustfmt Formats

`cargo fmt` rewrites code to the standard style; `cargo fmt --check` verifies
without writing (use in CI). Configured by `rustfmt.toml`. Formatting is
orthogonal to correctness — it never changes behavior.

---

## rust-analyzer for IDE Analysis

`rust-analyzer` is the language server (completions, go-to-def, inline errors,
type hints). It is what an editor uses; it is not a CLI you run in a build. Its
diagnostics mirror `cargo check` but update live.

---

## miri Detects Undefined Behavior

`cargo +nightly miri test` runs code in an interpreter that detects many classes
of undefined behavior in `unsafe` code (out-of-bounds, use-after-free, invalid
alignment, data races, uninitialized reads). It is the tool to reach for when an
`unsafe` block is suspect. Nightly-only.

```bash
rustup +nightly component add miri
cargo +nightly miri test
```

---

## Diagnosing Errors

- `rustc --explain E0382` — long-form explanation of an error code (e.g. E0382
  "borrow of moved value").
- `cargo build --message-format=short` — terse errors.
- `RUST_BACKTRACE=1` — backtrace on panic at runtime.
- Compiler errors are precise and suggest fixes; read the note/help lines rather
  than guessing.

---

## What an Agent May Safely Infer

- `cargo check` type-checks without linking; `cargo build` produces artifacts.
- Clippy is an advisory linter; only `rustc` errors block compilation.
- `cargo fmt` and Clippy never change program behavior (fmt is pure style).
- Nightly is required for `#![feature(...)]` and for `miri`.
- `rustc --explain E<code>` and `RUST_BACKTRACE=1` are the built-in diagnostics.

## What an Agent Must Not Infer Without Evidence

- That `cargo build` is needed just to see compile errors — `cargo check` is faster.
- That a Clippy lint is a compile error — it is advisory unless `-D warnings`.
- That `miri` runs on stable — it is nightly-only.
- That `rustfmt` or Clippy can change semantics — they do not.
- That a `#![feature(...)]` gate works on the stable toolchain.

## What Requires Checking the Code

- The active toolchain (`rustup show`, `rust-toolchain.toml`) when a feature fails.
- Whether CI treats warnings as errors (`-D warnings`) — changes what "passes".
- Whether an `unsafe` block should be run under `miri`.
- The build profile (debug/release) when behavior (e.g. overflow) is in question.
