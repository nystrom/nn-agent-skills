# Rust Sharp Edges

Behaviors that most often produce incorrect Rust code or wrong explanations —
places where the compiler's guarantees have surprising boundaries, where behavior
differs between debug and release, and where habits from C, C++, or GC'd languages
mislead. Safe Rust prevents memory unsafety, but it does **not** prevent panics,
logic bugs, deadlocks, or integer overflow surprises.

---

## Integer Overflow: Panic in Debug, Wrap in Release

Arithmetic overflow on a **runtime** value is a **panic** in debug builds and
**two's-complement wrapping** in release builds by default. The same code can
behave differently depending on the profile.

```rust
fn bump(x: u8) -> u8 { x + 1 }   // bump(255): debug panics "attempt to add with overflow"; release wraps to 0
```

If both operands are compile-time constants, the overflow is instead caught at
**compile time** by const evaluation — `let y: u8 = 255 + 1;` does not compile at
all, in any profile. Neither runtime case is silent UB (unlike C), but relying on
either is a bug. Use the explicit methods: `wrapping_add`, `checked_add` (returns
`Option`), `saturating_add`, or `overflowing_add`. Do not assume wrapping.

---

## `as` Casts Truncate Silently

`as` is a lossy, never-failing cast. It truncates, wraps, or saturates depending
on the types, with no error.

```rust
let n = 300_i32 as u8;      // 44 (truncated)
let f = 3.99_f64 as i32;    // 3 (truncates toward zero)
let big = 1e300_f64 as i32; // i32::MAX (saturates, since Rust 1.45)
```

Prefer `TryFrom`/`try_into()` for checked conversions when the value might not fit.

---

## `unwrap` / `expect` Panic

`unwrap()` and `expect()` turn `None`/`Err` into a panic. Convenient in tests and
prototypes, a reliability hazard in library and service code.

```rust
let v: Vec<i32> = vec![];
let first = v.first().unwrap();   // panics: called `Option::unwrap()` on a `None`
let n: i32 = "x".parse().unwrap();// panics on parse error
```

Prefer `?`, `match`, `unwrap_or`, `ok_or`, or `if let`. Indexing (`v[i]`) also
panics out of bounds — use `.get(i)` for a checked `Option`.

---

## Shadowing Is Not Mutation

Rebinding a name with `let` creates a new variable; it does not mutate the old
one and can change type. This is legal and idiomatic, but easy to misread.

```rust
let x = "42";
let x = x.parse::<i32>().unwrap();   // new x: i32, shadows the &str x
let x = x * 2;                        // another new x
```

`let mut x` with reassignment is different — that mutates one binding and cannot
change its type.

---

## Moves Into Closures Surprise

A closure captures by reference by default, but `move` (or a captured non-`Copy`
value used by value) takes ownership. After a `move`, the outer binding is gone.

```rust
let s = String::from("hi");
let f = move || println!("{s}");
// println!("{s}");   // ERROR: s was moved into the closure
```

Spawning threads requires `move` because the closure may outlive the current
frame. A closure capturing a `&mut` holds the borrow for the closure's lifetime.

---

## `&str` vs `String`, `&[T]` vs `Vec<T>`

`String`/`Vec<T>` own heap data; `&str`/`&[T]` are borrowed views. Functions
should usually take the borrowed form (`&str`, `&[T]`) for flexibility; returning
requires ownership.

```rust
fn greet(name: &str) {}          // accepts &String and &str and string literals
let owned: String = "a".to_string() + "b";
greet(&owned);                    // &String coerces to &str (deref coercion)
```

Confusing the two causes needless `.clone()` calls or lifetime errors. `+` on
`String` consumes the left operand (`String + &str`).

---

## Iterator Invalidation Is Prevented, Not Papered Over

You cannot mutate a collection while iterating over it — the borrow checker
rejects it at compile time, rather than allowing it to corrupt state at runtime
(as C++ does).

```rust
let mut v = vec![1, 2, 3];
for x in &v {
    v.push(*x);   // ERROR: cannot borrow `v` as mutable because also borrowed as immutable
}
```

Collect indices/values first, or use `retain`, `drain`, or index-based loops.

---

## Floats Are Not `Ord`

`f64`/`f32` implement `PartialOrd` but not `Ord` (because of `NaN`), so you cannot
`sort()` a `Vec<f64>` directly or use floats as `HashMap`/`BTreeMap` keys.

```rust
let mut v = vec![3.0, 1.0, 2.0];
// v.sort();                         // ERROR: the trait `Ord` is not implemented for f64
v.sort_by(|a, b| a.partial_cmp(b).unwrap());   // works if no NaN
```

`NaN != NaN`, so equality-based logic on floats misbehaves as in any IEEE-754
language.

---

## `unsafe` Narrows, It Does Not Disable

`unsafe` enables five extra operations (deref raw pointers, call `unsafe` fns,
access `union`/`static mut`, impl `unsafe` traits). It does **not** turn off the
borrow checker or type checker. The programmer, not the compiler, guarantees the
invariants; violating them is undefined behavior.

```rust
let p = &x as *const i32;
let v = unsafe { *p };   // only the deref needs unsafe; everything else still checked
```

`unsafe` code can cause UB; safe code cannot. Use `cargo miri` to detect UB in
`unsafe` blocks.

---

## What an Agent May Safely Infer

- Overflow panics in debug and wraps in release; use `checked_`/`wrapping_` for intent.
- `as` truncates/saturates silently; `unwrap`/`expect`/indexing panic.
- Shadowing creates a new binding (can change type); it is not mutation.
- `move` closures take ownership; the outer binding becomes unusable.
- Floats are `PartialOrd` not `Ord`; `NaN` breaks equality and sorting.

## What an Agent Must Not Infer Without Evidence

- That overflow is silent UB (it is not — it panics or wraps deterministically).
- That `unsafe` disables the borrow checker (it only unlocks five operations).
- That safe Rust cannot panic — `unwrap`, indexing, overflow, and asserts all can.
- That `as` performs a checked conversion — use `try_into()` for that.
- That you can mutate a collection while iterating (rejected at compile time).

## What Requires Checking the Code

- Whether a build is debug or release (changes overflow behavior).
- Whether a numeric `as` cast can lose data for the actual value range.
- Whether an `unsafe` block upholds the invariants it relies on (consider `miri`).
- Whether floats in a comparison can be `NaN`.
