# Rust Types and Traits

Rust's type system: traits (not classes) for shared behavior, generics resolved
by monomorphization, and a coherence system that governs where implementations
may live. Rust has no inheritance and no runtime type reflection. Modeling traits
as Java/C# interfaces or C++ virtual classes leads to wrong assumptions about
dispatch, coherence, and object safety.

---

## Traits Are Not Classes; No Inheritance

A trait defines behavior; types `impl` it. There is no class hierarchy and no
field inheritance. A "supertrait" bound (`trait Ord: Eq`) requires the other
trait but does not inherit fields or provide subtyping.

```rust
trait Area { fn area(&self) -> f64; }
struct Circle { r: f64 }
impl Area for Circle { fn area(&self) -> f64 { std::f64::consts::PI * self.r * self.r } }
```

Default methods live in the trait; a type overrides them by providing its own.

---

## Generics Monomorphize; `dyn` Dispatches Dynamically

`impl Trait` / `<T: Trait>` generics are **monomorphized**: the compiler emits a
separate specialized copy per concrete type — static dispatch, zero runtime cost,
larger binary. `dyn Trait` is a trait object: a fat pointer (data + vtable) with
**dynamic** dispatch.

```rust
fn draw_static<T: Area>(x: &T) { x.area(); }        // monomorphized per T
fn draw_dyn(x: &dyn Area) { x.area(); }             // vtable dispatch
let shapes: Vec<Box<dyn Area>> = vec![Box::new(Circle { r: 1.0 })];
```

Choose `dyn` for heterogeneous collections; generics for performance and where
the concrete type is known.

---

## Object Safety Limits `dyn`

Only **object-safe** traits can be `dyn`. A trait is not object-safe if it has
generic methods, methods returning `Self` by value, or `Self`-typed parameters
beyond the receiver, or associated constants.

```rust
trait Clone2 { fn clone2(&self) -> Self; }   // returns Self by value
// let x: &dyn Clone2 = ...;                  // ERROR: not object-safe
```

This is why `Clone` cannot be used as `dyn Clone`. Static generics have no such
restriction.

---

## Associated Types vs Generic Parameters

An associated type is an output type fixed per impl; a generic trait parameter
allows many impls per type.

```rust
trait Iterator { type Item; fn next(&mut self) -> Option<Self::Item>; }
// one Item per implementing type

trait From<T> { fn from(t: T) -> Self; }
// many From<T> impls per type, one per source T
```

Use an associated type when there is exactly one sensible output; use a type
parameter when multiple impls make sense.

---

## Coherence and the Orphan Rule

There is at most one impl of a trait for a type (coherence). The **orphan rule**
requires that either the trait or the type be local to your crate, so you cannot
`impl ExternalTrait for ExternalType`.

```rust
// impl Display for Vec<i32> {}   // ERROR: both Display and Vec are foreign
struct Wrapper(Vec<i32>);         // newtype: now the type is local
impl std::fmt::Display for Wrapper { /* ... */ }
```

The newtype pattern is the standard workaround. This rule is why adding a trait
impl in a dependency can be a breaking change.

---

## `Option` and `Result` Replace Null and Exceptions

There is no `null` and no exceptions. Absence is `Option<T>` (`Some`/`None`);
recoverable failure is `Result<T, E>` (`Ok`/`Err`). Both must be handled to get
the inner value.

```rust
let x: Option<i32> = map.get(&k).copied();
let n = x.unwrap_or(0);        // explicit fallback, not a silent default
```

`unwrap`/`expect` extract by panicking on the empty case — acceptable in tests
and truly-impossible cases, a footgun in library code.

---

## `impl Trait` in Argument and Return Position

`fn f(x: impl Trait)` is sugar for a generic parameter. `fn f() -> impl Trait`
returns one concrete but unnamed type (useful for closures/iterators). A function
returning `impl Trait` cannot return two different concrete types on different
branches.

```rust
fn nums() -> impl Iterator<Item = i32> { (0..3).map(|x| x * 2) }
// two different closure types on two branches would NOT compile with -> impl
```

---

## Generic Bounds and `where`

Bounds constrain what a generic can be. `where` clauses express the same bounds
more legibly for complex cases; they do not change semantics.

```rust
fn print_all<T>(xs: &[T]) where T: std::fmt::Debug {
    for x in xs { println!("{x:?}"); }
}
```

Without the `Debug` bound, `{x:?}` would not compile — you may only use
capabilities the bounds guarantee.

---

## What an Agent May Safely Infer

- Traits provide behavior, not inheritance; there is no class hierarchy or fields in traits.
- Generics are monomorphized (static dispatch); `dyn Trait` is a vtable (dynamic).
- Only object-safe traits can be `dyn`; `Clone` and generic-method traits cannot.
- One trait impl per type (coherence); orphan rule needs a local trait or type.
- `Option`/`Result` replace null/exceptions and must be handled explicitly.

## What an Agent Must Not Infer Without Evidence

- That you can `impl` a foreign trait for a foreign type (orphan rule forbids it).
- That `dyn Trait` works for any trait (object safety restricts it).
- That trait methods dispatch dynamically by default — generics are static.
- That there is runtime reflection or downcasting (only `Any` offers limited downcast).
- That returning `impl Trait` allows different concrete types per branch.

## What Requires Checking the Code

- Which concrete type an `impl Trait` return actually is.
- Whether a trait is object-safe (inspect its method signatures).
- Whether a generic's bounds permit the operation being attempted.
- Whether an orphan-rule violation needs a newtype wrapper.
