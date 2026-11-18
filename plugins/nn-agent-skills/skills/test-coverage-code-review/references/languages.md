# Languages

Per-language facts for the three checks. The rows in `scripts/languages.mjs`
encode the case form, assertion forms, snapshot marker, and skip marker.

Status:

- **Fixture-tested**: `scripts/scan.test.mjs` runs a fixture for the row and
  checks what it reports and refuses. The fixture files are TypeScript (`.ts`,
  jest-style), Python (pytest and unittest), Go, Rust, Java (JUnit 5 and 4
  forms), C++ (googletest, `.cc`), and Julia. Other extensions that the same
  row matches (`.js`, `.mjs`, `.c`) share its patterns and are guidance.
- **Guidance**: the row or the entry has no fixture, or the entry is not in a
  row. Kotlin has a row without a fixture. Catch2 forms are in the C++ row
  without a fixture. Everything marked "guidance" below was not run.

For a language not listed, find the same six facts and apply `SKILL.md` by
reading, or write a row and pass it with `--table`.

| Language | Runner | Test files | Case form | Assertion forms | Snapshot | Skip | Status |
| -------- | ------ | ---------- | --------- | --------------- | -------- | ---- | ------ |
| TypeScript, JavaScript | jest, vitest, mocha, node:test | `*.test.*`, `*.spec.*`, `__tests__/` | `it("name", fn)`, `test(...)`, `it.each(rows)("name", fn)` | `expect(x).toBe(y)`, `assert.equal`, `x.should`, `t.ok` | `toMatchSnapshot`, `toMatchInlineSnapshot` | `it.skip`, `xit`, `it.todo`, `describe.skip` | fixture-tested |
| Python | pytest, unittest | `test_*.py`, `*_test.py`, `tests/` | `def test_*()`, methods of a `TestCase` | `assert x == y`, `self.assertEqual`, `pytest.raises` | `snapshot` fixture (syrupy) | `@pytest.mark.skip`, `@unittest.skip`, `pytest.skip()` | fixture-tested |
| Go | `testing`, testify | `*_test.go` | `func TestX(t *testing.T)` | `if got != want { t.Errorf }`, `assert.Equal(t, a, b)`, `require.*` | golden files (`cupaloy`, `goldie`) | `t.Skip()` | fixture-tested |
| Rust | `#[test]`, rstest | any `.rs` file, `tests/` | `#[test] fn name()` | `assert!`, `assert_eq!`, `#[should_panic]` | `insta` | `#[ignore]` | fixture-tested |
| Java | JUnit 4 and 5, TestNG | `*Test.java`, `src/test/` | `@Test void name()` | `assertEquals`, `assertThat`, `assertThrows`, `@Test(expected=...)` | Approvals | `@Disabled`, `@Ignore` | fixture-tested |
| Kotlin | JUnit, kotlin.test | `*Test.kt`, `src/test/` | `@Test fun name()` | `assertEquals`, `assertFailsWith` | Approvals | `@Disabled`, `@Ignore` | guidance |
| C, C++ | googletest, Catch2 | `*_test.cc`, `*Test.cpp`, `tests/` | `TEST(Suite, Name)`, `TEST_F`, `TEST_CASE("name")` | `EXPECT_EQ`, `ASSERT_TRUE`, `REQUIRE(a == b)`, `CHECK` | approval tests | `DISABLED_` prefix, `GTEST_SKIP()`, Catch `[.]` | googletest fixture-tested; Catch2 guidance |
| Julia | `Test` | `test/runtests.jl`, `test/*.jl` | `@testset "name" begin ... end` | `@test a == b`, `@test_throws`, `@inferred` | `ReferenceTests.@test_reference` | `@test_skip`, `@test_broken` | fixture-tested |

## Mock idioms that assert on themselves (guidance)

The script does not detect these. Look for them in the survey.

- A mock is configured to return `v`, the code under test is not called, and
  the case asserts the mock returned `v`.
- `verify(mock).method()` after the case called `mock.method()` itself.
- A case that replaces the function under test with a stub and asserts on the
  stub.
- Mock idioms by language: jest and vitest `jest.fn()`, `vi.fn()`,
  `mockReturnValue`; Python `unittest.mock.Mock`, `MagicMock`, `patch`,
  `monkeypatch`; Go interface fakes and `gomock`; Rust `mockall`; Java Mockito
  `when(...).thenReturn`, `verify`; C++ googlemock `EXPECT_CALL`; Julia
  `Mocking.jl`.

## Weak matchers on wide values (guidance)

Each of these passes for most outputs: `toBeDefined`, `toBeTruthy` on an
object; `assert x is not None` on a value that cannot be `None`; `assert result`
on a non-empty container; `assertNotNull` on a constructor result;
`EXPECT_TRUE(ptr)`; `@test !isnothing(x)` on a value that cannot be `nothing`;
Go `if err == nil` with no check of the value. Report one only when you confirm
the value cannot fail the matcher.

## Language-server tools (guidance)

Servers the evidence rule can use: `typescript-language-server`, `pyright` or
`pylsp`, `gopls`, `rust-analyzer`, `jdtls`, `kotlin-language-server`, `clangd`,
`LanguageServer.jl`. What to ask of each: document symbols (cases and helpers in
a file), definition (where a called name lives), references (who calls a
helper), call hierarchy (what a helper reaches). None of these was run against
a repository for this skill; they are guidance.
