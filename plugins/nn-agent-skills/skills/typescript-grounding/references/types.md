# TypeScript Type System Reference

This reference covers TypeScript's type-level constructs: generics, variance,
conditional types, mapped types, template literal types, and the standard utility
types. All of this is erased at runtime (see `semantics.md`) — it exists to let
the checker prove properties about values.

---

## Generics

Type parameters make declarations reusable while preserving relationships between
inputs and outputs.

```typescript
function first<T>(xs: readonly T[]): T | undefined { return xs[0]; }

const n = first([1, 2, 3]);   // T inferred as number → n: number | undefined
```

**Constraints** restrict a parameter with `extends`; **defaults** supply a
fallback:

```typescript
function pluck<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];   // return type is the exact property type T[K]
}
```

Inference flows from arguments. When it cannot infer (or infers too wide), pass
type arguments explicitly. Prefer letting inference work; over-annotating breaks
it.

---

## Variance

Assignability of generic types depends on how a parameter is used:

- **Covariant** (output positions): `readonly T[]` — `Dog[]` assignable to `Animal[]`.
- **Contravariant** (input positions): function parameters, under
  `strictFunctionTypes`.
- **Bivariant** (unsound, retained for ergonomics): method parameters and
  mutable array element assignment.

```typescript
declare let animals: Animal[];
declare let dogs: Dog[];
animals = dogs;   // allowed — arrays are covariant, but this is UNSOUND:
animals.push(new Cat());   // now `dogs` contains a Cat at runtime
```

Array covariance and method-parameter bivariance are deliberate holes; see
`sharp-edges.md`. Since 4.7, `in`/`out` variance annotations let you mark
parameters explicitly.

---

## `keyof`, Indexed Access, and `typeof`

```typescript
interface User { id: number; name: string; }

type Keys = keyof User;        // "id" | "name"
type IdType = User["id"];      // number
type Both = User[keyof User];  // number | string

const config = { host: "x", port: 5 };
type Config = typeof config;   // { host: string; port: number }
```

`typeof` (type space) reads a value's type; `keyof` yields the union of keys;
`T[K]` is indexed access. These compose to make types track values.

---

## Conditional Types and `infer`

A conditional type selects a branch by an assignability test, and `infer`
captures a type from within a pattern.

```typescript
type ElementType<T> = T extends (infer U)[] ? U : T;
type A = ElementType<string[]>;   // string
type B = ElementType<number>;     // number

type ReturnOf<F> = F extends (...args: any[]) => infer R ? R : never;
type R = ReturnOf<() => Date>;    // Date
```

**Distributive conditional types**: when the checked type is a *naked* type
parameter and the argument is a union, the conditional distributes over each
member:

```typescript
type NonNull<T> = T extends null | undefined ? never : T;
type C = NonNull<string | null>;   // string  (distributes, drops null)
```

Wrap in a tuple (`[T] extends [U]`) to **disable** distribution when you want to
test the union as a whole.

---

## Mapped Types

Build a type by transforming each key of another type. Modifiers `?`/`readonly`
can be added (`+`) or removed (`-`), and keys can be remapped with `as`.

```typescript
type Partial<T>  = { [K in keyof T]?: T[K] };
type Required<T> = { [K in keyof T]-?: T[K] };
type Readonly<T> = { readonly [K in keyof T]: T[K] };
type Mutable<T>  = { -readonly [K in keyof T]: T[K] };

// Key remapping (4.1+):
type Getters<T> = { [K in keyof T & string as `get${Capitalize<K>}`]: () => T[K] };
```

---

## Template Literal Types

String literal types can be composed like template strings, with intrinsic
`Uppercase`/`Lowercase`/`Capitalize`/`Uncapitalize`:

```typescript
type Event = "click" | "hover";
type Handler = `on${Capitalize<Event>}`;   // "onClick" | "onHover"
```

Combined with mapped types and `infer`, template literals enable typed string
parsing (routes, CSS units, etc.). They remain purely static.

---

## Union and Intersection

- **Union** `A | B`: a value is one of the members; you may only access members
  common to all until narrowed.
- **Intersection** `A & B`: a value has all members of both; used to combine
  object types and to model mixins.

```typescript
type WithId = { id: number };
type WithName = { name: string };
type Entity = WithId & WithName;   // { id: number; name: string }
```

Intersecting incompatible primitives yields `never` (e.g. `string & number`).

---

## `unknown`, `any`, `never`, and `void`

| Type | Meaning |
|------|---------|
| `unknown` | Top type; holds anything but permits **no** operations until narrowed. The safe alternative to `any`. |
| `any` | Opts out of checking; propagates and disables safety. Avoid. |
| `never` | Bottom type; no values. Result of exhaustive narrowing, `throw`, infinite loops; used for exhaustiveness checks. |
| `void` | Absence of a return value; a `void`-returning callback may still return a value that is ignored. |

Exhaustiveness check with `never`:

```typescript
function assertNever(x: never): never { throw new Error(`unexpected: ${x}`); }
// in a switch default: assertNever(shape) — compile error if a case is unhandled
```

---

## Key Utility Types

Built-in, all derivable from the primitives above:

- `Partial<T>`, `Required<T>`, `Readonly<T>`, `Record<K, V>`
- `Pick<T, K>`, `Omit<T, K>`
- `Exclude<U, E>`, `Extract<U, E>`, `NonNullable<T>`
- `ReturnType<F>`, `Parameters<F>`, `ConstructorParameters<C>`, `InstanceType<C>`
- `Awaited<T>` (unwraps nested Promises, 4.5+)

```typescript
type UserPatch = Partial<Pick<User, "name">>;   // { name?: string }
```

---

## What an Agent May Safely Infer

- `unknown` requires narrowing before use; `any` disables checking — prefer `unknown`.
- Conditional types over a naked type parameter distribute across unions; wrap in
  a tuple to stop distribution.
- Mapped-type modifiers `-?` and `-readonly` remove optionality/readonly.
- `readonly T[]` is covariant and sound; mutable `T[]` covariance is not.
- `Awaited<T>` unwraps Promise nesting; do not hand-roll it.

## What an Agent Must Not Infer Without Evidence

- That a utility type "does something at runtime" — all of these are erased.
- That `any` and `unknown` are interchangeable — `any` propagates unsafely,
  `unknown` blocks use.
- That a conditional type distributes when the parameter is wrapped
  (`[T] extends [U]`) — it does not.
- That intersecting primitives is meaningful — `string & number` is `never`.

## What Requires Whole-Program Analysis

- Whether an inferred generic is as narrow as intended (call sites can widen it).
- Whether a deeply recursive conditional/mapped type hits the instantiation-depth
  limit for a given input.
- Whether a declared variance annotation (`in`/`out`) matches actual usage.
