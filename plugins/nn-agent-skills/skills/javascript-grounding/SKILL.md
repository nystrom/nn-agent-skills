---
name: javascript-grounding
description: >-
  Grounding in real JavaScript runtime semantics for coding agents: prototypal
  inheritance, the four `this`-binding rules, closures and var/let/const scoping,
  the event loop, promises and async/await, ESM vs CommonJS, coercion, and the
  language's many footguns (typeof null, NaN, == coercion, sparse arrays). Read
  before reasoning about, explaining, or editing JavaScript. Narrower coverage
  than the Python and Julia skills — two topics so far. Pull the topic reference
  that matches the question.
---

# JavaScript grounding

Ground yourself in what JavaScript actually does at runtime before editing or
explaining it. Coverage is narrower than the Python and Julia skills — two topic
references so far. Read the one that matches your question:

| Question | Read |
|----------|------|
| What does this code actually do? (`var`/`let`/`const`, scoping, hoisting, closures, `this` binding, prototypes, event loop, promises, async/await, ESM vs CJS, coercion) | `references/semantics.md` |
| Footguns: `typeof null`, `NaN`, `-0`, `==` coercion, `parseInt` radix, `var` hoisting, `this` loss, sparse arrays, floating point, `switch` fall-through, UTF-16 strings | `references/sharp-edges.md` |

## Grounding the Active Version

Whenever writing, editing, or explaining JavaScript code, you **MUST** first determine the active JavaScript runtime environment (e.g. Node.js, Deno, Bun, or Browser) and module system (ESM vs. CommonJS) to reference correct features and APIs.

To detect the environment and runtime version:
1. Check `package.json` (look for `"type": "module"` for ESM, or engines section specifying Node version).
2. Look for configuration files like `tsconfig.json`, `deno.json`, or project lockfiles.
3. If still unresolved, run:
   ```bash
   node --version
   ```

## What an agent must not infer

Do not assume JavaScript behaves like Python, Java, or any language you were
trained on. Each reference has a "What an Agent May/Must Not Infer" section —
consult it rather than pattern-matching across languages.
