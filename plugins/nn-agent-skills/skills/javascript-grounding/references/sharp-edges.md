# JavaScript Sharp Edges

This skill documents JavaScript behaviors that are non-obvious, surprising, or commonly misunderstood — the areas where agents most often generate incorrect code or incorrect explanations.

---

## `typeof null === "object"`

`typeof null` returns `"object"`. This is a historic bug in JavaScript that cannot be fixed without breaking the web.

```javascript
typeof null        // "object" — NOT "null"
typeof undefined   // "undefined"
typeof {}          // "object"
typeof []          // "object"
typeof function(){}// "function"
typeof 42          // "number"
typeof "str"       // "string"
typeof true        // "boolean"
typeof Symbol()    // "symbol"
typeof 42n         // "bigint"
```

**How to check for null:**

```javascript
value === null        // correct
value == null         // true for both null and undefined (loose equality)
typeof value === "null"  // WRONG — always false
```

---

## `NaN` Is Not Equal to Itself

`NaN !== NaN` — the only value in JavaScript not equal to itself.

```javascript
NaN === NaN   // false
NaN == NaN    // false
NaN !== NaN   // true

// How to check for NaN:
Number.isNaN(NaN)    // true — preferred; does not coerce
isNaN("hello")       // true — coerces first: isNaN(Number("hello"))
Number.isNaN("hello") // false — no coercion
```

**`Number.isNaN` vs global `isNaN`:** always prefer `Number.isNaN` — the global `isNaN` coerces its argument to a number first, giving unexpected results for strings.

```javascript
isNaN("abc")          // true — because Number("abc") is NaN
Number.isNaN("abc")   // false — "abc" is not NaN (it's a string)
```

---

## Negative Zero (`-0`)

JavaScript has negative zero. It is equal to `0` under `===` but distinguishable with `Object.is`.

```javascript
-0 === 0          // true
-0 == 0           // true
Object.is(-0, 0)  // false
String(-0)        // "0" — hides the sign
-0 < 0            // false
1 / -0            // -Infinity
1 / 0             // Infinity
```

**When it appears:** dividing a negative number by zero, or multiplying zero by a negative number.

---

## Loose Equality (`==`) Coercion Table

`==` applies complex type coercion. The most dangerous cases:

```javascript
0 == false          // true
"" == false         // true
"0" == false        // true (!)
"0" == 0            // true
null == undefined   // true
null == false       // false (!)
undefined == false  // false (!)
[] == false         // true
[] == ![]           // true (!)
{} == false         // false
NaN == NaN          // false
```

**Rule:** always use `===` unless you explicitly want `null == undefined` coercion (the only safe use of `==`).

---

## `parseInt` Radix Trap

`parseInt` accepts a radix as a second argument. Without it, the radix is inferred from the string prefix:

```javascript
parseInt("0x10")      // 16 — hex prefix detected
parseInt("010")       // 8 in old engines; 10 in ES5+ — ambiguous
parseInt("10", 10)    // 10 — explicit decimal
parseInt("10", 2)     // 2 — binary
parseInt("10abc")     // 10 — parses until non-numeric
parseInt("abc")       // NaN
```

**Rule:** always pass an explicit radix when parsing user input or file data.

**`parseInt` vs `Number()`:**

```javascript
Number("10abc")  // NaN — entire string must be numeric
parseInt("10abc")  // 10 — stops at non-numeric
```

---

## `var` Hoisting in Loops

Using `var` in a loop body creates a single variable for the entire function. All closures created inside the loop share that variable.

```javascript
// Bug: all setTimeouts log 3
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
// Output: 3, 3, 3

// Fix: use let (creates a new binding per iteration)
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
// Output: 0, 1, 2
```

---

## `this` Context Loss

The most common source of `this`-related bugs: extracting a method from an object loses the implicit binding.

```javascript
class Greeter {
  constructor() { this.name = "Alice"; }
  greet() { return `Hello, ${this.name}`; }
}

const g = new Greeter();
g.greet();           // "Hello, Alice" — method call, this is g

const fn = g.greet;
fn();                // "Hello, undefined" — standalone call, this is global/undefined

// Fix 1: bind
const bound = g.greet.bind(g);

// Fix 2: arrow function wrapper
const wrapper = () => g.greet();

// Fix 3: declare greet as arrow in constructor
class Greeter2 {
  constructor() {
    this.name = "Alice";
    this.greet = () => `Hello, ${this.name}`;
  }
}
```

**In callbacks:**

```javascript
class Timer {
  constructor() { this.count = 0; }
  start() {
    // Bug: this is undefined in strict mode, global otherwise
    setInterval(function() { this.count++; }, 1000);

    // Fix: arrow function captures this from start()
    setInterval(() => { this.count++; }, 1000);
  }
}
```

---

## Array Holes (Sparse Arrays)

Arrays can have "holes" — indices with no value. Holes behave differently from `undefined`.

```javascript
const a = [1, , 3];   // hole at index 1
a.length;             // 3
a[1];                 // undefined (but the hole is not an element)
1 in a;               // false — the index has no own property

// Holes skip callbacks in most array methods:
a.forEach(v => console.log(v));  // logs 1, 3 (skips the hole)
a.map(v => v * 2);               // [2, empty, 6]
a.filter(v => true);             // [1, 3] — hole is excluded

// Array.from fills holes with undefined:
Array.from(a);    // [1, undefined, 3] — undefined, not holes
```

**`new Array(n)` creates a sparse array with n holes, not n `undefined` values:**

```javascript
const a = new Array(3);
a.length;  // 3
a[0];      // undefined
0 in a;    // false — hole, not undefined

// To create an array of undefined values:
new Array(3).fill(undefined);   // [undefined, undefined, undefined]
Array.from({ length: 3 });      // [undefined, undefined, undefined]
```

---

## `arguments` Object

Non-arrow functions have an implicit `arguments` object containing all call arguments. It is array-like but not an array.

```javascript
function f() {
  console.log(arguments);        // { 0: 1, 1: 2, 2: 3, length: 3 }
  console.log(arguments[0]);     // 1
  console.log(arguments.map);    // undefined — NOT an array
  const args = Array.from(arguments);  // convert to real array
}
f(1, 2, 3);
```

Arrow functions do NOT have `arguments`. They inherit `arguments` from the enclosing non-arrow function.

**Prefer rest parameters in new code:**

```javascript
function f(...args) {
  args.map(x => x * 2);  // args is a real Array
}
```

---

## Floating Point Arithmetic

JavaScript uses IEEE 754 double-precision floating point.

```javascript
0.1 + 0.2          // 0.30000000000000004, not 0.3
0.1 + 0.2 === 0.3  // false

// Safe comparison:
Math.abs(0.1 + 0.2 - 0.3) < Number.EPSILON  // true
```

**Integer safety limit:**

```javascript
Number.MAX_SAFE_INTEGER  // 9007199254740991 (2^53 - 1)
9007199254740992 === 9007199254740993  // true — precision lost
```

**For large integers:** use `BigInt`.

```javascript
9007199254740992n === 9007199254740993n  // false — BigInt is exact
```

---

## `delete` Operator

`delete` removes an own property from an object. It does not affect variables.

```javascript
const obj = { a: 1, b: 2 };
delete obj.a;  // true — removes the property
obj;           // { b: 2 }

delete obj.nonexistent;  // true — silently succeeds

var x = 5;
delete x;      // false — cannot delete variables
```

**`delete` on an array element creates a hole:**

```javascript
const a = [1, 2, 3];
delete a[1];
a;         // [1, empty, 3]
a.length;  // 3 — length unchanged
```

---

## `for...in` vs `for...of`

```javascript
// for...in: iterates over enumerable property KEYS (including inherited)
const obj = { a: 1, b: 2 };
for (const key in obj) {
  console.log(key);   // "a", "b"
}

// Danger: also iterates over prototype properties
function Foo() { this.x = 1; }
Foo.prototype.y = 2;
const f = new Foo();
for (const key in f) {
  console.log(key);   // "x", "y" — y is inherited
}
// Guard: hasOwnProperty
for (const key in f) {
  if (Object.hasOwn(f, key)) { ... }
}

// for...of: iterates over VALUES of any iterable (arrays, strings, Maps, Sets, generators)
for (const val of [1, 2, 3]) {
  console.log(val);   // 1, 2, 3
}

// for...of does NOT work on plain objects (not iterable)
for (const val of { a: 1 }) {}  // TypeError: obj is not iterable
// Use: for (const [k, v] of Object.entries(obj))
```

---

## `==` with Objects

When comparing objects with `==` or `===`, identity is compared, not content.

```javascript
{} === {}   // false — different objects
[] === []   // false — different arrays
[] == []    // false — different arrays

const a = {};
const b = a;
a === b;    // true — same reference
```

---

## Function Declaration vs Expression Hoisting

Function declarations are fully hoisted (both name and body). Function expressions assigned to variables are not.

```javascript
greet();   // "hello" — declaration is fully hoisted

function greet() { return "hello"; }

// vs expression:
hi();      // TypeError: hi is not a function (var hi is hoisted as undefined)
var hi = function() { return "hi"; };
```

---

## `switch` Fall-Through

`switch` cases fall through to the next case unless `break` is used.

```javascript
switch (x) {
  case 1:
    console.log("one");
    // no break — falls through!
  case 2:
    console.log("two");
    break;
  case 3:
    console.log("three");
    break;
}
// x === 1 logs both "one" and "two"
```

---

## String Indexing and Unicode

Strings are UTF-16. Characters outside the Basic Multilingual Plane (emoji, some CJK) are represented as surrogate pairs and take 2 code units.

```javascript
"hello".length   // 5
"😀".length      // 2 — emoji is a surrogate pair

"😀"[0]          // "\uD83D" — half of the surrogate pair

// Correct: spread uses the iterator which handles surrogates
[..."😀"].length  // 1

// String iteration with for...of handles surrogates correctly:
for (const char of "hello 😀") {
  console.log(char);   // h, e, l, l, o, ' ', 😀
}
```

---

## What an Agent May Safely Infer

- `typeof null` is `"object"` — always check `=== null` for null checks.
- `NaN !== NaN` — always use `Number.isNaN()`.
- `===` never coerces types.
- `let` in a `for` loop creates a new binding per iteration.
- Arrow functions have no `this`, `arguments`, or `prototype`.

## What an Agent Must Not Infer Without Evidence

- That `0 == false` is safe to rely on — use `=== false`.
- That `parseInt` without a radix is reliable for non-decimal strings.
- That array methods treat holes like `undefined` — most skip holes.
- That `for...in` only visits own properties — always check `hasOwn`.

## What Requires Whole-Program Analysis

- Whether a method passed as a callback retains its original `this` context.
- Whether any code assigns to an inherited prototype property, affecting all instances.
- Whether a `switch` fall-through is intentional or a bug.
