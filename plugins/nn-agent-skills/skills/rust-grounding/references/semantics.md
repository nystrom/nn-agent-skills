# Rust Semantics

How Rust actually evaluates, moves, and borrows — the model behind the borrow
checker. Rust has no garbage collector and no runtime object graph: every value
has a single owner, and the compiler enforces at compile time that references
never outlive what they point to. Reasoning about Rust by analogy to a
GC'd language (Java, Go, Python) or to C++ move semantics produces code that does
not compile or that misrepresents what the program does.

---

## Ownership and Move by Default

Assignment and passing by value **move** ownership for non-`Copy` types. The
source binding is then invalid — this is a compile error, not a runtime one.

```rust
let a = String::from("hi");
let b = a;              // a is moved into b
println!("{a}");        // ERROR: borrow of moved value: `a`
```

Types that are `Copy` (all integers, `bool`, `char`, `f64`, shared references
`&T`, and tuples/arrays of `Copy` types) are duplicated bitwise instead of moved,
so the original stays valid. `String`, `Vec<T>`, `Box<T>`, and anything owning a
resource are **not** `Copy`. This is unlike C++, where a "moved-from" object is
still a usable (if unspecified) value — in Rust the moved-from binding cannot be
used at all.

---

## Borrowing: Shared XOR Mutable

References are borrows checked at compile time. The core rule: at any point a
value has **either** any number of shared references `&T` **or** exactly one
mutable reference `&mut T`, never both.

```rust
let mut v = vec![1, 2, 3];
let r = &v[0];          // shared borrow of v
v.push(4);              // ERROR: cannot borrow `v` as mutable ... already borrowed as immutable
println!("{r}");
```

Borrows end at last use (non-lexical lifetimes), not at end of scope, so the
above compiles if `r` is not used after `push`. This aliasing rule is what makes
data races impossible in safe Rust; it is not a style guideline.

---

## Lifetimes Describe, They Do Not Extend

A lifetime `'a` is a compile-time region during which a reference is valid.
Annotations *describe* relationships the compiler must verify; they never keep a
value alive or change runtime behavior.

```rust
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}
```

Returning a reference to a local is rejected because the local is dropped at
function end — no annotation can fix that; you must return an owned value.

---

## Drop Is Deterministic

A value is dropped (its `Drop::drop` run, memory freed) when its owner goes out
of scope, in reverse declaration order. This is deterministic RAII, not
finalization: there is no GC pause and no nondeterministic collection.

```rust
{
    let _f = File::open("x")?;   // opened
}                                // _f dropped here: file closed, deterministically
```

You cannot call `.drop()` manually; use `std::mem::drop(x)` to drop early. Moving
a value transfers the drop responsibility to the new owner.

---

## Interior Mutability Moves the Check to Runtime

`Cell<T>` and `RefCell<T>` allow mutation through a shared reference by enforcing
the borrow rule dynamically instead of statically. `RefCell` **panics** if you
violate it at runtime.

```rust
let c = RefCell::new(5);
let a = c.borrow_mut();
let b = c.borrow_mut();   // compiles, but PANICS at runtime: already borrowed
```

This is the escape hatch for patterns the static checker cannot prove safe
(graphs, shared mutable state). `Rc<RefCell<T>>` is the common single-threaded
shared-mutable pattern; `Arc<Mutex<T>>` is its thread-safe analog.

---

## `?` Propagates Errors by Early Return

`?` on a `Result` returns the `Err` from the enclosing function (applying `From`
conversion); on `Ok` it unwraps the value. It is control flow, not an assertion.

```rust
fn read() -> Result<String, io::Error> {
    let mut s = String::new();
    File::open("x")?.read_to_string(&mut s)?;   // returns Err early on failure
    Ok(s)
}
```

`?` also works on `Option` (returns `None`). The function's return type must be
`Result`/`Option` (or `impl Try`), or it will not compile.

---

## Pattern Matching Is Exhaustive

`match` must cover every case; a missing variant is a compile error. This is a
correctness feature, not a lint.

```rust
match opt {
    Some(x) => x,
    None => 0,
    // omitting None => ERROR: non-exhaustive patterns
}
```

`if let` / `let ... else` handle single-pattern cases. Matches move or borrow the
scrutinee depending on the binding mode; `ref`/`&` patterns control this.

---

## Iterators Are Lazy

Iterator adapters (`map`, `filter`, `take`) do nothing until consumed by a
terminal operation (`collect`, `sum`, `for`, `count`). Building an adapter chain
has no effect on its own.

```rust
let it = (0..).map(|x| x * 2);   // infinite, but nothing runs yet
let first: Vec<_> = it.take(3).collect();   // [0, 2, 4] — evaluated here
```

`for x in v` moves `v`; `for x in &v` borrows. Ranges, `map`, etc. are
zero-cost — they monomorphize to the equivalent loop.

---

## What an Agent May Safely Infer

- Non-`Copy` values move on assignment/pass; the source binding becomes unusable.
- Safe code cannot have a data race: shared-XOR-mutable is enforced at compile time.
- Drop runs deterministically at scope end, in reverse order; no GC.
- `?` is an early-return on `Err`/`None`; the enclosing return type must allow it.
- `match` is exhaustive; iterator adapters are lazy until a terminal consumer.

## What an Agent Must Not Infer Without Evidence

- That a value is usable after being moved (unlike C++'s valid-but-unspecified state).
- That references behave like GC'd pointers that keep data alive — they do not.
- That `RefCell` borrows are checked at compile time — they panic at runtime.
- That lifetime annotations change runtime behavior or extend a value's life.
- That a type is `Copy` — most owning types (`String`, `Vec`, `Box`) are not.

## What Requires Checking the Code

- Whether a given type is `Copy` or `Clone` (look at its definition/derives).
- Whether a borrow actually conflicts (NLL ends borrows at last use).
- Whether a `RefCell`/`Mutex` borrow pattern can double-borrow at runtime.
- Which trait's method a call resolves to when multiple are in scope.
