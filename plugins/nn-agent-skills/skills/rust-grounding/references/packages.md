# Rust Packages and Cargo

How Rust code is organized and depended upon: crates, packages, workspaces, and
the `Cargo.toml`/`Cargo.lock` split. Cargo's semver rules and the manifest/lockfile
distinction trip up agents that pattern-match from npm or pip.

---

## Crate vs Package vs Module

- A **module** (`mod`) is a namespace within a crate.
- A **crate** is a compilation unit: one library crate and/or binary crates.
- A **package** is what `Cargo.toml` describes: one or more crates published/built
  together. A package has at most one library crate.

`use` paths reference modules and items; `[dependencies]` reference packages
(by their crate name).

---

## `Cargo.toml` vs `Cargo.lock`

- `Cargo.toml` — the manifest you edit: dependency **requirements** (version
  ranges), metadata, features, profiles.
- `Cargo.lock` — generated: the exact resolved versions. Commit it for binaries/
  applications; for libraries it is conventionally not relied upon by consumers
  (their resolver re-resolves). Never hand-edit the lockfile.

```toml
[dependencies]
serde = "1.0"                 # caret by default: >=1.0.0, <2.0.0
rand = { version = "0.8", features = ["small_rng"] }
mycrate = { path = "../mycrate" }
otherdep = { git = "https://github.com/x/y", tag = "v1.2.3" }
```

---

## Semver: The Caret Default

A bare version string is a **caret** requirement: it allows updates that do not
change the left-most non-zero version component.

```toml
serde = "1.2.3"    # means ^1.2.3  → >=1.2.3, <2.0.0
img   = "0.8.1"    # means ^0.8.1  → >=0.8.1, <0.9.0   (0.x: minor is breaking)
tiny  = "0.0.3"    # means ^0.0.3  → >=0.0.3, <0.0.4
```

Note the `0.x` rule: for pre-1.0 crates the **minor** version is the breaking
boundary. `=1.2.3` pins exactly; `~1.2` and `>=`/`<` are also available.

---

## Adding and Managing Dependencies

```bash
cargo add serde --features derive     # edits Cargo.toml, picks a compatible version
cargo add tokio@1.35
cargo update                           # update within the manifest's ranges, rewrites lock
cargo update -p serde --precise 1.0.150
cargo tree                             # show the dependency graph
cargo remove serde
```

`cargo add` (built in since 1.62) is preferred over hand-editing `[dependencies]`
because it resolves a valid version and feature set.

---

## Features Are Additive

Cargo features are compile-time flags that should be **additive** — enabling a
feature must not remove or change existing API, because the resolver unions the
features requested across the whole graph.

```toml
[features]
default = ["std"]
std = []
serde = ["dep:serde"]
```

`--no-default-features` disables the `default` set; `--all-features` enables all.
Designing a feature to be subtractive (mutually exclusive with another) breaks
under feature unification and is an anti-pattern.

---

## Workspaces

A workspace groups multiple packages under one `Cargo.lock` and `target/`.

```toml
# top-level Cargo.toml
[workspace]
members = ["app", "core", "utils"]
resolver = "2"

[workspace.dependencies]
serde = "1.0"          # members reference with serde = { workspace = true }
```

`resolver = "2"` (default for edition 2021+) changes feature unification so a
build-dependency's features do not leak into the normal build. Prefer it.

---

## Publishing

`cargo publish` uploads to crates.io (immutable — versions cannot be overwritten,
only yanked with `cargo yank`). `cargo package` builds the `.crate` locally to
inspect first. A crate name on crates.io is globally unique and first-come.

---

## What an Agent May Safely Infer

- A bare version string is a caret requirement; for `0.x`, minor is the breaking bump.
- `Cargo.toml` holds requirements; `Cargo.lock` holds resolved versions and is generated.
- `cargo add`/`cargo update`/`cargo tree` manage dependencies; do not hand-edit the lock.
- Features are additive and unified across the graph; `resolver = "2"` is the modern default.
- crates.io versions are immutable (yank, not delete/overwrite).

## What an Agent Must Not Infer Without Evidence

- That `"1.0"` pins exactly — it is `^1.0` (allows `<2.0.0`). Use `=1.0.0` to pin.
- That `0.8` allows `0.9` — pre-1.0, `0.9` is a breaking change and excluded.
- That the lockfile should be edited by hand, or that libraries pin via their lock.
- That a feature can be subtractive/mutually exclusive — features must be additive.
- That npm/pip semantics (tilde defaults, dev/peer deps) apply — Cargo differs.

## What Requires Checking the Code

- The actual resolved version in `Cargo.lock` vs the range in `Cargo.toml`.
- Which features are enabled across the whole graph (`cargo tree -f` / `-e features`).
- Whether the workspace uses `resolver = "2"` (affects feature unification).
- Whether a dependency is a normal, dev, or build dependency.
