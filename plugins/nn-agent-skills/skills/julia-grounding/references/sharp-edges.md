# Julia Sharp Edges

These are the behaviors that most commonly cause incorrect code or incorrect explanations in Julia — particularly for agents pattern-matching from Python or other languages.

---

## Non-`const` Globals Cause Type Instability

Any reference to a non-`const` global inside a function is type-unstable. The compiler cannot know the global's type at compile time.

```julia
threshold = 0.5   # non-const global

function classify(x)
    return x > threshold   # type-unstable: threshold could be Any
end
```

```julia
@code_warntype classify(1.0)
# Body contains ::Any or ::Bool (with Union)
```

`@code_warntype` is the first-line tool for spotting this — see the toolchain
reference (`toolchain.md`, the `@code_warntype` section) for reading its output.

**Fix:** declare `const`, or pass as a function argument:

```julia
const THRESHOLD = 0.5   # type is fixed at Float64

function classify(x, threshold=THRESHOLD)
    return x > threshold   # type-stable
end
```

---

## Soft Scope: Script vs REPL

In scripts and modules, a `for`, `while`, or `try` block does **not** inherit the outer local scope. Assignment to an outer variable requires `global`.

```julia
# script.jl
s = 0
for i in 1:10
    s += i   # WARNING: in 1.6+ this works with a warning; in older Julia it silently created a new local
end
# In Julia 1.6+: works but prints a warning about soft scope
# Correct: use global or put in a function
```

```julia
# script.jl — correct
s = 0
for i in 1:10
    global s
    s += i
end
```

Or — the idiomatic fix — wrap in a function:

```julia
function sum_range(n)
    s = 0
    for i in 1:n
        s += i   # local scope inside function; no issue
    end
    return s
end
```

**In the REPL:** soft scope behaves intuitively — loops can assign to outer variables without `global`. Scripts behave differently from the REPL.

---

## 1-Based Indexing

Julia arrays are 1-indexed. `a[1]` is the first element. `a[end]` is the last.

```julia
a = [10, 20, 30]
a[1]     # 10 (not a[0])
a[end]   # 30
a[end-1] # 20

a[0]     # BoundsError
```

`end` in an indexing expression means `length(a)` (for 1D) or `size(a, dim)` (for ND).

**`eachindex(a)`** iterates valid indices without assuming 1-based:

```julia
for i in eachindex(a)
    println(a[i])
end
```

Use `eachindex` for code that should work with offset arrays (`OffsetArrays.jl`).

---

## Column-Major Array Storage

Julia stores matrices in **column-major** order (Fortran order). Iterating column-by-column is fast; row-by-row is slow.

```julia
A = rand(1000, 1000)

# Fast: column-major access
for j in 1:1000
    for i in 1:1000
        A[i, j] += 1.0
    end
end

# Slow: row-major access (each step jumps across columns in memory)
for i in 1:1000
    for j in 1:1000
        A[i, j] += 1.0
    end
end
```

This is the opposite of NumPy (C order, row-major) and C arrays.

**Indexing notation:** `A[row, col]` — row index first, column index second (same as math notation). But *storage* is column-first.

---

## Integer Overflow

Julia integers have fixed width and overflow silently (no exception, no promotion to BigInt):

```julia
typemax(Int64)       # 9223372036854775807
typemax(Int64) + 1   # -9223372036854775808 — wrapped silently
```

This matches C behavior and is intentional for performance. Use `BigInt` if overflow is a concern:

```julia
big(typemax(Int64)) + 1   # 9223372036854775808
```

**Checked arithmetic:**

```julia
Base.checked_add(typemax(Int64), 1)   # throws OverflowError
```

**Contrast with Python:** Python integers are arbitrary precision and never overflow.

---

## `==` vs `===` vs `isequal`

| Operator | Tests |
|----------|-------|
| `==` | structural equality; calls `__eq__` / `isequal` fallback |
| `===` | identity (same object) OR bit-identical for immutables |
| `isequal` | like `==` but `NaN === NaN` and `isequal(NaN, NaN)` is true; `-0.0` is not isequal to `0.0` |

```julia
NaN == NaN      # false (IEEE 754)
NaN === NaN     # true (same bits)
isequal(NaN, NaN)   # true

0.0 === -0.0    # false
0.0 == -0.0     # true (IEEE 754)
isequal(0.0, -0.0)  # false
```

**Dict and Set key lookup** uses `hash` and `isequal`, not `==`. Use `isequal` when defining hash-consistent equality.

---

## Broadcasting Pitfalls

### Scalar vs Array Ambiguity

```julia
x = [1, 2, 3]
x + 1    # ERROR: MethodError — + is not defined for Vector and Int
x .+ 1   # [2, 3, 4] — broadcast
```

`+` is not automatically broadcast. Always use `.+`, `.*`, etc. for element-wise operations.

### Shape Mismatch

```julia
a = [1, 2, 3]    # 3-element column vector (3,)
b = [1 2 3]      # 1×3 row matrix (1,3)
a .+ b           # 3×3 matrix — broadcasting expands both
```

A 1D array is a vector (shape `(3,)`), not a column matrix (shape `(3,1)`). Broadcasting a vector with a 1×N matrix produces an N×N matrix, which may be surprising.

### Mutating Broadcast

```julia
x = zeros(3)
x .= [1, 2, 3]   # in-place broadcast assignment
y .+= 1          # in-place addition
```

`.=` mutates the left-hand side. Without `.`, assignment creates a new array.

---

## Copy Semantics

Assignment does not copy:

```julia
a = [1, 2, 3]
b = a       # b and a point to the same array
b[1] = 99
a[1]        # 99

c = copy(a)     # shallow copy: new array, same elements
d = deepcopy(a) # recursive copy (matters for arrays of arrays)
```

**Function arguments:** arrays are passed by reference. Functions can mutate the caller's array.

```julia
function fill_zeros!(v)
    v .= 0   # mutates the caller's array
end
```

By convention, mutating functions end in `!`. Non-mutating versions return a new array.

---

## Closure Late Binding in Loops

Same as Python: closures capture variables by reference.

```julia
funcs = Function[]
for i in 1:3
    push!(funcs, () -> i)
end
funcs[1]()   # 3, not 1
```

Fix with `let`:

```julia
funcs = Function[]
for i in 1:3
    let i = i
        push!(funcs, () -> i)
    end
end
funcs[1]()   # 1
```

---

## Multiple Return Values Are Tuples

Julia functions can return multiple values, which are actually a `Tuple`:

```julia
function minmax(a, b)
    return a < b ? (a, b) : (b, a)
end

lo, hi = minmax(3, 1)   # destructuring
result = minmax(3, 1)   # result is (1, 3), a Tuple{Int,Int}
```

There is no special "multiple return value" type — it is a `Tuple`. Returning `nothing` is explicit; a function that falls off the end returns `nothing`.

---

## `missing` Propagates; `nothing` Does Not

```julia
1 + missing   # missing — propagates
1 + nothing   # ERROR: MethodError

missing == missing   # missing — not true!
ismissing(missing)   # true — correct way to check
```

Use `skipmissing` to ignore missing values in iteration:

```julia
sum(skipmissing([1, missing, 3]))   # 4
```

---

## Method Ambiguity Errors Are Silent Until Called

Defining ambiguous methods does not raise an error at definition time. The error only surfaces when an ambiguous call is made:

```julia
f(x::Int, y) = 1
f(x, y::Int) = 2
# No error yet

f(1, 1)   # ERROR: MethodError: f(::Int, ::Int) is ambiguous
```

Aqua.jl's `test_ambiguities` catches these before they reach callers.

---

## `@inbounds` and `@simd` Are Unsafe

`@inbounds` skips bounds checking. Using it on out-of-bounds access causes undefined behavior (memory corruption, not a Julia exception):

```julia
a = [1, 2, 3]
@inbounds a[5]   # undefined behavior — may crash, corrupt memory, or return garbage
```

Only use `@inbounds` when you have proven the index is in range, typically with `@assert` in development builds or by loop structure analysis.

`@simd` allows reordering and floating-point reassociation in loops. Only correct for loops with no loop-carried dependencies.

---

## `String` is Not an Array of `Char`

Julia strings are immutable and UTF-8 encoded. Indexing by integer gives the byte at that position, not the nth character:

```julia
s = "café"
s[1]   # 'c'
s[4]   # 'é' — but only if byte 4 is the start of 'é'
s[3]   # ERROR: StringIndexError if byte 3 is in the middle of a multi-byte char
```

Use `eachindex(s)` or `iterate(s)` to walk characters safely:

```julia
for c in s   # iterates Unicode characters correctly
    ...
end

collect(s)  # ['c', 'a', 'f', 'é'] — Vector{Char}
length(s)   # 4 (number of characters)
ncodeunits(s)  # 5 (number of bytes, since 'é' is 2 bytes)
```

---

## `@time` Includes Compilation on First Call

```julia
@time f(1)   # first call: includes compilation time
@time f(1)   # second call: just runtime
```

Always run a function once before timing to separate compilation from execution. `@benchmark` from `BenchmarkTools.jl` handles this automatically.

---

## Function Return Type Annotations Convert (Not Just Assert)

Specifying a return type on a function signature (e.g., `function f(x)::T`) does **not** simply assert the type. Instead, it converts the returned value to the annotated type using `convert(T, val)`.

```julia
function get_float(x)::Float64
    return x
end

get_float(1)  # Returns 1.0 (Float64) — converted silently from Int!
```

This silent conversion can introduce performance overhead (if conversion is expensive) or hide type bugs.

If you only want a type assertion (which throws an error if the type doesn't match) or to help the compiler's type inference along, annotate the returned expression instead:

```julia
function get_float(x)
    return x::Float64  # Type assertion: throws TypeError if x is not Float64
end

get_float(1)  # Throws: TypeError: typeassert: expected Float64, got a value of type Int64
```

---

## What an Agent May Safely Infer

- Non-`const` globals in functions cause type instability.
- Arrays are column-major; inner loops should vary the first (row) index.
- `a[1]` is the first element; `a[0]` is a `BoundsError`.
- Integer overflow is silent; use `checked_add` if overflow is a concern.
- `NaN == NaN` is `false`; use `isnan(x)` or `isequal` as needed.
- Function return type annotations convert returned values instead of only asserting their types.

## What an Agent Must Not Infer Without Evidence

- That REPL behavior matches script behavior for loops — soft scope differs.
- That `@inbounds` is safe — only after proving bounds are correct.
- That closures capture values — they capture references.
- That a string index accesses the nth character — it accesses the nth byte.
- That `==` is the right test for `missing` — it returns `missing`.
- That annotating a function's return type simply asserts the return type without conversion.

## What Requires Whole-Program Analysis

- Whether a `global` keyword is missing in a script-context loop.
- Whether `@inbounds` annotations are safe throughout a module.
- Whether method ambiguities are reachable from public API.
