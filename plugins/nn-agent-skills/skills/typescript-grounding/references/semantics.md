# TypeScript Semantics Reference

Use this reference to reason about what TypeScript code *means to the checker*,
not just what it looks like. TypeScript is a **structural**, **gradually typed**
layer over JavaScript whose types are **erased** before execution. The checker
proves properties about types; the runtime is plain JavaScript. An edit is safe
only if it is sound under both.

---

## Type Erasure: Types Do Not Exist at Runtime

All type annotations, interfaces, type aliases, generics, and `as` assertions are
**removed** during compilation. Nothing about them survives to run time.

```typescript
interface User { id: number; name: string; }

function isUser(x: unknown): x is User {
  // WRONG: `x instanceof User` — User is a type, not a value; this is a compile error.
  // You must check structure at runtime yourself:
  return typeof x === "object" && x !== null && "id" in x && "name" in x;
}
```

Consequences an agent must respect:
- There is **no reflection** over erased types. You cannot enumerate an
  interface's fields, branch on a generic type parameter `T`, or check
  `x instanceof SomeInterface`.
- `instanceof` works only on values with a runtime constructor (classes,
  built-ins), not on interfaces or type aliases.
- Generic type parameters are erased: `function f<T>(){ return T }` is illegal;
  `T` has no runtime value.

---

## Structural Typing, Not Nominal

Compatibility is by **shape**, not by name or declared inheritance. Two unrelated
types with matching members are assignable.

```typescript
interface Point { x: number; y: number; }
class Vec2 { constructor(public x: number, public y: number) {} }

const p: Point = new Vec2(1, 2);   // OK — Vec2 has x and y
const q: Point = { x: 1, y: 2 };   // OK — object literal has the right shape
```

This differs from Java/C# (nominal). A function expecting `Point` accepts
*anything* with an `x: number` and `y: number`. To get nominal-like behavior, add
a private field or a branded property (see `sharp-edges.md`).

---

## Type Space vs Value Space

A single identifier can name a type, a value, or both, living in **separate
namespaces**. `class` and `enum` declarations introduce both; `interface` and
`type` are type-space only; `const`/`let`/`function` are value-space only.

```typescript
class C {}                 // C is a type AND a value (the constructor)
interface I { x: number }  // I is a type only
const v = { x: 1 };        // v is a value only

type T1 = C;               // type position: the instance type of C
const c = C;               // value position: the constructor function
type T2 = typeof v;        // `typeof` in TYPE space reads a value's type: { x: number }
```

`typeof` is overloaded: in **value** space it is the JS runtime operator; in
**type** space it produces the static type of a value. Indexed access `T["k"]`
and `keyof T` operate in type space only.

---

## Control-Flow Narrowing

Within a scope, the checker narrows a variable's type along control flow using
guards. This is how unions become usable.

```typescript
function f(x: string | number | null) {
  if (x == null) return;          // narrows out null AND undefined (loose ==)
  if (typeof x === "string") {
    x.toUpperCase();              // x: string here
  } else {
    x.toFixed(2);                 // x: number here
  }
}
```

Narrowing mechanisms: `typeof`, `instanceof`, `in`, equality against literals,
truthiness, `Array.isArray`, and **user-defined type guards** (`x is T`) and
**assertion functions** (`asserts x is T`).

```typescript
function assertString(x: unknown): asserts x is string {
  if (typeof x !== "string") throw new Error("not a string");
}
```

**Discriminated unions** narrow on a shared literal tag — the idiomatic modeling
tool:

```typescript
type Shape =
  | { kind: "circle"; r: number }
  | { kind: "rect"; w: number; h: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return Math.PI * s.r ** 2;   // s: circle branch
    case "rect":   return s.w * s.h;            // s: rect branch
  }
}
```

Narrowing is **reset** across function boundaries: a closure capturing a narrowed
variable sees the declared (wider) type, because the compiler cannot prove the
value was not reassigned before the closure runs.

---

## Assignability and Excess Property Checks

Assignability is structural subtyping: `A` is assignable to `B` if `A` has (at
least) all of `B`'s required members with compatible types. Extra members are
normally fine — **except** for *fresh* object literals, which get an **excess
property check**:

```typescript
interface Opts { width: number; }

const a: Opts = { width: 5, height: 9 };   // ERROR: 'height' does not exist in Opts
const tmp = { width: 5, height: 9 };
const b: Opts = tmp;                        // OK — not a fresh literal, extra prop allowed
```

The excess-property check is a targeted lint against typos, not a soundness rule;
it only fires on object literals assigned directly.

---

## Widening and Literal Types

`const` bindings infer the **literal** type; `let`/`var` and mutable positions
widen to the base type.

```typescript
const a = "hello";   // type: "hello" (literal)
let   b = "hello";   // type: string  (widened)

const obj = { k: "v" };   // type: { k: string } — object properties widen
const frozen = { k: "v" } as const;   // type: { readonly k: "v" } — no widening
```

`as const` freezes literal types deeply and makes members `readonly` — essential
for tuples and discriminant tags.

---

## Declaration Merging

Some declarations with the same name **merge** rather than conflict. Interfaces
merge their members; namespaces merge; a namespace can merge into a function or
class to add static-like members. Module augmentation extends existing modules.

```typescript
interface Box { a: number; }
interface Box { b: number; }
// Box is now { a: number; b: number }

// Module augmentation (add to a third-party type):
declare module "some-lib" {
  interface Config { extra?: string; }
}
```

`type` aliases do **not** merge — a duplicate `type` name is an error. This
asymmetry between `interface` and `type` matters when designing extensible APIs.

---

## `this` Typing

`this` inside a function has a type, and TypeScript checks it. Methods bind `this`
to the instance; standalone functions have `this: void` under
`strictBindCallApply`/`noImplicitThis`. A function can declare a fake first
parameter `this` to constrain its call site:

```typescript
function handler(this: HTMLElement, ev: Event) {
  this.innerHTML = "";   // `this` is typed; erased at runtime
}
```

The `this` parameter is erased and does not affect the runtime signature.

---

## What an Agent May Safely Infer

- Types are erased: no runtime type checks come for free; validate structurally.
- Compatibility is structural — a matching shape is assignable regardless of name.
- `const` infers literal types; mutable bindings widen; `as const` prevents widening.
- Interfaces merge; `type` aliases do not.
- Discriminated unions + `switch` on the tag is the sound way to narrow.

## What an Agent Must Not Infer Without Evidence

- That `instanceof` or reflection can distinguish interface types at runtime — it
  cannot; interfaces have no runtime footprint.
- That an object annotated with a type has *only* that type's properties — extra
  properties survive at runtime; the excess-property check only fires on fresh
  literals.
- That narrowing persists into a nested closure — it is reset to the declared type.
- That two structurally identical types are "different" because they have
  different names — they are interchangeable unless branded.

## What Requires Whole-Program Analysis

- Whether a value flowing from `JSON.parse`/`any` actually matches its asserted
  type — the assertion is unchecked.
- Whether a captured variable is reassigned before a closure runs (defeating
  narrowing).
- Whether a module augmentation elsewhere changes the shape of an imported type.
