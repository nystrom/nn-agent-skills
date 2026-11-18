---
name: rust-grounding
description: >-
  Authoritative grounding in real Rust semantics for coding agents: ownership,
  moves, and borrowing; lifetimes and drop; traits, generics vs `dyn`, and
  coherence; editions (2015/2018/2021/2024) versus release-gated features; the
  cargo/clippy/rustfmt/miri toolchain; cargo packaging and semver; and the sharp
  edges (overflow, `unwrap`, `unsafe`, `as` casts). Read before reasoning about,
  explaining, or editing Rust — the borrow checker, move-by-default, and the
  edition/release split defeat pattern-matching from GC'd or C++-like languages.
  Pull the topic reference that matches the question.
---

# Rust grounding

Ground yourself in what Rust actually does — no garbage collector, single
ownership, borrows checked at compile time — before editing or explaining it.
Values move by default, safe code cannot race, and "which edition" is a different
question from "which release." Read the reference that matches your question:

| Question | Read |
|----------|------|
| Ownership, moves, borrowing, lifetimes, drop, interior mutability, `?`, match, iterators | `references/semantics.md` |
| Traits vs classes, generics vs `dyn`, object safety, associated types, coherence/orphan rule, `Option`/`Result` | `references/types.md` |
| Footguns: integer overflow (debug vs release), `unwrap`/panics, `as` truncation, moves into closures, `unsafe` | `references/sharp-edges.md` |
| Editions 2015/2018/2021/2024 vs release-gated features; what changed when; migration | `references/versions.md` |
| cargo (`check`/`build`/`test`), clippy, rustfmt, rust-analyzer, miri; diagnosing errors | `references/toolchain.md` |
| Crates/packages/workspaces, `Cargo.toml` vs `Cargo.lock`, semver caret rules, features, `cargo add` | `references/packages.md` |

## Grounding the Active Version

Whenever writing, editing, or explaining Rust code, you **MUST** first determine the active Rust edition and compiler version to reference correct features and APIs.

To detect the active Rust version and environment:
1. Check `Cargo.toml` for the `edition` key (e.g. `edition = "2021"`) or the `rust-version` minimum bound under `[package]`.
2. If still unresolved, run:
   ```bash
   rustc --version
   ```

## What an agent must not infer

Do not reason about Rust as if it were garbage-collected (Java, Go, Python) or as
if moves leave a usable value (C++). A moved-from binding is unusable; references
do not keep values alive; drop is deterministic at scope end. Do not assume a
feature needs a particular edition — most features are release-gated and work on
all editions; only specific surface changes are edition-level. Do not assume
`unsafe` disables the borrow checker, that overflow is silent, or that a trait
can be used as `dyn`. Each reference has a "What an agent may/must not infer"
section — consult it rather than pattern-matching across languages or versions.
