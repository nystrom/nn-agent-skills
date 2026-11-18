# Rust Versions and Editions

Rust has two orthogonal version axes, and confusing them is a common error:

- **Releases** ship every ~6 weeks (1.0 in 2015 → 1.85 Feb 2025 → 1.97 as of mid-2026).
  A release adds stabilized features available to all editions.
- **Editions** (2015, 2018, 2021, 2024) are opt-in per crate via `edition` in
  `Cargo.toml`. An edition can make **breaking** surface changes (new keywords,
  changed defaults) without splitting the ecosystem: crates on different editions
  interoperate. Editions do **not** gate most features — a feature stabilized in a
  release is usually usable on every edition.

Do not say "you need edition 2021 for feature X" unless X is genuinely an
edition-level change (below). Most new capabilities are release-gated, not
edition-gated.

---

## Edition Summary

| Edition | Min release | Headline changes |
|---------|-------------|------------------|
| 2015    | 1.0         | The original; `extern crate`, path rules of the era |
| 2018    | 1.31        | Module path overhaul, `dyn Trait`, `impl Trait`, non-lexical lifetimes, `async`/`await` reserved |
| 2021    | 1.56        | Disjoint closure captures, array `IntoIterator` by value, `TryFrom`/`TryInto`/`FromIterator` in prelude |
| 2024    | 1.85        | `gen` reserved, RPIT precise capturing default, `unsafe extern`/`unsafe` attributes, `static_mut_refs` denied, `Future`/`IntoFuture` in prelude |

---

## Edition 2018 (Rust 1.31, Dec 2018)

- Module system: paths start from crate root or `crate::`/`self::`/`super::`;
  `extern crate` mostly unnecessary.
- `dyn Trait` syntax for trait objects (bare `Trait` deprecated in this position).
- `impl Trait` in argument and return position.
- `async`/`await` became reserved keywords here (the feature itself stabilized
  later, in release 1.39).
- Non-lexical lifetimes (borrows end at last use) became the default.

---

## Edition 2021 (Rust 1.56, Oct 2021)

- **Disjoint closure captures**: a closure captures individual fields it uses, not
  the whole struct. Changes what is borrowed/moved.
- **Array `IntoIterator` by value**: `[1, 2, 3].into_iter()` yields `i32` (owned),
  not `&i32`. In 2015/2018 it yielded references for compatibility.
- Prelude adds `TryFrom`, `TryInto`, `FromIterator`.
- `panic!` macro consistency and disjoint `or` patterns in more positions.

---

## Edition 2024 (Rust 1.85, Feb 2025)

The largest edition since 2018. Key changes:

- `gen` is a **reserved keyword** (for future generator/`gen` blocks); identifiers
  named `gen` must be raw (`r#gen`) on this edition.
- **RPIT precise capturing** default: `-> impl Trait` now captures all in-scope
  generic lifetimes by default; use the `use<...>` bound to restrict.
- `unsafe extern { ... }` blocks and `unsafe` attributes such as
  `#[unsafe(no_mangle)]`.
- References to `static mut` are denied by default (`static_mut_refs` lint → error).
- Prelude adds `Future` and `IntoFuture`.
- `if let` temporary scope and some never-type fallback changes.

---

## Notable Stable Feature Timeline (release-gated, all editions)

| Feature | Stable since |
|---------|--------------|
| `?` operator | 1.13 |
| `impl Trait` (return position) | 1.26 |
| `async`/`await` | 1.39 |
| const generics (minimal) | 1.51 |
| `let ... else` | 1.65 |
| GATs (generic associated types) | 1.65 |
| `async fn`/RPIT in traits (RPITIT) | 1.75 |
| edition 2024 / `gen` reserved | 1.85 |

---

## Migration

`cargo fix --edition` applies mechanical fixes, then bump `edition` in
`Cargo.toml`. Editions are per-crate, so a workspace can migrate crate by crate.
The compiler's edition-migration lints flag what needs manual attention (e.g.
closure-capture or array-iteration behavior that changed meaning).

---

## What an Agent May Safely Infer

- Editions are opt-in per crate and interoperate; they do not fork the ecosystem.
- Most features are release-gated; only the listed surface changes are edition-gated.
- 2021 changed array `.into_iter()` to yield values; 2024 reserved `gen` and
  changed RPIT lifetime capture.
- `cargo fix --edition` handles most migration mechanically.
- The current stable release line is 1.9x (1.97 as of mid-2026), edition 2024.

## What an Agent Must Not Infer Without Evidence

- That a feature requires a specific edition unless it is one of the edition-level
  changes above — most features are release-gated.
- That nightly-only features (specialization, `generic_const_exprs`, full generators)
  are stable — they are not, on any edition.
- That `async`/`await` needs edition 2021 — the keyword was reserved in 2018 and
  the feature stabilized in release 1.39, usable on 2018+.
- That an edition upgrade is required to use a recent stdlib API — check the
  release, not the edition.
- Specific feature-stabilization claims for releases after your knowledge cutoff;
  verify against the release notes.

## What Requires Checking the Code

- The crate's `edition` in `Cargo.toml` (determines closure-capture, array-iter,
  `gen`, RPIT-capture behavior).
- The toolchain version (`rustc --version`) when a feature's availability is in question.
- Whether code uses a nightly `#![feature(...)]` gate (then it is not stable).
