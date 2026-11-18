# Julia Semantics Reference

Julia's semantics differ fundamentally from Python, Rust, and other common languages. The most important differences: **multiple dispatch** (not single dispatch), **value semantics for immutable types**, **soft vs hard scoping**, and **macros that operate on syntax, not values**.

---

## Multiple Dispatch

Every function call in Julia dispatches on the runtime types of **all** arguments, not just the first.

```julia
f(x::Int, y::Int) = "both ints"
f(x::Int, y::Float64) = "int and float"
f(x, y) = "fallback"

f(1, 2)     # "both ints"
f(1, 2.0)   # "int and float"
f("a", 1)   # "fallback"
```

### Method Selection Rules

1. The most specific applicable method is called.
2. Specificity: a type is more specific than its supertypes.
3. If two applicable methods are equally specific, an `MethodError: ambiguous` is thrown.

```julia
g(x::Int, y::Any) = "first"
g(x::Any, y::Int) = "second"
g(1, 1)   # ERROR: MethodError — ambiguous; add g(x::Int, y::Int) to resolve
```

**Disambiguation:** add a method that is more specific than both ambiguous methods.

### `methods` and `@which`

```julia
methods(f)         # lists all methods of f
@which f(1, 2.0)   # shows which method would be called
```

### Adding Methods to Existing Functions

Any module can add methods to any function. This is **type piracy** when applied to types you don't own — avoid it.

```julia
# OK: extending your own function with a new type
Base.show(io::IO, x::MyType) = print(io, "MyType($(x.value))")

# Type piracy: adding a method to a Base function for Base types
Base.+(x::String, y::String) = x * y  # Don't do this
```

---

## Scoping

### Hard Scope

Functions, `struct`, `macro`, `module`, and `type` bodies create **hard scope**. Assignment inside them creates a local variable, never modifying an outer scope silently.

```julia
x = 1

function f()
    x = 2   # creates a new local x; does not affect the global
    return x
end

f()  # 2
x    # 1 — unchanged
```

To write to a global from a function, use `global`:

```julia
function f()
    global x
    x = 2   # now modifies the global
end
```

### Soft Scope

`for`, `while`, `try`, `begin`, and `let` blocks create **soft scope**. Behavior depends on context:

- **Interactive / REPL / Jupyter:** assignment in soft scope modifies an existing global if one exists.
- **Scripts / modules / functions:** assignment in soft scope that would shadow a global requires `local` or `global` to be explicit.

```julia
s = 0
for i in 1:10
    s += i   # in a script: requires `global s` to work correctly
             # in the REPL: works as expected
end
```

This is one of Julia's most commonly misunderstood behaviors. The fix for scripts:

```julia
s = 0
for i in 1:10
    global s
    s += i
end
```

Or avoid the issue entirely by putting the loop in a function (hard scope).

### `let` Blocks

`let` creates a new hard scope and new bindings:

```julia
x = 10
let x = x + 1   # new x bound to 11; outer x unchanged
    println(x)  # 11
end
x  # 10
```

Useful for capturing loop variables in closures (the Julia equivalent of Python's default argument trick):

```julia
funcs = [let i = i; () -> i end for i in 1:5]
funcs[1]()  # 1
funcs[3]()  # 3
```

---

## Closures

Closures capture variables by **reference to a box** (a mutable container). The current value is read at call time.

```julia
function make_adder(n)
    return x -> x + n   # captures n by reference
end

add5 = make_adder(5)
add5(3)   # 8
```

Because closures capture by reference, the late-binding problem applies:

```julia
funcs = Function[]
for i in 1:3
    push!(funcs, () -> i)   # all capture the same i variable
end
funcs[1]()  # 3 (value after loop), not 1
```

Fix with `let`:

```julia
funcs = Function[]
for i in 1:3
    let i = i
        push!(funcs, () -> i)
    end
end
funcs[1]()  # 1
```

---

## Macros

Macros transform syntax at **parse time** (before compilation). They receive `Expr` objects, not values.

```julia
macro mymacro(expr)
    quote
        println("before")
        $(esc(expr))
        println("after")
    end
end

@mymacro x = 1
# before
# after
# x is now 1
```

### `esc` vs No `esc`

- Without `esc`: names in the macro's output are resolved in the macro's definition module, not the caller's module. This is **hygiene**.
- With `esc(expr)`: the expression is resolved in the **caller's** context. Required when you want the caller's variable to be affected.

```julia
macro set_x(val)
    :(x = $(esc(val)))   # sets the caller's x
end

macro set_x_hygienic(val)
    :(x = $(val))        # sets x in the macro's module, not the caller's
end
```

**Rule:** use `esc` on user-provided expressions; do not `esc` variable names you generate yourself inside the macro.

### `@generated` Functions

A `@generated` function produces code based on the **types** of arguments (not values), at specialization time:

```julia
@generated function f(x::T) where T
    if T == Int
        :(x * 2)
    else
        :(string(x))
    end
end
```

The body runs at compile time and returns an expression. It must not read mutable global state.

---

## Broadcasting

The dot syntax `.` broadcasts a function over arrays element-wise:

```julia
sin.(x)          # apply sin to each element of x
x .+ y           # element-wise addition
x .* 2           # multiply each element by 2
f.(g.(x))        # fused: single pass, no intermediate array
```

**Fusion:** Julia fuses consecutive dot calls into a single loop. `sin.(cos.(x))` does not allocate an intermediate array.

**Broadcasting rules:**
- Scalar arguments are broadcast to match array shapes.
- Arrays must have compatible shapes (same size or size 1 in each dimension).
- 1D arrays broadcast with 2D arrays using standard broadcasting rules (like NumPy).

```julia
[1, 2, 3] .+ [10, 20, 30]   # [11, 22, 33]
[1, 2, 3] .+ [10 20 30]     # 3×3 matrix: each row + [10,20,30]
```

**`@.` macro:** converts all function calls and operators in an expression to dot calls:

```julia
@. sin(x) + cos(y)   # equivalent to sin.(x) .+ cos.(y)
```

---

## Module System

```julia
module MyModule

export foo, bar   # names exported by default in `using MyModule`

function foo() ... end
function bar() ... end
function _internal() ... end   # not exported; accessible as MyModule._internal

end
```

### `using` vs `import`

| Syntax | Effect |
|--------|--------|
| `using Foo` | brings `Foo` and all exported names into scope |
| `using Foo: x, y` | brings only `x` and `y` into scope; does not bring `Foo` itself |
| `using Foo: Foo` | brings only `Foo` itself; no exported names |
| `import Foo` | brings `Foo` into scope; allows adding methods to `Foo`'s functions |
| `import Foo: x` | brings `x` into scope; allows adding methods to `x` |

**Adding methods:** you must `import` (not `using`) a function to extend it from another module — or use the qualified name `Foo.bar(...)`.

```julia
import Base: show
show(io::IO, x::MyType) = print(io, "MyType")   # OK: imported

# Alternative without import:
Base.show(io::IO, x::MyType) = print(io, "MyType")   # also OK
```

### `include`

`include("file.jl")` runs the file in the current module's scope. It is **not** a module system; it is textual inclusion. Files do not define scope boundaries.

---

## Expression and Lowering Pipeline

Julia code passes through these stages:

1. **Parse:** source → `Expr` AST
2. **Macro expansion:** macros transformed
3. **Lowering:** `Expr` → IR (SSA-like)
4. **Type inference:** types inferred per specialization
5. **Optimization / codegen:** LLVM IR → machine code

Use `Meta.parse`, `macroexpand`, `@code_lowered`, `@code_typed`, `@code_llvm`, `@code_native` to inspect each stage:

```julia
@code_lowered f(1, 2)    # lowered IR
@code_typed f(1, 2)      # type-inferred IR
@code_llvm f(1, 2)       # LLVM IR
@code_native f(1, 2)     # assembly
```

---

## Value Semantics vs Reference Semantics

- **Immutable structs** (`struct`) are passed and stored by value (or unboxed). Copies are independent.
- **Mutable structs** (`mutable struct`) are heap-allocated and passed by reference.
- **Arrays** are always passed by reference — functions can mutate the caller's array.

```julia
struct Point
    x::Float64
    y::Float64
end

p1 = Point(1.0, 2.0)
p2 = p1   # copy; p1 and p2 are independent

mutable struct Box
    value::Int
end

b1 = Box(1)
b2 = b1   # reference; b1 and b2 point to the same object
b2.value = 99
b1.value  # 99
```

---

## `nothing` vs `missing`

| | `nothing` | `missing` |
|-|-----------|-----------|
| Type | `Nothing` | `Missing` |
| Meaning | deliberate absence of value | unknown/not applicable value |
| Propagation | does not propagate | propagates through most operations |
| Use case | void return, sentinel | statistical missing data, SQL NULL |

```julia
1 + missing   # missing
1 + nothing   # ERROR: MethodError
ismissing(missing)   # true
isnothing(nothing)   # true
```

`Union{T, Nothing}` is the standard nullable pattern. `Union{T, Missing}` is used for data frames and statistics.

---

## What an Agent May Safely Infer

- Every function call dispatches on the runtime types of all arguments.
- Assignment inside a `function` body always creates or modifies a local variable, never a global.
- Dot-call syntax fuses into a single loop with no intermediate allocations.
- `using Foo: x` does not allow adding methods to `x`; `import Foo: x` does.

## What an Agent Must Not Infer Without Evidence

- That a function only has one method — any module can add methods.
- That REPL scoping behavior matches script/module scoping behavior.
- That a `macro` operates on values — it operates on `Expr` AST nodes.
- That a `struct` is mutable — assume immutable unless declared `mutable struct`.
- That `nothing` and `missing` are interchangeable.

## What Requires Whole-Program Analysis

- Whether a method call is ambiguous (requires seeing all methods of the function).
- Whether type piracy is occurring (requires knowing which module owns the function and types).
- Whether a macro is hygienic (requires tracing all `esc` calls).
