# Julia Standard Library Reference

Julia's standard library is split into **Base** (always available, no `using` needed) and **stdlib packages** (shipped with Julia but require `using PackageName`).

**Key convention:** functions ending in `!` mutate their first argument. Functions without `!` return a new value and do not modify inputs.

---

## Base — Always Available

### Arrays and Collections

```julia
# Construction
zeros(T, dims...)          # zeros(Float64, 3, 4) — array of zeros
ones(T, dims...)           # ones(Int, 5)
fill(value, dims...)       # fill(0, 3, 3)
range(start, stop; length=n)   # range(0, 1, length=11)
range(start; step=s, length=n) # range(0, step=0.1, length=11)
collect(range_or_generator)    # materialize a lazy iterator to Vector
similar(A)                 # array of same type/shape but uninitialized
copy(A)                    # shallow copy

# Mutation (all end in !)
push!(v, x)               # append x to end of vector
push!(v, x, y, z)         # append multiple
pop!(v)                   # remove and return last element
pushfirst!(v, x)          # prepend
popfirst!(v)              # remove and return first element
insert!(v, i, x)          # insert x at index i (1-indexed)
deleteat!(v, i)           # delete element at index i
deleteat!(v, inds)        # delete multiple indices
append!(v, iterable)      # extend vector with iterable
prepend!(v, iterable)     # prepend iterable to vector
resize!(v, n)             # resize to n elements
empty!(v)                 # remove all elements; returns v
sort!(v)                  # sort in place
sort!(v; rev=true)        # reverse sort in place
shuffle!(v)               # shuffle in place (requires `using Random`)
unique!(v)                # remove duplicates in place, preserving order
filter!(predicate, v)     # remove elements where predicate returns false

# Non-mutating counterparts (return new array)
sort(v)
sort(v; rev=true, by=fn)  # sort by key function
filter(predicate, v)      # new array with elements where predicate is true
reverse(v)                # new reversed array
unique(v)                 # new array with duplicates removed

# Indexing (1-BASED)
v[1]         # first element
v[end]       # last element
v[end-1]     # second-to-last
v[2:5]       # elements 2 through 5 (inclusive both ends)
v[2:2:end]   # every other element from 2 to end
v[:]         # all elements (copy for arrays)

# Querying
length(v)             # number of elements
size(A)               # tuple of dimensions
size(A, dim)          # size along dimension dim
ndims(A)              # number of dimensions
axes(A)               # tuple of valid index ranges
eachindex(A)          # iterator over valid indices (preferred over 1:length(A))
eltype(v)             # element type
isempty(v)            # true if length == 0
in(x, v)  # or x in v  # membership test (linear scan; O(n))

# Reduction
sum(v)
sum(fn, v)            # sum(abs2, v) — applies fn before summing
prod(v)
minimum(v), maximum(v)
minimum(fn, v), maximum(fn, v)   # extrema after applying fn
extrema(v)            # (minimum, maximum)
any(v), all(v)        # for boolean arrays
any(pred, v)          # any(iseven, [1, 2, 3])
all(pred, v)
count(pred, v)        # count elements satisfying predicate
sum(pred, v)          # equivalent but returns Int

# Transformation
map(f, v)             # new array: [f(x) for x in v]
map!(f, dst, src)     # in-place: dst[i] = f(src[i])
broadcast(f, A, B)    # element-wise; f.(A, B) is syntactic sugar
mapreduce(f, op, v)   # map then reduce
accumulate(op, v)     # running accumulation
cumsum(v)             # cumulative sum
cumprod(v)            # cumulative product

# Searching
findfirst(pred, v)    # index of first match (or nothing)
findlast(pred, v)
findall(pred, v)      # all indices where predicate is true
findmax(v)            # (max_value, index_of_max)
findmin(v)            # (min_value, index_of_min)
argmax(v)             # index of maximum
argmin(v)

# Multidimensional
vcat(A, B)            # concatenate vertically (along dim 1)
hcat(A, B)            # concatenate horizontally (along dim 2)
cat(A, B; dims=3)     # concatenate along specified dimension
reshape(A, dims...)   # reshape without copying
vec(A)                # flatten to 1D (may share memory)
transpose(A)          # lazy transpose (for numbers; adjoint for complex)
A'                    # adjoint (conjugate transpose; same as transpose for real)
permutedims(A, perm)  # generalized transpose
```

**What does NOT exist in Base:**
- `push` (without `!`) — use `push!` or `vcat(v, [x])` for non-mutating
- `array.map(f)` — method syntax; use `map(f, array)`
- `array.filter(f)` — use `filter(f, array)`
- `array.length` — use `length(array)` (function, not property)

---

### Strings

```julia
# Construction
"hello"                   # UTF-8 string literal
"""multiline
   string"""              # triple-quoted string
"value is $x"             # string interpolation
"$(x + y) result"         # interpolate expression

# Concatenation
"hello" * " " * "world"  # concatenation uses *, not +
join(["a", "b", "c"], ", ")  # "a, b, c"
join(["a", "b", "c"])        # "abc"

# Querying
length(s)                 # number of characters (Unicode code points)
ncodeunits(s)             # number of bytes in UTF-8 encoding
sizeof(s)                 # same as ncodeunits
isempty(s)
startswith(s, prefix)
endswith(s, suffix)
contains(s, substring)    # true if substring found; also: occursin(sub, s)
occursin(pattern, s)      # also works with Regex

# Searching and extraction
findfirst(pattern, s)     # index (or nothing) of first match
findlast(pattern, s)
findall(pattern, s)       # all match positions
s[1:5]                    # substring by byte index — use with care for Unicode
SubString(s, i, j)        # substring view (no copy)
first(s, n)               # first n characters
last(s, n)                # last n characters
chop(s; head=0, tail=1)   # remove head chars from start, tail from end

# Transformation
uppercase(s)
lowercase(s)
titlecase(s)
strip(s)                  # remove leading/trailing whitespace
strip(s, chars)           # remove specific characters
lstrip(s), rstrip(s)
replace(s, old => new)    # "hello" → replace("hello", "l" => "r") = "herro"
replace(s, pattern => fn) # replace with function applied to match
split(s)                  # split on whitespace
split(s, delim)           # split on delimiter
split(s, delim; limit=n)  # at most n parts
splitlines(s)             # NOT splitlines(); use split(s, "\n") or eachline(IOBuffer(s))
rsplit(s, delim; limit=n) # split from right

# Formatting
string(x)                 # convert to string
string(x, base=16)        # integer to hex string
repr(x)                   # "show" representation
lpad(s, n, ' ')           # left-pad string to width n
rpad(s, n, ' ')           # right-pad

# Regex
using Base: Regex    # Regex is in Base; no import needed
r"pattern"                # literal Regex (r-prefix)
r"pattern"i               # case-insensitive flag
match(r"(\w+)", s)        # first match (or nothing); returns RegexMatch
eachmatch(r"\d+", s)      # iterator of all matches
occursin(r"pattern", s)   # true if any match
replace(s, r"pattern" => "new")

m = match(r"(\w+)@(\w+)", "user@example")
m.match                   # full match string
m.captures                # ["user", "example"]
m[1], m[2]                # capture groups by index
```

**Agent traps:**
- String concatenation is `*` not `+`
- `split(s)` exists but `splitlines(s)` does NOT — use `split(s, '\n')` or `eachline`
- String indexing is by **byte position**, not character position; use `eachindex(s)` or `iterate` for safe character iteration

---

### Dictionaries

```julia
# Construction
d = Dict("a" => 1, "b" => 2)
d = Dict{String, Int}()

# Access
d["key"]                   # KeyError if missing
get(d, "key", default)     # return default if missing (non-mutating)
get!(d, "key", default)    # insert default if missing, return value (mutating)

# Mutation
d["key"] = value
delete!(d, "key")          # remove key (does nothing if missing)
pop!(d, "key")             # remove and return value (KeyError if missing)
pop!(d, "key", default)    # remove and return value or default

# Querying
haskey(d, "key")
length(d)
isempty(d)
keys(d)                    # KeySet view
values(d)                  # ValuesIterator view
pairs(d)                   # iterator of key => value pairs

# Transformation
merge(d1, d2)              # new dict; d2 values win on conflicts
merge(combine, d1, d2)     # combine(v1, v2) for conflicts
merge!(d1, d2)             # in-place; d2 values win

# Comprehension
Dict(k => v for (k, v) in zip(ks, vs))
```

---

### I/O

```julia
# Printing
print(x)                   # no newline
println(x)                 # with newline
println(io, x)             # print to specific IO stream
print(io, x, y, z)        # multiple args concatenated

# Files
open("file.txt") do io     # opens and closes automatically
    read(io, String)        # read entire file as string
end

content = read("file.txt", String)    # shorthand: read file to string
lines = readlines("file.txt")         # Vector{String}, one per line
for line in eachline("file.txt")      # lazy line iteration
    process(line)
end

write("file.txt", content)            # write string/bytes to file

# Write with open
open("output.txt", "w") do io
    println(io, "line 1")
    write(io, "raw bytes or string")
end

# Open modes: "r" (read), "w" (write/truncate), "a" (append), "r+" (read+write)

# IOBuffer (in-memory IO)
buf = IOBuffer()
write(buf, "hello")
println(buf, " world")
String(take!(buf))         # "hello world\n"

buf = IOBuffer("existing content")
read(buf, String)
```

---

### Math and Numeric

```julia
# Basic
abs(x), abs2(x)           # absolute value, squared absolute value
sign(x)                   # -1, 0, or 1
floor(x), ceil(x), round(x), trunc(x)    # return same type as input
floor(Int, x)             # convert to Int while rounding down
div(x, y)                 # integer division (truncates toward zero)
fld(x, y)                 # floor division (toward -∞, like Python's //)
mod(x, y)                 # modulo (same sign as y, like Python's %)
rem(x, y)                 # remainder (same sign as x)
gcd(a, b), lcm(a, b)
sqrt(x)                   # DomainError for negative; use sqrt(Complex(x))
cbrt(x)                   # cube root
^                          # exponentiation: 2^10 = 1024

# Float
typemax(Float64), typemin(Float64)
Inf, -Inf, NaN            # special float values
isinf(x), isnan(x), isfinite(x)
isapprox(a, b; atol=0, rtol=√eps())   # approximate equality; also: a ≈ b
eps(Float64)              # machine epsilon: ~2.2e-16
nextfloat(x), prevfloat(x)

# Integer
typemax(Int64)            # 9223372036854775807
typemin(Int64)            # -9223372036854775808
# Overflow wraps silently in arithmetic — use Base.checked_add etc. for safety
Base.checked_add(a, b)   # OverflowError instead of wrap
Base.checked_mul(a, b)
big(n)                   # convert to BigInt or BigFloat for arbitrary precision

# Math functions (all in Base)
exp(x), log(x), log2(x), log10(x)
sin(x), cos(x), tan(x)   # radians
asin(x), acos(x), atan(x)
atan(y, x)                # two-argument atan2
deg2rad(x), rad2deg(x)
hypot(x, y)               # √(x²+y²)
clamp(x, lo, hi)          # min(hi, max(lo, x))
```

---

### Control Flow Utilities

```julia
# Iteration
for (i, x) in enumerate(v)   # (index, value) pairs; 1-indexed
for (a, b) in zip(v1, v2)
for x in Iterators.reverse(v)  # iterate in reverse (lazy)
foreach(f, v)                  # apply f to each element for side effects

# Laziness (Iterators module is in Base)
Iterators.map(f, v)            # lazy map
Iterators.filter(pred, v)      # lazy filter
Iterators.flatten(v)           # lazy flatten one level
Iterators.zip(v1, v2)
Iterators.enumerate(v)
Iterators.take(v, n)
Iterators.drop(v, n)
Iterators.cycle(v)
Iterators.repeated(x, n)
collect(lazy_iterator)         # materialize to array
```

---

## Standard Library Packages (require `using`)

These are included with Julia but must be explicitly loaded:

---

### `LinearAlgebra`

```julia
using LinearAlgebra

# Matrix operations
det(A)                # determinant
inv(A)                # matrix inverse
tr(A)                 # trace (sum of diagonal)
rank(A)               # matrix rank
norm(v)               # Euclidean norm (L2)
norm(v, p)            # Lp norm (p=1, 2, Inf)
normalize(v)          # unit vector
dot(u, v)             # dot product; also u ⋅ v
cross(u, v)           # cross product (3D vectors)

# Factorizations
eigen(A)              # eigenvalues and eigenvectors; returns Eigen object
svd(A)                # SVD; returns SVD object with .U, .S, .Vt
qr(A)                 # QR factorization
cholesky(A)           # Cholesky (for positive definite A)
lu(A)                 # LU factorization

# Special matrices
I                     # UniformScaling identity (works for any size)
Diagonal([1, 2, 3])   # diagonal matrix
Symmetric(A)          # symmetric matrix wrapper
Hermitian(A)          # Hermitian matrix wrapper
UpperTriangular(A), LowerTriangular(A)

# Linear solve
A \ b                 # solve Ax = b (preferred over inv(A) * b)
```

---

### `Statistics`

```julia
using Statistics

mean(v)
mean(v; dims=1)       # along dimension
median(v)
std(v)                # standard deviation (with Bessel's correction n-1)
std(v; corrected=false)  # divide by n
var(v)                # variance
cov(v)                # covariance matrix for matrix input
cor(v)                # correlation matrix
quantile(v, p)        # p-th quantile (p in [0, 1])
quantile(v, [0.25, 0.5, 0.75])
```

---

### `Random`

```julia
using Random

rand()                # uniform Float64 in [0, 1)
rand(n)               # n-element Vector of uniform Float64
rand(T, n)            # Vector{T} of n random values
rand(1:10)            # random integer in 1:10
rand(1:10, n)         # n random integers
rand(collection)      # random element from collection
rand(collection, n)   # n random elements (with replacement)

randn()               # standard normal Float64
randn(n)              # Vector of n standard normal values
randn(T, dims...)     # array of given type/shape

randperm(n)           # random permutation of 1:n

shuffle(v)            # new shuffled array
shuffle!(v)           # in-place shuffle

# Seeding for reproducibility
seed!(42)             # seed global RNG
seed!(rng, 42)        # seed specific RNG

# Custom RNG
rng = MersenneTwister(42)
rand(rng, 10)
```

---

### `Dates`

```julia
using Dates

# Types
Date(2024, 1, 15)          # date only
DateTime(2024, 1, 15, 10, 30, 0)  # date + time
Time(10, 30, 0)            # time only

# Current
today()                    # current Date
now()                      # current DateTime (local time)
now(UTC)                   # current DateTime in UTC

# Parsing
Date("2024-01-15")                    # ISO format
Date("01/15/2024", dateformat"mm/dd/yyyy")
DateTime("2024-01-15T10:30:00")

# Formatting
Dates.format(d, "yyyy-mm-dd")
Dates.format(dt, dateformat"dd/mm/yyyy HH:MM")

# Components
year(d), month(d), day(d)
hour(dt), minute(dt), second(dt), millisecond(dt)
dayofweek(d)               # 1=Monday, 7=Sunday
dayofyear(d)
isleapyear(d)

# Arithmetic — use Period types
d + Day(7)
dt + Hour(3) + Minute(30)
d2 - d1                    # returns Day period
Dates.value(Day(5))        # 5 (extract numeric value)

# Period types
Year(n), Month(n), Week(n), Day(n)
Hour(n), Minute(n), Second(n), Millisecond(n)

# Ranges
Date(2024, 1, 1):Day(1):Date(2024, 12, 31)   # date range
```

---

### `Printf`

```julia
using Printf

@printf("x = %d, y = %.2f\n", x, y)     # print to stdout
@printf(io, "formatted %s\n", str)       # print to IO stream

s = @sprintf("x = %d", x)               # format to string
```

Format specifiers: `%d` (int), `%f` (float), `%e` (scientific), `%g` (auto), `%s` (string), `%x` (hex), `%.2f` (2 decimal places), `%10d` (width 10), `%-10d` (left-aligned).

---

### `Test`

```julia
using Test

@testset "Description" begin
    @test expr                      # passes if expr is true
    @test a ≈ b                     # approximate equality (atol/rtol can be added)
    @test isapprox(a, b; atol=1e-6)
    @test_throws ExceptionType expr  # passes if expr throws ExceptionType
    @test_throws "message substring" expr  # check error message (1.8+)
    @test_nowarn expr               # passes if no warnings
    @test_warn "pattern" expr       # passes if warning matches pattern
    @test_broken expr               # known-failing test; does not fail suite
    @test_skip expr                 # skipped test; marks as broken
end

# Nested testsets
@testset "Outer" begin
    @testset "Inner $i" for i in 1:3
        @test f(i) == expected[i]
    end
end
```

---

### `Logging`

```julia
# Logging macros are in Base (no using needed):
@debug "detailed info"
@info "normal info"
@warn "unexpected"
@error "something failed"

# With structured data:
@info "request" method="GET" path="/api/data" status=200

# Control level:
ENV["JULIA_DEBUG"] = "MyModule"    # show @debug from specific module
ENV["JULIA_DEBUG"] = "all"         # show all @debug

# using Logging for custom loggers
using Logging

global_logger(ConsoleLogger(stderr, Logging.Debug))   # set global logger
with_logger(ConsoleLogger(devnull)) do                # suppress logging in block
    noisy_function()
end
```

---

### `Base64`

```julia
using Base64

base64encode(data)          # encode bytes or string to base64 String
base64decode(str)           # decode base64 String to Vector{UInt8}

String(base64decode(str))   # decode to string if input was text
```

---

## What Is NOT in the Julia Standard Library

These are commonly assumed to be built-in but require installing third-party packages:

| Capability | Package |
|-----------|---------|
| HTTP requests | `HTTP.jl` |
| JSON parsing | `JSON3.jl` or `JSON.jl` |
| DataFrames (tabular data) | `DataFrames.jl` |
| Plots / visualization | `Plots.jl`, `Makie.jl`, `CairoMakie.jl` |
| CSV reading | `CSV.jl` |
| Arrow/Parquet | `Arrow.jl` |
| Optimization | `JuMP.jl`, `Optim.jl` |
| Machine learning | `Flux.jl`, `MLJ.jl` |
| Symbolic math | `Symbolics.jl` |
| Differential equations | `DifferentialEquations.jl` |
| Sparse arrays (operations) | `SparseArrays` stdlib + `SuiteSparse` |

---

## What an Agent May Safely Infer

- Mutation functions end in `!`: `push!`, `sort!`, `filter!`, `map!`, `shuffle!`.
- Non-`!` versions (`sort`, `filter`, `map`) return new arrays and leave inputs unchanged.
- `length(v)` is a function call, not `v.length` (no property syntax).
- `LinearAlgebra`, `Statistics`, `Random`, `Dates`, `Printf`, `Test` require `using` even though they ship with Julia.
- HTTP, JSON, DataFrames are third-party — not in Base or stdlib.

## What an Agent Must Not Infer Without Evidence

- That `push` (without `!`) exists — it does not; use `push!` or create a new array.
- That `"a" + "b"` concatenates strings — use `"a" * "b"` or `string("a", "b")`.
- That negative indexing wraps like Python — `v[-1]` is a `BoundsError`.
- That `splitlines(s)` exists — use `split(s, '\n')` or `eachline`.
- That `sort` on a Dict is defined — sort the `collect(keys(d))` instead.
