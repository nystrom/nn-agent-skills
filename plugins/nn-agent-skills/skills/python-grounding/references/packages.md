# Python Package Management

---

## Virtual Environments

Always use a virtual environment for project work. Never install project dependencies into the system Python or the user's base environment.

### `venv` (built-in, Python 3.3+)

```bash
# Create
python -m venv .venv               # creates .venv/ directory
python3.11 -m venv .venv           # specify Python version

# Activate (per-shell)
source .venv/bin/activate          # macOS / Linux (bash/zsh)
.venv\Scripts\activate             # Windows cmd
.venv\Scripts\Activate.ps1         # Windows PowerShell

# Deactivate
deactivate

# Verify
which python                       # should show .venv/bin/python
python --version
```

The activated environment puts `.venv/bin/` first in `PATH`, so `python` and `pip` refer to the venv's executables.

---

## `pip` — Standard Package Installer

```bash
# Install
pip install requests
pip install "requests>=2.28,<3"        # version constraint
pip install requests==2.31.0           # exact version
pip install requests[security]         # extra dependencies
pip install -r requirements.txt        # install from requirements file

# Upgrade
pip install --upgrade requests
pip install --upgrade pip              # upgrade pip itself

# Uninstall
pip uninstall requests
pip uninstall -y requests              # no confirmation prompt

# List installed packages
pip list
pip list --outdated

# Show package info
pip show requests                      # version, location, dependencies

# Generate requirements file
pip freeze > requirements.txt          # exact versions of all installed packages
pip freeze | grep -v "^-e" > requirements.txt  # exclude editable installs

# Install from requirements file
pip install -r requirements.txt

# Editable install (development mode)
pip install -e .                       # install current directory as editable
pip install -e ".[dev,test]"           # with extras
```

---

## `uv` — Modern Fast Package Manager

`uv` is a fast drop-in replacement for `pip` and `venv`, written in Rust. Use it for new projects.

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh
# or: pip install uv  (but prefer the installer)

# Virtual environments
uv venv                          # create .venv/ using the best available Python
uv venv --python 3.11            # specify Python version

# Package operations (no activation needed — uv finds .venv automatically)
uv pip install requests
uv pip install -r requirements.txt
uv pip install -e .
uv pip freeze
uv pip list

# Project management (uv native, preferred for new projects)
uv init myproject                # create new project with pyproject.toml
uv add requests                  # add dependency to pyproject.toml
uv add "requests>=2.28"          # with version constraint
uv add --dev pytest              # add dev dependency
uv remove requests               # remove dependency
uv sync                          # install all dependencies from pyproject.toml
uv run python script.py          # run in project environment
uv run pytest                    # run command in project environment
uv lock                          # generate/update uv.lock
```

---

## `pyproject.toml` — Modern Project Metadata (PEP 517/518/621)

`pyproject.toml` is the standard configuration file for Python projects. It replaces `setup.py` and `setup.cfg`.

```toml
[build-system]
requires = ["hatchling"]                    # or "setuptools>=61", "flit_core>=3", etc.
build-backend = "hatchling.build"           # build backend

[project]
name = "my-package"
version = "1.0.0"
description = "Short description"
readme = "README.md"
license = { text = "MIT" }
requires-python = ">=3.9"
authors = [
    { name = "Author Name", email = "author@example.com" }
]

# Runtime dependencies
dependencies = [
    "requests>=2.28",
    "pydantic>=2.0,<3",
    "click>=8.0",
]

# Optional dependencies (extras)
[project.optional-dependencies]
dev = [
    "pytest>=7",
    "ruff",
    "mypy",
]
docs = [
    "sphinx>=6",
    "sphinx-rtd-theme",
]

# Entry points (console scripts)
[project.scripts]
my-cli = "my_package.cli:main"

# URLs
[project.urls]
Homepage = "https://github.com/user/my-package"
Repository = "https://github.com/user/my-package"

# Tool configuration (co-located in pyproject.toml)
[tool.ruff]
target-version = "py39"

[tool.mypy]
python_version = "3.11"
strict = true

[tool.pytest.ini_options]
testpaths = ["tests"]
```

---

## `requirements.txt`

For simpler scripts or when not using `pyproject.toml`:

```text
# Unpinned (allow compatible updates)
requests>=2.28
pydantic>=2.0,<3

# Pinned (exact reproducibility)
requests==2.31.0
pydantic==2.5.3

# From VCS
git+https://github.com/user/package.git@main

# From local path
-e /path/to/local/package    # editable
./path/to/package             # non-editable
```

**When to pin vs constrain:**
- **Applications and deployments:** pin exact versions (`==`) for reproducibility.
- **Libraries:** use ranges (`>=x.y,<x+1`) so users' dependency solvers can find compatible versions.

---

## `pip-tools` — Requirements Compilation

`pip-tools` compiles abstract requirements into pinned, hashed requirements files.

```bash
pip install pip-tools

# Compile requirements.in → requirements.txt (with exact pins)
pip-compile requirements.in
pip-compile pyproject.toml               # reads from pyproject.toml [project.dependencies]
pip-compile --upgrade                    # update all to latest compatible
pip-compile --upgrade-package requests   # update only requests

# Sync environment to compiled requirements
pip-sync requirements.txt
```

---

## Version Specifiers

```
package==1.0.0          exact version
package>=1.0.0          at least 1.0.0
package>=1.0.0,<2.0.0   1.0.0 up to (not including) 2.0.0
package~=1.4            compatible release: >=1.4, <2.0 (same as >=1.4,==1.*)
package~=1.4.2          compatible: >=1.4.2, <1.5.0
package!=1.3.0          exclude specific version
```

---

## Finding Packages

- **PyPI** (`pypi.org`) — the official Python Package Index; all `pip install` packages come from here by default.
- `pip search` is disabled (decommissioned). Use the PyPI website or `uv tool search` instead.

---

## Editable Installs

Editable installs (`pip install -e .`) make the package importable from its source directory. Changes to source files are immediately reflected without reinstalling.

```bash
# For a package with pyproject.toml:
pip install -e .              # standard editable install
pip install -e ".[dev,test]"  # with extras

# Verify:
pip show my-package            # Location points to your source directory
```

---

## Common Patterns

### Set up a new project

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"        # install with dev extras
```

Or with uv:
```bash
uv init myproject
cd myproject
uv add requests
uv add --dev pytest ruff mypy
uv sync
```

### Install from an existing project

```bash
git clone https://github.com/user/project && cd project
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"        # installs all deps including dev
# or:
pip install -r requirements.txt
```

---

## What an Agent May Safely Infer

- `pip install PackageName` installs from PyPI.
- `pip install -e .` requires a `pyproject.toml` or `setup.py` in the current directory.
- `pip freeze` produces exact pinned versions of everything installed.
- `uv` is a faster drop-in; `uv pip install` has the same semantics as `pip install`.
- `requires-python = ">=3.9"` in `pyproject.toml` sets the minimum Python version.

## What an Agent Must Not Infer Without Evidence

- That `pip install` without an active venv is safe — it installs to the system Python or user site.
- That `~=1.4` means exactly 1.4 — it means `>=1.4, <2.0`.
- That all packages on PyPI are safe — always evaluate package provenance before adding dependencies.
- That `requirements.txt` and `pyproject.toml` serve the same purpose — `requirements.txt` pins environments; `pyproject.toml` declares abstract dependencies for packages.
