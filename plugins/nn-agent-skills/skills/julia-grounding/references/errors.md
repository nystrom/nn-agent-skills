# Julia Error Taxonomy

This skill maps Julia exception messages to root causes and fixes. The most important Julia exception by far is `MethodError`.

---

## `MethodError: no method matching`

**Most common Julia error.** Raised when a function is called with argument types for which no method is defined.

**Message pattern:**
```
MethodError: no method matching f(::String, ::Int64)
Closest candidates are:
  f(::Int64, ::Int64) at file.jl:5
  f(::String, ::String) at file.jl:9
```

**Root causes:**

```julia
# 1. Wrong argument types
function process(x::Int, y::Int)
    x + y
end

process(1.0, 2)   # MethodError — 1.0 is Float64, not Int
# Fix: process(Int(1.0), 2)  or  add a method for Float64

# 2. Calling a method on the wrong type (most common: using Dict key type wrong)
d = Dict("a" => 1)
d[:a]    # MethodError if keys are String but you used Symbol

# 3. Forgetting the ! mutation convention
v = [3, 1, 2]
sort(v)    # Returns a new sorted array — v unchanged (this is actually OK)
sort!(v)   # Sorts in place — note the ! suffix

# 4. Method doesn't exist for that type
"hello" + " world"   # MethodError — string concatenation is * not +
"hello" * " world"   # Correct

# 5. Broadcasting not applied
[1, 2, 3] + 1        # MethodError — array + scalar is not defined
[1, 2, 3] .+ 1       # Correct — element-wise broadcast
```

**Diagnosing:** The "Closest candidates" section in the error tells you what methods *do* exist. Check: are your argument types exactly right? Did you forget broadcasting (`.`)?

**Agent trap:** `String` concatenation in Julia uses `*`, not `+`. This is the single most common MethodError for new Julia users coming from Python or JavaScript.

---

## `MethodError: Cannot `convert` an object of type X to an object of type Y`

**Message pattern:**
```
MethodError: Cannot `convert` an object of type String to an object of type Int64
```

**Root cause:** Julia tried to automatically convert a value to a required type (for a struct field assignment or a typed array element) and the conversion is not defined.

```julia
struct MyData
    count::Int
end

MyData("five")   # MethodError: cannot convert String to Int

v = Int[]
push!(v, "hello")  # MethodError: cannot convert String to Int64

# Fix: convert explicitly or use the correct type
MyData(parse(Int, "5"))
push!(v, parse(Int, "hello"))
```

---

## `MethodError: ambiguous`

**Message pattern:**
```
MethodError: f(::Int64, ::Int64) is ambiguous. Candidates:
  f(::Int64, ::Any)
  f(::Any, ::Int64)
```

**Root cause:** Two methods are equally applicable for the given argument types — neither is more specific than the other.

```julia
f(x::Int, y::Any) = "first"
f(x::Any, y::Int) = "second"
f(1, 1)   # MethodError: ambiguous

# Fix: add a more specific method that covers the overlap
f(x::Int, y::Int) = "both ints"
```

---

## `UndefVarError`

**Message pattern:** `UndefVarError: x not defined`

**Root causes:**

```julia
# 1. Typo in variable name
reslt = compute()
println(result)   # UndefVarError: result not defined

# 2. Variable defined in a local scope (loop, let, if) not accessible outside
for i in 1:5
    local_var = i
end
println(local_var)   # UndefVarError — local_var only exists in loop body
# Note: this is soft-scope behavior; see julia/semantics for scoping rules

# 3. Module not imported
df = DataFrame(...)   # UndefVarError if DataFrames not loaded
# Fix: using DataFrames

# 4. Function defined in a module not brought into scope
MyModule.process(x)   # qualified access — OK
process(x)            # UndefVarError if process not exported and using MyModule not done

# 5. Misspelled function from Base
sortd(v)    # UndefVarError — it's sort(v) or sort!(v)
```

---

## `BoundsError`

**Message pattern:** `BoundsError: attempt to access 3-element Vector{Int64} at index [4]`

**Root cause:** Array access outside valid bounds. **Julia arrays are 1-indexed.**

```julia
v = [10, 20, 30]
v[0]    # BoundsError — first element is v[1]
v[4]    # BoundsError — last element is v[3] (== v[end])
v[-1]   # BoundsError — negative indices do not wrap (unlike Python)

# Safe access patterns:
v[end]          # last element
v[end-1]        # second-to-last
checkbounds(Bool, v, i) && v[i]  # test before access
get(v, i, default)               # returns default if out of bounds (works for arrays)
```

**Agent trap:** Python uses 0-based indexing and negative indexing wraps. Julia uses 1-based indexing and `end` for the last element. `v[-1]` is always a `BoundsError` in Julia.

---

## `InexactError`

**Message pattern:** `InexactError: Int64(3.7)`

**Root cause:** Converting a value to a type that cannot represent it exactly.

```julia
Int(3.7)     # InexactError — 3.7 cannot be represented as an integer exactly
Int(3.0)     # OK — 3.0 converts exactly to 3

# Fix: use rounding explicitly
floor(Int, 3.7)   # 3
ceil(Int, 3.7)    # 4
round(Int, 3.7)   # 4

# Also occurs with type-annotated struct fields
struct S; x::Int8; end
S(200)   # InexactError — 200 doesn't fit in Int8 (-128 to 127)
```

---

## `DomainError`

**Message pattern:** `DomainError with -1.0: sqrt will only return a complex result if called with a complex argument.`

**Root cause:** An argument is outside the mathematical domain of a function.

```julia
sqrt(-1.0)         # DomainError — use sqrt(Complex(-1.0)) or sqrt(-1.0+0im)
log(-1.0)          # DomainError — log of negative number is complex
asin(2.0)          # DomainError — asin domain is [-1, 1]

# Fix for complex results:
sqrt(Complex(-1.0))   # 0.0 + 1.0im
sqrt(-1.0 + 0im)      # 0.0 + 1.0im (promotion to Complex)
```

---

## `OverflowError`

**Message pattern:** `OverflowError: 9223372036854775808 is too big for Int64`

**Root cause:** Integer arithmetic overflowed. **Julia integers overflow silently by default (wrap around). `OverflowError` is only thrown by conversion functions, not arithmetic.**

```julia
# Silent overflow — no exception:
typemax(Int64) + 1   # wraps to typemin(Int64) = -9223372036854775808

# OverflowError occurs only when converting:
Int64(typemax(Int64) + 1)   # or similar conversions

# Use BigInt for arbitrary precision:
big(typemax(Int64)) + 1   # 9223372036854775808 (correct)

# Use checked arithmetic for overflow detection:
Base.checked_add(typemax(Int64), 1)   # OverflowError
```

**Agent trap:** Arithmetic overflow is **silent** in Julia. There is no automatic `OverflowError` on `+`, `-`, `*`. This is different from Python (which uses arbitrary precision integers by default) and Rust (which panics in debug mode).

---

## `ArgumentError`

**Message pattern:** `ArgumentError: invalid argument — typically thrown by functions for semantically invalid input.**

```julia
# Examples:
sort(1:5, rev="true")        # ArgumentError — should be rev=true (Bool)
push!(Tuple{}, 1)            # ArgumentError — tuples are immutable
```

---

## `KeyError`

**Message pattern:** `KeyError: "missing_key"`

**Root cause:** Accessing a Dict with a key that doesn't exist.

```julia
d = Dict("a" => 1, "b" => 2)
d["c"]   # KeyError: c

# Safe access:
get(d, "c", 0)            # returns 0 if missing
get!(d, "c", 0)           # inserts 0 if missing, returns value
haskey(d, "c")            # check existence
```

---

## `LoadError`

**Message pattern:** `LoadError: while loading file.jl, in expression starting on line 10`

**Root cause:** An error occurred while `include()`ing or `using`/`import`ing a file. The `LoadError` wraps the actual error.

```julia
# The actual error is shown after "caused by:"
# LoadError: while loading ...
# caused by: UndefVarError: x not defined

# Fix: look at the "caused by" section, not the LoadError itself
```

---

## `StackOverflowError`

**Message pattern:** `ERROR: StackOverflowError:`

**Root cause:** Infinite recursion or overly deep call stack.

```julia
# Infinite recursion:
f(x) = f(x + 1)   # no base case
f(1)               # StackOverflowError

# Common mistake: calling the same method recursively with same type dispatch
# Fix: ensure a base case method or add a termination condition
```

---

## `TypeError: non-boolean used in boolean context`

**Message pattern:** `TypeError: non-boolean (Int64) used in boolean context`

**Root cause:** Julia requires explicit boolean values in `if`/`while` conditions. Integers and other non-`Bool` values are not automatically treated as truthy.

```julia
x = 1
if x          # TypeError — use if x != 0 or if x > 0
    ...
end

# This differs from Python, C, and JavaScript where non-zero is truthy
if x != 0     # Correct
    ...
end

if !isnothing(x)   # Correct pattern for "x is not nothing"
    ...
end
```

**Agent trap:** Python, C, and JavaScript treat non-zero integers as truthy. Julia does not. Always use an explicit comparison.

---

## `AssertionError`

Raised by `@assert` macro when the condition is false.

```julia
@assert x > 0 "x must be positive, got $x"
# AssertionError: x must be positive, got -1

# Note: unlike Python, assert is not stripped in production —
# Julia has no -O flag that strips assertions
```

---

## Common Patterns: Error Handling

```julia
# try/catch/finally
try
    result = risky_operation()
catch e
    if e isa MethodError
        # handle MethodError specifically
    elseif e isa BoundsError
        # handle bounds error
    else
        rethrow()   # re-raise unknown errors
    end
finally
    cleanup()   # always runs
end

# Check type without catching:
try
    f(x)
catch e
    @error "failed" exception=(e, catch_backtrace())
end

# Throw custom errors:
throw(ArgumentError("x must be positive"))
error("message")   # throws ErrorException("message")
```

---

## What an Agent May Safely Infer

- `MethodError: no method matching` almost always means wrong argument types; check broadcasting (`.`), type conversions, and whether the function exists for those types.
- `BoundsError` on an array usually means 0-based indexing was assumed; Julia is 1-indexed.
- `TypeError: non-boolean` means a non-Bool was used in a boolean context; add an explicit comparison.
- `OverflowError` is only thrown by conversion functions, not arithmetic — silent wrap-around happens in arithmetic.
- String concatenation uses `*` not `+`; using `+` gives `MethodError`.

## What an Agent Must Not Infer Without Evidence

- That catching `Exception` catches all errors — in Julia you catch any value, and `error()` throws an `ErrorException`. There is no `Exception` base class in the Python sense; use `e isa SomeType` to check.
- That `UndefVarError` means the package is not loaded — it could be a typo, a scope issue, or a missing `export`.
- That overflow raises an error in arithmetic — it silently wraps in Julia.
- That `e` in `catch e` is guaranteed to be a Julia exception object — you can `throw` any value.
