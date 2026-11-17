# Languages

Two kinds of fact appear here:

- **Table**: `scripts/languages.mjs` has patterns for the language, and
  `scripts/candidates.test.mjs` checks one sample per row: a dispatch and an
  empty handler for TypeScript, Python, Go, and Java; a dispatch for C;
  a wildcard dispatch for Kotlin and Swift; a wildcard dispatch and two
  discard forms for Rust; an empty handler for Ruby and Julia. Other patterns in
  the table are untested. No compiler or language server was run for any
  language.
- **Guidance**: how the language behaves. These facts come from the language
  definitions and are not tested by this skill. Check them with the language
  server or a scratch compile before you rely on one.

For a language not listed, apply the rule from SKILL.md and fill in this table
for it in the report.

| Language | Table | Exhaustive dispatch (guidance) | Closes with (guidance) | Empty or discarding handler forms |
| -------- | ----- | ------------------------------ | ---------------------- | --------------------------------- |
| TypeScript, JavaScript | yes | `switch` is exhaustive only through the return type or a `never` assignment | `default:` with `const _x: never = v`, or a helper that takes `never` | `catch {}`, `.catch(() => {})` |
| Python | yes | `match` is not checked by the interpreter; type checkers report it | `case _:` calling `assert_never(v)` | `except X: pass` |
| Go | yes | `switch` over named constants is not checked by the compiler; linters such as `exhaustive` check it | an exhaustiveness linter that fails the build; a `default:` that panics only fails at run time | `if err != nil {}`, `_ = err` |
| C, C++ | yes | `switch` over an enum warns under `-Wswitch` when there is no `default`; `-Wswitch-enum` also warns when a `default` is present | `-Werror=switch` or `-Werror=switch-enum` so the warning fails the build | empty `catch (...) {}` |
| Java | yes | `switch` over a sealed type or enum in a switch expression is exhaustive; a statement is not | no `default`, so the compiler names a new case | empty `catch (E e) {}` |
| Rust | yes | `match` is exhaustive | list every variant; avoid `_ =>` for a set that grows | `let _ = f();`, `.unwrap_or_default()` |
| Kotlin | yes | `when` over a sealed type or enum, used as an expression, is exhaustive | no `else ->` | empty `catch (e: E) {}` |
| Swift | yes | `switch` is exhaustive | `@unknown default:` for a non-frozen enum | `catch {}`, `try?` |
| Ruby | handlers only | `case/when` is not checked | an `else` that raises | `rescue nil`, empty `rescue` |
| Julia | handlers only | `if`/`elseif` chains and dispatch are not checked | a final `else` that throws | empty `catch` block |
| Scala, OCaml, Haskell, F# | no | pattern matching on a sealed or algebraic type is checked, and the compiler warns on a missing case | list every constructor; avoid a wildcard for a set that grows | `Try(...).toOption`, `with _ ->`, `_ <- try`, `catch (SomeException _) -> return ()` |
| C# | no | `switch` expression over an enum warns on a missing case | no discard `_` arm | empty `catch {}` |
| PHP, shell, others | no | not checked in general | an `default`/`*)` arm that fails | `catch (E $e) {}`, `|| true`, `2>/dev/null` |

When the table has no entry for a language, search with `rg` for its dispatch
keyword and its handler forms, and read the hits.
