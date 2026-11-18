# TypeScript Sharp Edges

Behaviors that most often produce incorrect TypeScript code or incorrect
explanations — especially the places where the type system is deliberately
**unsound** (it accepts programs that can fail at runtime) and where agents
pattern-match from nominally-typed languages. Types are erased, so none of these
checks exist at runtime unless you write them.

---

## `any` Disables Checking and Propagates

`any` is not "some type" — it is an escape hatch that turns off checking for every
value it touches, silently.

```typescript
const data: any = JSON.parse(input);
const n: number = data.foo.bar;   // no error; may be undefined/throw at runtime
data.whatever().nonsense;         // no error at all
```

Use `unknown` instead: it holds anything but forbids use until you narrow. A
single `any` can hollow out the safety of a whole call chain.

---

## `as` Is an Assertion, Not a Conversion

`as T` tells the compiler to *stop checking* — it performs no runtime conversion
and no validation.

```typescript
const el = document.getElementById("x") as HTMLInputElement;
el.value;   // compiles; throws at runtime if the element is actually a <div> or null

const wrong = "5" as unknown as number;   // double assertion bypasses all safety
```

`as const`, by contrast, is meaningful: it freezes literal types and makes
members `readonly`. Reserve `as T` for cases where you truly know more than the
checker, and prefer a runtime guard.

---

## The Non-Null Assertion `!` Lies If You're Wrong

`x!` asserts "not null/undefined" with no runtime check. If `x` is null, the
error surfaces later, away from the assertion.

```typescript
function len(s?: string) { return s!.length; }   // throws at runtime on undefined
```

---

## Enums Are Surprising

Numeric enums are **bidirectional** (reverse-mapped) and emit a runtime object;
string enums are one-way and nominal-ish.

```typescript
enum Dir { Up, Down }
Dir.Up;      // 0
Dir[0];      // "Up" — reverse mapping exists for numeric enums
Object.keys(Dir);   // ["0", "1", "Up", "Down"] — both directions!

enum Color { Red = "red" }
const c: Color = "red";   // ERROR — string enums are not assignable from their raw string
```

Non-`const` enums generate runtime code and are not fully erased. Prefer a union
of string literals or `as const` objects unless you need the enum object.

---

## `{}`, `object`, and `Object` Are Three Different Things

```typescript
let a: {} = 1;         // OK — {} means "any non-null value", including primitives
let b: object = 1;     // ERROR — `object` means non-primitive only
let c: Object = "x";   // OK — the JS Object interface; almost never what you want
```

`{}` is a common mistake for "empty object" — it accepts numbers, strings, etc.
For "an object with no known properties" use `Record<string, never>` or a precise
shape.

---

## Structural Typing Accepts Unexpected Values

An empty or minimal interface matches almost anything.

```typescript
interface Named { name: string; }
function greet(x: Named) {}
greet({ name: "a", extra: 1 } as Named);   // extra survives at runtime

interface Empty {}
const anything: Empty = 42;   // OK — {} -like, accepts primitives
```

To force distinctness (nominal typing), brand the type:

```typescript
type UserId = string & { readonly __brand: "UserId" };
```

---

## Arrays Are Covariant — Unsoundly

```typescript
const dogs: Dog[] = [new Dog()];
const animals: Animal[] = dogs;   // allowed
animals.push(new Cat());          // compiles; dogs now contains a Cat
dogs[1].bark();                   // runtime error
```

Use `readonly T[]` where you do not mutate; it is covariant *and* sound.

---

## Method Parameter Bivariance

Parameters compared through a **method** shorthand are bivariant (unsound), while
function-property parameters are contravariant under `strictFunctionTypes`.

```typescript
interface Handler { on(cb: (e: MouseEvent) => void): void; }   // bivariant (method)
type Handler2 = { on: (cb: (e: MouseEvent) => void) => void }; // contravariant (property)
```

This is why some unsafe callback assignments compile. Prefer the function-property
form for stricter checking.

---

## `readonly` Is Shallow and Compile-Only

```typescript
const o: { readonly a: { b: number } } = { a: { b: 1 } };
o.a.b = 2;             // OK — readonly is shallow
(o as any).a = {};     // readonly is erased; no runtime protection
```

For runtime immutability use `Object.freeze` (also shallow) or an immutable
library.

---

## `Object.keys` Returns `string[]`, Not `keyof T`

```typescript
const user = { id: 1, name: "a" };
Object.keys(user).forEach(k => user[k]);   // ERROR: k is string, not keyof typeof user
```

This is intentional: an object may have *more* keys at runtime than its static
type (structural typing). Cast deliberately or use a typed helper if you accept
the risk.

---

## Index Access Is Unsound Without `noUncheckedIndexedAccess`

By default, indexing an array or record returns the element type, never
`undefined`, even out of bounds:

```typescript
const xs = [1, 2, 3];
const y = xs[10];    // typed number, actually undefined at runtime
```

Enable `noUncheckedIndexedAccess` to get `number | undefined` and force a check.

---

## Numbers Are JavaScript Numbers

There is no integer type; all `number` values are IEEE 754 doubles, inheriting
every JavaScript float footgun (`0.1 + 0.2 !== 0.3`, `NaN !== NaN`, unsafe
integers past 2^53). Use `bigint` for exact large integers. See the
javascript-grounding skill for the underlying behavior.

---

## Floating Promises

Forgetting `await` (or `.catch`) drops errors silently and does not sequence.

```typescript
async function save() { db.write(); }   // missing await: write may not finish, errors lost
```

Enable `@typescript-eslint/no-floating-promises`. `void somePromise()` is the
explicit "I am intentionally not awaiting" marker.

---

## What an Agent May Safely Infer

- `as` and `!` are unchecked assertions with no runtime effect; a wrong one fails later.
- `{}` and `Object` accept primitives; `object` does not.
- Mutable array covariance and method-parameter bivariance are unsound by design.
- `readonly` and all types are erased — no runtime immutability or type identity.
- Default indexed access omits `undefined` unless `noUncheckedIndexedAccess` is on.

## What an Agent Must Not Infer Without Evidence

- That code which type-checks cannot throw — assertions, `any`, and unsound
  variance let runtime errors through.
- That `Object.keys(x)` is typed as `keyof typeof x` — it is `string[]`.
- That a numeric enum is a closed set at runtime — it is a bidirectional object.
- That `string enum` values are assignable from raw strings — they are not.
- That `readonly` deep-freezes — it is shallow and compile-only.

## What Requires Whole-Program Analysis

- Whether an `any` originates upstream and is silently disabling checks here.
- Whether an unsound array/callback assignment actually causes a bad runtime value.
- Which `tsconfig` strictness flags are enabled — they change many of these behaviors.
