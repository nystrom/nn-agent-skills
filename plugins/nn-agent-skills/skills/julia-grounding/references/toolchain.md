# Julia Toolchain Reference

---

## Pkg.jl — Package Management

### Environments

Every Julia project has a `Project.toml` (dependencies) and `Manifest.toml` (exact resolved versions). Always work in a project environment, not the global environment.

```julia
# Activate an environment
using Pkg
Pkg.activate(".")        # activate the project in the current directory
Pkg.activate("path/to/project")

# In the REPL, use ] to enter Pkg mode:
# ] activate .
```

### Basic Operations

```julia
Pkg.add("DataFrames")                  # add package
Pkg.add(name="DataFrames", version="1.5")  # pin version
Pkg.add(url="https://github.com/...")  # add from git URL
Pkg.add(path="/local/path")            # add from local path
Pkg.rm("DataFrames")                   # remove
Pkg.update("DataFrames")               # update one package
Pkg.update()                           # update all
Pkg.resolve()                          # re-solve dependencies without updating
Pkg.instantiate()                      # install all packages from Manifest.toml
Pkg.status()                           # show installed packages
Pkg.test("MyPkg")                      # run package tests
```

### Package Extensions (Julia 1.9+)

Extensions allow conditional loading of code when specific packages are available, without making them hard dependencies.

**In `Project.toml`:**
```toml
[weakdeps]
DataFrames = "a93c6f00-e57d-5684-b466-afe8fa294f37"

[extensions]
MyPkgDataFramesExt = "DataFrames"
```

**Extension file:** `ext/MyPkgDataFramesExt.jl`:
```julia
module MyPkgDataFramesExt

using MyPkg, DataFrames

# Methods that require DataFrames go here
function MyPkg.process(df::DataFrame)
    ...
end

end
```

The extension module is loaded automatically when both `MyPkg` and `DataFrames` are loaded. Before 1.9, this required `Requires.jl`.

### `Project.toml` Structure

```toml
name = "MyPackage"
uuid = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
authors = ["Name <email>"]
version = "1.2.3"

[deps]
JSON = "682c06a0-de6a-54ab-a142-c8b1cf79cde6"
LinearAlgebra = "37e2e46d-f89d-539d-b4ee-838fcccc9c8e"

[weakdeps]
DataFrames = "a93c6f00-e57d-5684-b466-afe8fa294f37"

[compat]
julia = "1.9"
JSON = "0.21"
DataFrames = "1"
```

**`[compat]` is critical.** It specifies the range of compatible versions. Without it, `Pkg.add` may install incompatible versions. Use semantic versioning: `"1"` means `>=1.0, <2.0`; `"0.21"` means `>=0.21, <0.22`.

### Developing a Package

```julia
Pkg.develop("MyPkg")              # clone from registry and check out editable
Pkg.develop(path="/path/to/pkg")  # use local checkout
Pkg.free("MyPkg")                 # return to registered version
```

---

## JuliaFormatter.jl — Code Formatting

### Usage

```julia
using JuliaFormatter
format_file("src/MyModule.jl")
format("src/")   # format all .jl files in directory
```

### Configuration

`.JuliaFormatter.toml` in the project root:

```toml
style = "blue"        # "default", "blue", "yas", "sciml"
indent = 4
margin = 92           # line length
always_use_return = false
```

**`blue` style** (widely used in the Julia ecosystem) enforces:
- 4-space indentation
- No trailing whitespace
- Specific spacing around operators
- Blank lines between top-level definitions

### Common Formatting Rules (blue style)

```julia
# Spaces around binary operators
x = a + b
y = a*b + c*d    # no spaces around * when mixed with +

# Function definitions: no space before (
function f(x, y)   # correct
function f (x, y)  # wrong

# Trailing commas in multi-line collections
x = [
    1,
    2,
    3,    # trailing comma forces expansion
]
```

---

## JET.jl — Static Type Analysis

JET.jl performs interprocedural type-based analysis to detect potential errors without running the code.

### Installation and Usage

```julia
using JET

# Report type errors and method errors
report_call(f, (Int, String))   # analyze f called with (Int, String)

# Analyze a whole package
report_package("MyPackage")

# Use @report_call macro
@report_call f(1, "hello")
```

### Error Types

**`NoMethodError` detection:**
```
═══ 1 possible error found ═══
┌ @ MyModule.jl:10 g(x)
│ no matching method found for call signature `g(::String)`:
│  g(::Int) @ MyModule.jl:5
└─────────────────────────────
```

**`UndefVarError` detection:**
```
═══ 1 possible error found ═══
┌ @ MyModule.jl:15 undefined_name
│ variable `undefined_name` is not defined
└─────────────────────────────
```

### Analysis Mode

```julia
# Default: only reports definite errors
report_call(f, (Int,))

# Opt-in mode: reports more speculative issues
report_call(f, (Int,); mode=:typo)   # also checks for typos in field names

# Sound mode: reports all possible errors
report_call(f, (Int,); mode=:sound)
```

### JET with Test Suite

```julia
using JET, Test

@testset "JET" begin
    @test_call f(1)      # fails if JET finds errors
    @test_call target_modules=[MyModule] g(x)  # restrict to a module
end
```

---

## Aqua.jl — Package Quality

Aqua.jl runs automated quality checks on a package: ambiguous methods, missing compat entries, unbound type parameters, etc.

### Usage

```julia
using Aqua
Aqua.test_all(MyPackage)

# Or individual checks:
Aqua.test_ambiguities(MyPackage)
Aqua.test_unbound_args(MyPackage)
Aqua.test_undefined_exports(MyPackage)
Aqua.test_project_extras(MyPackage)
Aqua.test_stale_deps(MyPackage)
Aqua.test_deps_compat(MyPackage)
Aqua.test_piracies(MyPackage)
```

### Common Findings

**`test_ambiguities`:** finds method ambiguities — two methods equally applicable for some argument types.

**`test_unbound_args`:** finds type parameters in function signatures that are not constrained by the argument types (a common mistake):

```julia
# Bad: T appears only in return type annotation, not in argument types
f(x::Int)::T where T = ...   # T is unbound

# OK: T is bound by argument type
f(x::Vector{T}) where T = first(x)
```

**`test_stale_deps`:** finds packages listed in `[deps]` but not actually used.

**`test_piracies`:** finds methods that extend a function from another package for types from another package — type piracy.

---

## Revise.jl — Live Code Reloading

Revise.jl watches source files and automatically reloads changed code in the running Julia session.

### Setup

Load `Revise` before any packages you want to track:

```julia
# In ~/.julia/config/startup.jl (runs on every Julia session):
try
    using Revise
catch e
    @warn "Revise not available"
end
```

### Usage

```julia
# After loading Revise, develop a package or include a file:
using Revise
using MyPackage         # Revise now tracks MyPackage source files
includet("script.jl")  # includet = include + track

# Edit MyPackage/src/... — changes are available without restarting Julia
```

### Limitations

- **Struct redefinitions are not supported** — adding or removing fields requires restarting Julia. Revise can update methods but not type definitions.
- Macros generated by `@generated` functions may need manual re-evaluation.
- Not all changes are always caught; complex macro-generated code may require restart.

---

## `@code_warntype` — Built-in Type Inference Check

Built-in; no extra package. Shows type-annotated IR with instability highlighted:

```julia
@code_warntype f(1, 2.0)
```

Lines with `::Any` or `Union{...}` in red indicate type instability.

---

## Cthulhu.jl — Type Inference Inspection

Cthulhu.jl provides an interactive browser for `@code_typed` output, allowing drill-down into type inference:

```julia
using Cthulhu
@descend f(1, 2.0)   # interactive TUI for type inference of f(1, 2.0)
```

Inside the TUI:
- Navigate with arrow keys
- Press Enter to descend into a called function
- Red/yellow highlighted variables are type-unstable
- Press `?` for help

---

## BenchmarkTools.jl — Performance Measurement

### Basic Usage

```julia
using BenchmarkTools

@benchmark f(x)          # full benchmark with statistics
@btime f(x)              # quick: minimum time and allocations
@belapsed f(x)           # returns elapsed time as Float64
```

### Interpolating Variables

Always interpolate global variables with `$` to avoid measuring global variable lookup:

```julia
x = rand(1000)

@btime sum($x)       # correct: benchmarks sum, not global lookup
@btime sum(x)        # wrong: includes cost of looking up global x
```

### Interpreting Output

```
  23.456 μs (2 allocations: 16.08 KiB)
```

- **Time:** minimum over many samples (not mean — minimizes noise)
- **Allocations:** heap allocations; 0 allocations means stack-only or no allocation
- High allocation count indicates possible type instability or unnecessary copies

---

## Logging

Julia's standard logging:

```julia
@debug "detailed info"   # only shown at Debug level
@info "normal info"
@warn "something unexpected"
@error "something failed"

# With structured data:
@info "processing" file=filename count=n

# Control log level:
ENV["JULIA_DEBUG"] = "MyModule"   # show @debug from MyModule
```

Third-party: `LoggingExtras.jl` for file sinks, filtering, formatting.

---

## Testing

```julia
using Test

@testset "MyModule" begin
    @test f(1) == 2
    @test_throws ArgumentError f(-1)
    @test_broken f(0) == 0   # known failing test; does not fail the suite
    @test isapprox(f(1.0), 2.0; atol=1e-10)
end
```

Running tests:
```julia
using Pkg
Pkg.test("MyPackage")                              # run package test suite
include("test/runtests.jl")                        # run directly
using ReTestItems; runtests("test/")               # ReTestItems parallel runner
```

**`ReTestItems.jl`:** parallel test runner; test items are annotated with `@testitem`:

```julia
@testitem "f returns correct values" begin
    using MyPackage
    @test MyPackage.f(1) == 2
end
```

---

## What an Agent May Safely Infer

- `Pkg.instantiate()` installs all packages pinned in `Manifest.toml` exactly.
- `@btime` should always use `$var` for global variables to get accurate timings.
- `@code_warntype` with red/yellow output indicates type instability.
- Struct redefinitions require restarting Julia even with Revise.

## What an Agent Must Not Infer Without Evidence

- That a package has a `.JuliaFormatter.toml` — check before assuming any style.
- That `Pkg.update()` is safe — it may change `Manifest.toml` and break reproducibility.
- That JET reports all possible runtime errors — it is conservative; false negatives exist.
- That Revise will pick up all changes — complex macro-generated code may not reload cleanly.

## What Requires Whole-Program Analysis

- Whether `Aqua.test_stale_deps` correctly identifies all unused dependencies (extensions complicate this).
- Whether JET errors are reachable in practice (requires call graph analysis).
