# JavaScript Semantics Reference

Use this skill when you need to reason about what JavaScript code *does*, not just what it *looks like*. This covers runtime behavior — not TypeScript types, which are erased before execution.

---

## Variable Declarations: `var`, `let`, `const`

Three distinct scoping rules:

| Declaration | Scope | Hoisted? | TDZ? | Re-assignable? | Re-declarable? |
|-------------|-------|----------|------|----------------|----------------|
| `var` | function | yes (as `undefined`) | no | yes | yes |
| `let` | block | yes (declaration only) | yes | yes | no |
| `const` | block | yes (declaration only) | yes | no | no |

**`var` hoisting:** the declaration is moved to the top of its enclosing function; the assignment stays in place.

```javascript
console.log(x);  // undefined, not ReferenceError
var x = 5;
console.log(x);  // 5
```

**Temporal Dead Zone (TDZ):** `let` and `const` are hoisted but not initialized. Accessing them before their declaration throws `ReferenceError`.

```javascript
console.log(y);  // ReferenceError: Cannot access 'y' before initialization
let y = 5;
```

**`const` is not deep immutable:** the binding cannot be reassigned, but if the value is an object or array, its contents can be mutated.

```javascript
const arr = [1, 2, 3];
arr.push(4);   // legal — mutates the array
arr = [];      // TypeError — cannot reassign const binding
```

---

## Scoping

JavaScript uses **lexical (static) scoping**: a function's scope is determined by where it is defined, not where it is called.

### Block scope

`let` and `const` are block-scoped. `var` is function-scoped (ignores blocks other than function bodies).

```javascript
{
  let a = 1;
  var b = 2;
}
console.log(a);  // ReferenceError — a is not in scope
console.log(b);  // 2 — var leaks out of the block
```

### Function scope

Each function creates a new scope. Inner functions can access outer variables (closure).

```javascript
function outer() {
  let x = 10;
  function inner() {
    console.log(x);  // 10 — captured from outer scope
  }
  inner();
}
```

---

## Closures

A closure is a function that retains access to its enclosing scope after the enclosing function has returned.

```javascript
function makeCounter() {
  let count = 0;
  return {
    increment() { count++; },
    get()       { return count; }
  };
}

const counter = makeCounter();
counter.increment();
counter.increment();
counter.get();   // 2
```

**Late binding trap:** closures capture the *variable*, not the value. The variable's current value is used at call time.

```javascript
// Bug: all functions return 3
const fns = [];
for (var i = 0; i < 3; i++) {
  fns.push(() => i);
}
fns[0]();  // 3, not 0

// Fix 1: use let (block-scoped, new binding per iteration)
for (let i = 0; i < 3; i++) {
  fns.push(() => i);
}

// Fix 2: use an IIFE to capture the current value
for (var i = 0; i < 3; i++) {
  fns.push(((j) => () => j)(i));
}
```

---

## `this` Binding

`this` in JavaScript is determined by **how a function is called**, not where it is defined. There are four rules, applied in priority order:

### 1. `new` binding (highest priority)

When a function is called with `new`, `this` is the newly created object.

```javascript
function Dog(name) {
  this.name = name;
}
const d = new Dog("Rex");
d.name;  // "Rex"
```

### 2. Explicit binding

`call`, `apply`, and `bind` explicitly set `this`.

```javascript
function greet() { return `Hello, ${this.name}`; }
greet.call({ name: "Alice" });      // "Hello, Alice"
greet.apply({ name: "Bob" });       // "Hello, Bob"
const bound = greet.bind({ name: "Carol" });
bound();                            // "Hello, Carol"
```

### 3. Implicit binding

When a function is called as a method of an object, `this` is the object before the dot.

```javascript
const obj = {
  name: "Alice",
  greet() { return `Hello, ${this.name}`; }
};
obj.greet();  // "Hello, Alice"

// Losing implicit binding:
const fn = obj.greet;
fn();  // "Hello, undefined" (or TypeError in strict mode)
```

### 4. Default binding (lowest priority)

In non-strict mode, `this` is the global object (`window` in browsers, `global` in Node.js). In strict mode, `this` is `undefined`.

```javascript
function f() { return this; }
f();           // global object (non-strict) or undefined (strict)
```

### Arrow functions: no own `this`

Arrow functions do not have their own `this`. They inherit `this` from the enclosing lexical scope at definition time. `call`, `apply`, `bind` cannot change their `this`.

```javascript
class Timer {
  constructor() { this.ticks = 0; }
  start() {
    setInterval(() => {
      this.ticks++;  // `this` is the Timer instance, not the global
    }, 1000);
  }
}
```

---

## Prototypal Inheritance

JavaScript uses **prototype chains**, not class-based inheritance (classes are syntactic sugar over prototypes).

Every object has an internal `[[Prototype]]` link (accessible via `Object.getPrototypeOf(obj)` or the deprecated `obj.__proto__`).

Property lookup walks the prototype chain until the property is found or the chain ends at `null`.

```javascript
const animal = { breathe() { return "inhale/exhale"; } };
const dog = Object.create(animal);
dog.bark = function() { return "woof"; };

dog.bark();     // "woof" — own property
dog.breathe();  // "inhale/exhale" — found on prototype
```

**`class` syntax** creates the same prototype structure:

```javascript
class Animal {
  breathe() { return "inhale/exhale"; }
}
class Dog extends Animal {
  bark() { return "woof"; }
}

const d = new Dog();
Object.getPrototypeOf(d) === Dog.prototype;          // true
Object.getPrototypeOf(Dog.prototype) === Animal.prototype; // true
```

**`instanceof`** checks whether `Constructor.prototype` appears anywhere in the object's prototype chain. It does NOT check the constructor name.

```javascript
d instanceof Dog;     // true
d instanceof Animal;  // true
```

---

## The Event Loop

JavaScript is single-threaded. Asynchrony is managed by the event loop, which processes three queues in order:

1. **Call stack** — currently executing synchronous code
2. **Microtask queue** — Promise callbacks (`.then`, `.catch`, `.finally`), `queueMicrotask`, `MutationObserver`
3. **Macrotask queue** — `setTimeout`, `setInterval`, `setImmediate` (Node), I/O callbacks, UI events

**Rule:** the event loop drains the *entire* microtask queue after each macrotask, before picking up the next macrotask.

```javascript
console.log("1");

setTimeout(() => console.log("4"), 0);  // macrotask

Promise.resolve().then(() => console.log("2"));  // microtask
Promise.resolve().then(() => console.log("3"));  // microtask

console.log("end");

// Output: 1, end, 2, 3, 4
```

**Consequence:** `setTimeout(fn, 0)` does not run immediately — it queues a macrotask, which runs after all microtasks.

---

## Promises

A Promise represents a value that may be available now, in the future, or never. It has three states: pending, fulfilled, rejected.

```javascript
const p = new Promise((resolve, reject) => {
  // call resolve(value) to fulfill
  // call reject(reason) to reject
});

p.then(value => { /* fulfilled */ })
 .catch(reason => { /* rejected */ })
 .finally(() => { /* always runs */ });
```

**Chaining:** `.then()` returns a new Promise. The return value of the callback becomes the resolved value of that Promise.

```javascript
fetch("/api")
  .then(res => res.json())      // returns a new Promise
  .then(data => process(data))
  .catch(err => handleError(err));
```

**Key APIs:**

| Method | Behavior |
|--------|----------|
| `Promise.resolve(v)` | Returns a fulfilled Promise with value `v` |
| `Promise.reject(r)` | Returns a rejected Promise with reason `r` |
| `Promise.all([...])` | Fulfills when all fulfill; rejects on first rejection |
| `Promise.allSettled([...])` | Fulfills when all settle (ES2020); each result has `{status, value/reason}` |
| `Promise.race([...])` | Settles when the first one settles |
| `Promise.any([...])` | Fulfills when any fulfill; rejects with `AggregateError` if all reject (ES2021) |
| `Promise.withResolvers()` | Returns `{promise, resolve, reject}` (ES2024) |

---

## async/await

`async` functions always return a Promise. `await` pauses execution of the `async` function until the awaited Promise settles.

```javascript
async function fetchUser(id) {
  const res = await fetch(`/users/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();   // returned value is wrapped in a Promise
}
```

**Error handling:** unhandled rejections from `await` propagate as thrown exceptions, caught by `try/catch`.

```javascript
async function run() {
  try {
    const user = await fetchUser(42);
  } catch (err) {
    console.error(err);
  }
}
```

**Parallel execution:** `await` in sequence runs sequentially. For parallel execution, use `Promise.all`:

```javascript
// Sequential — waits for each before starting the next
const a = await fetchA();
const b = await fetchB();

// Parallel — both start immediately
const [a, b] = await Promise.all([fetchA(), fetchB()]);
```

**`async` function gotcha:** forgetting `await` returns a Promise, not the resolved value.

```javascript
async function get() { return 42; }
const x = get();   // x is a Promise<42>, not 42
const y = await get();  // y is 42
```

---

## Modules: ESM vs CommonJS

JavaScript has two module systems. They are not fully interoperable.

### ES Modules (ESM)

Standard since ES2015. File extension `.mjs` or `.js` with `"type": "module"` in `package.json`.

```javascript
// Named exports
export function add(a, b) { return a + b; }
export const PI = 3.14159;

// Default export
export default class Calculator { ... }

// Named import
import { add, PI } from "./math.js";

// Default import
import Calculator from "./Calculator.js";

// Namespace import
import * as math from "./math.js";

// Dynamic import (returns a Promise)
const { add } = await import("./math.js");
```

**Key ESM semantics:**
- Imports are **live bindings** — if the exporting module updates the variable, importers see the update
- Imports are read-only (cannot assign to an imported binding)
- `import` declarations are hoisted and run before the rest of the module body
- ESM is always in strict mode
- Top-level `await` is available in ESM (ES2022)

### CommonJS (CJS)

Node.js default. File extension `.cjs` or `.js` without `"type": "module"`.

```javascript
// Exporting
module.exports = { add, PI };
// or
exports.add = function(a, b) { return a + b; };

// Importing
const { add, PI } = require("./math");
const math = require("./math");
```

**Key CJS semantics:**
- `require()` is synchronous — modules are loaded and executed inline
- `module.exports` is a plain object; mutations after export are not visible to importers who already required it
- Modules are cached after first `require()` — subsequent calls return the cached export
- `require()` can appear anywhere, including inside functions and conditionals

### Interop rules

- ESM can import CJS (`import cjsModule from "./cjs.cjs"` imports `module.exports` as the default)
- CJS cannot `require()` an ESM module (throws `ERR_REQUIRE_ESM`). Use dynamic `import()` instead.
- Named exports from CJS require Node.js to statically analyze the module; not always reliable.

---

## Coercion and Type Conversion

JavaScript has implicit type coercion in many operations.

### `+` operator

If either operand is a string, concatenation occurs:

```javascript
1 + "2"     // "12"
"1" + 2     // "12"
1 + 2 + "3" // "33" — left-to-right, 1+2=3, then "3"+"3"="33"
"1" + 2 + 3 // "123"
```

### Loose equality (`==`)

Performs type coercion before comparing. Rules are complex; use `===` to avoid surprises.

```javascript
0 == false      // true
"" == false     // true
null == undefined // true
null == 0       // false
NaN == NaN      // false (always)
```

### Boolean coercion

Falsy values: `false`, `0`, `-0`, `0n`, `""`, `null`, `undefined`, `NaN`. Everything else is truthy.

```javascript
Boolean(0)        // false
Boolean([])       // true — empty array is truthy
Boolean({})       // true — empty object is truthy
Boolean("")       // false
Boolean("false")  // true — non-empty string
```

### `toString` and `valueOf`

Objects are coerced by calling `valueOf()` first, then `toString()` if valueOf doesn't return a primitive. This affects `+` and comparison operators.

---

## What an Agent May Safely Infer

- `this` in an arrow function always refers to the `this` of the enclosing non-arrow function or module scope.
- `===` never coerces; `==` does.
- Microtasks (Promise callbacks) always run before the next macrotask.
- `const` prevents rebinding, not mutation.
- ESM `import` declarations are hoisted; `require()` is not.

## What an Agent Must Not Infer Without Evidence

- That `this` inside a callback refers to the enclosing class instance — it depends on how the callback is called.
- That `setTimeout(fn, 0)` runs before other queued work — it is a macrotask.
- That `==` behaves like `===` for non-primitive types.
- That CommonJS and ESM are fully interoperable — they are not.
- The prototype chain of an object without inspecting it.

## What Requires Whole-Program Analysis

- Whether a module's exports are mutated after initial export (CJS).
- Whether an async function's rejected Promise is always caught.
- The full prototype chain of an object from a third-party library.
