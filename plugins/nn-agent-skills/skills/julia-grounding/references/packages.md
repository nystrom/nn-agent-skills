# Julia Package Management

## CRITICAL RULE: Never Write UUIDs Manually

Julia's `Project.toml` uses UUIDs to identify packages. These UUIDs come from the General registry and must be exact. **Never guess, invent, or copy a UUID.** Always use `Pkg` functions to add packages — Pkg looks up the correct UUID from the registry automatically.

```julia
# WRONG — do not edit Project.toml manually to add dependencies
# [deps]
# DataFrames = "a93c6f00-e57d-5684-b466-afe8fa294f37"   ← never write this yourself

# CORRECT — let Pkg handle UUIDs
using Pkg
Pkg.add("DataFrames")   # Pkg writes the correct UUID to Project.toml
```

The same rule applies to `Manifest.toml` — never edit it manually. It is fully managed by Pkg.

---

## Environments

Every Julia project should have its own environment: a `Project.toml` declaring dependencies and a `Manifest.toml` with the exact resolved versions.

```julia
using Pkg

# Activate a project environment
Pkg.activate(".")                    # activate project in current directory
Pkg.activate("/path/to/project")     # absolute path
Pkg.activate(temp=true)              # temporary environment (testing, scripts)

# The environment in effect determines which packages are available
# Always activate before adding/removing packages

# In the REPL's package mode (] at the prompt):
# ] activate .
# ] activate /path/to/project
```

**Do not use the default global environment** (`~/.julia/environments/vX.Y`) for project work. It accumulates packages and creates version conflicts. Each project should have its own environment.

---

## Adding Packages

```julia
using Pkg

# Add by name (Pkg resolves UUID from General registry)
Pkg.add("DataFrames")

# Add multiple packages
Pkg.add(["DataFrames", "CSV", "JSON3"])

# Add a specific version
Pkg.add(name="DataFrames", version="1.6")
Pkg.add(PackageSpec(name="DataFrames", version="1.6.1"))

# Add from a Git URL (not in registry)
Pkg.add(url="https://github.com/user/MyPackage.jl")
Pkg.add(url="https://github.com/user/MyPackage.jl", rev="main")     # branch
Pkg.add(url="https://github.com/user/MyPackage.jl", rev="v1.2.3")   # tag
Pkg.add(url="https://github.com/user/MyPackage.jl", rev="abc1234")  # commit

# Add from local path
Pkg.add(path="/local/path/to/MyPackage")
```

---

## Removing and Updating Packages

```julia
# Remove a package (removes from Project.toml and updates Manifest.toml)
Pkg.rm("DataFrames")
Pkg.rm(["DataFrames", "CSV"])

# Update packages
Pkg.update()                   # update all packages (may change Manifest.toml)
Pkg.update("DataFrames")       # update only DataFrames

# Re-solve dependencies without upgrading
Pkg.resolve()                  # resolve with current compat constraints

# Install all packages from existing Manifest.toml (reproducible install)
Pkg.instantiate()              # installs exact versions from Manifest.toml
# Use this when cloning a project: cd("project"); Pkg.activate("."); Pkg.instantiate()
```

---

## Querying Status

```julia
Pkg.status()              # list installed packages and versions
Pkg.status("DataFrames")  # status of one package
Pkg.status(; mode=PKGMODE_PROJECT)   # only direct dependencies (not transitive)

# Equivalent REPL shorthand:
# ] status
# ] st
```

---

## Package Development (Working on a Package Locally)

```julia
# Develop a registered package (checks out editable copy to ~/.julia/dev/)
Pkg.develop("MyPackage")

# Develop from a local path (no copy; edits the package in-place)
Pkg.develop(path="/path/to/MyPackage.jl")

# Return to the registered (non-editable) version
Pkg.free("MyPackage")
```

When `Pkg.develop` is used, changes to the package source are immediately available without re-adding the package.

---

## Creating a New Package

```julia
# Generate a new package structure in the current directory
Pkg.generate("MyNewPackage")
# Creates:
#   MyNewPackage/
#   ├── Project.toml      (with name, uuid, version, author)
#   └── src/
#       └── MyNewPackage.jl

# The UUID is generated automatically — do not change it
```

For more complete scaffolding (tests, CI, docs), use `PkgTemplates.jl`:
```julia
Pkg.add("PkgTemplates")
using PkgTemplates
t = Template(; user="YourGitHubName", plugins=[Tests(), CI(), Documenter()])
t("MyNewPackage")
```

---

## Testing Packages

```julia
Pkg.test("MyPackage")      # run package's test/runtests.jl
Pkg.test()                 # test the currently active project
```

---

## `Project.toml` Structure

Pkg manages this file. The sections you may need to edit manually:

```toml
name = "MyPackage"
uuid = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # NEVER change this
authors = ["Author Name <email@example.com>"]
version = "1.2.3"

[deps]
# DO NOT edit this section manually — use Pkg.add() and Pkg.rm()
# Pkg writes correct names and UUIDs here

[compat]
# THIS SECTION you must maintain — specify compatible version ranges
julia = "1.9"          # minimum Julia version
DataFrames = "1"       # >= 1.0.0, < 2.0.0 (caret semantics)
CSV = "0.10"           # >= 0.10.0, < 0.11.0
JSON3 = "1.9, 1.10"   # >= 1.9.0, < 1.10.0 OR >= 1.10.0, < 1.11.0 (comma = OR)

[extras]
# Test-only dependencies (not in [deps])
Test = "8dfed614-e22c-5e08-85e1-65c5234f0b40"   # stdlib UUID — OK to have here
                                                  # stdlibs have stable UUIDs

[targets]
test = ["Test"]
```

### `[compat]` version syntax

| Entry | Meaning |
|-------|---------|
| `"1"` | `≥ 1.0.0, < 2.0.0` |
| `"1.6"` | `≥ 1.6.0, < 1.7.0` |
| `"1.6.1"` | `≥ 1.6.1, < 1.6.2` |
| `"0.10"` | `≥ 0.10.0, < 0.11.0` |
| `"0.10.1"` | `≥ 0.10.1, < 0.10.2` |
| `"1, 2"` | `(≥ 1.0.0, < 2.0.0) OR (≥ 2.0.0, < 3.0.0)` |
| `"~1.6"` | `≥ 1.6.0, < 1.7.0` (tilde, same as "1.6") |

**Always add compat entries for all dependencies.** Without them, `Pkg.add` on a new machine may pick up an incompatible version. Use `Pkg.compat` (or `] compat`) to set them interactively with the correct current versions pre-filled.

```julia
# Set compat entries interactively (fills in current installed versions):
Pkg.compat()    # or ] compat in REPL
```

---

## `Manifest.toml`

- Contains exact versions of all packages (direct and transitive) plus their UUIDs.
- **Never edit manually** — always regenerated by Pkg operations.
- **Commit to version control** for applications (ensures reproducibility).
- **Do not commit** for libraries/packages (let users resolve their own compatible versions).

---

## Finding Packages

To find a package that does what you need:

1. **JuliaHub** (`juliahub.com`) — searchable index of all registered Julia packages.
2. **Julia General Registry** — the registry file is at `~/.julia/registries/General/`.
3. **Pkg.REPL search**: `] add PackageName` — if the name is wrong, Pkg will suggest close matches.

```julia
# Search (fuzzy) in the General registry:
# In REPL package mode: ] add Dat<TAB>  (tab completion for package names)
```

---

## Package Registries

By default Julia uses the **General** registry hosted at `https://github.com/JuliaRegistries/General`. You can add private or alternative registries:

```julia
Pkg.Registry.add(RegistrySpec(url="https://github.com/MyOrg/MyRegistry"))
Pkg.Registry.update()    # update all registries
Pkg.Registry.status()    # list installed registries
```

---

## Common Workflows

### Cloning and running an existing project

```julia
# (in shell) git clone https://github.com/user/project.jl && cd project.jl
using Pkg
Pkg.activate(".")
Pkg.instantiate()   # installs exact versions from Manifest.toml
```

### Adding a dependency to a package you're developing

```julia
Pkg.activate(".")
Pkg.add("NewDependency")     # Pkg updates Project.toml and Manifest.toml
Pkg.compat()                  # set compat entry for the new dependency
```

### Pinning a version (prevent updates)

```julia
Pkg.pin("DataFrames")              # pin to currently installed version
Pkg.pin(name="DataFrames", version="1.5.0")  # pin to specific version
Pkg.free("DataFrames")             # unpin
```

---

## What an Agent May Safely Infer

- `Pkg.add("Name")` correctly resolves and writes the UUID — never write UUIDs manually.
- `Pkg.instantiate()` is the correct way to install from an existing `Manifest.toml`.
- `Manifest.toml` is auto-generated; never edit it.
- `[compat]` entries use caret semantics: `"1"` allows `< 2.0.0`.
- `Pkg.develop(path=...)` enables editing a local package without re-adding it.

## What an Agent Must Not Infer Without Evidence

- That a package name in `[deps]` is sufficient — the UUID must also be present (written by Pkg).
- That `Pkg.update()` is safe to run in a shared environment — it modifies `Manifest.toml` and may break reproducibility.
- That package names are globally unique — different registries may have packages with the same name.
- That `using PackageName` will work without `Pkg.add("PackageName")` first (unless it is a stdlib package).
