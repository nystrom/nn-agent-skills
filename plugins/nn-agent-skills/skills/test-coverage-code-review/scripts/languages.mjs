// Per-language data for scan.mjs. Adding a language means adding a row here,
// or passing a JSON file with the same fields to `scan.mjs --table`. Every
// pattern is a regular expression source string.
//
// Fields
//   id, name        Identifier and display name.
//   verified        true when scan.test.mjs runs a fixture in this language.
//   files           A test file path matches this pattern.
//   mode            How a case ends: parens (a call such as `it(...)`), braces,
//                   indent (Python), or end (Julia `end`).
//   funcMode        How a helper function ends. Default: mode.
//   comment         { line: [prefix], block: [open, close] }.
//   strings         Quote characters that start a string.
//   multiline       Quote characters whose strings may span lines.
//   triple          Triple-quote openers (strings that span lines).
//   charLiteral     A single quote is a character literal only when it closes
//                   within a few characters (Rust, C, Java, Julia).
//   head            A line that starts a case. Run on one original line.
//   title           Capture groups of `head` that hold the case name.
//   needAttr        An attribute line (`#[test]`, `@Test`) must precede or
//                   share the head line.
//   skip            A case is skipped when this matches its head, attributes,
//                   or body.
//   skipBlock       A line that starts a block whose cases are all skipped.
//   snapshot        A case with this pattern asserts through a stored file.
//   assert          Patterns that are an assertion, besides the generic
//                   assertion-like call names in GENERIC_ASSERT.
//   attrAsserts     An attribute that makes the case assert (`should_panic`).
//   funcDecl        Lines that declare a helper function; the first defined
//                   capture group is its name.
//   tautology       Assertion forms to compare; see scan.mjs.
//   trivial         Constant assertions such as `assert True`.

/** Call names that read as assertions in most languages. */
export const GENERIC_ASSERT = String.raw`(?:^|[^\w])(?:assert|expect|verify|ensure|invariant|require|must|check|fail)\w*(?:(?:\.|::)\w+)*\s*!?\s*\(`;

const CLIKE = {
  comment: { line: ["//"], block: ["/*", "*/"] },
  strings: ['"', "'"],
  charLiteral: true,
};

export const LANGUAGES = [
  {
    id: "javascript",
    interpolate: true,
    name: "JavaScript and TypeScript (jest, vitest, mocha, node:test)",
    verified: true,
    files: String.raw`\.(?:test|spec)\.(?:[mc]?[jt]sx?)$|(?:^|/)__tests__/.*\.(?:[mc]?[jt]sx?)$`,
    mode: "parens",
    funcMode: "braces",
    comment: { line: ["//"], block: ["/*", "*/"] },
    strings: ['"', "'", "`"],
    multiline: ["`"],
    head: String.raw`^\s*(?:x?it|x?test|specify|fit)(?:\.\w+(?:\s*\([^)]*\))?)*\s*\(\s*(["'\x60])((?:\\.|(?!\1).)*)\1`,
    title: [2],
    skip: String.raw`\b(?:it|test)\.(?:skip|todo)\b|\bx(?:it|test)\b`,
    skipBlock: String.raw`^\s*(?:describe\.skip|xdescribe)\s*\(`,
    snapshot: String.raw`\btoMatch(?:Inline|File)?Snapshot\b|\btoThrowErrorMatching(?:Inline)?Snapshot\b`,
    assert: [
      String.raw`\.should\b`,
      String.raw`\.expect\s*\(`,
      String.raw`\bt\.(?:ok|equal|is|assert|deepEqual|true|false|throws|pass|fail)\w*\s*\(`,
      String.raw`\bdone\s*\(`,
    ],
    funcDecl: [
      String.raw`\bfunction\s*\*?\s*(\w+)\s*\(`,
      String.raw`\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)`,
    ],
    tautology: [
      { kind: "chain", head: String.raw`\bexpect\s*\(`, matchers: "toBe|toEqual|toStrictEqual" },
    ],
    trivial: [],
  },
  {
    id: "python",
    name: "Python (pytest, unittest)",
    verified: true,
    files: String.raw`(?:^|/)(?:test_[^/]*|[^/]*_test)\.py$|(?:^|/)tests?/[^/]*\.py$`,
    mode: "indent",
    comment: { line: ["#"], block: null },
    strings: ['"', "'"],
    triple: ['"""', "'''"],
    head: String.raw`^\s*(?:async\s+)?def\s+(test\w*)\s*\(`,
    title: [1],
    skip: String.raw`@pytest\.mark\.(?:skip|skipif|xfail)|@unittest\.(?:skip|skipIf|expectedFailure)|\bpytest\.skip\s*\(|\bself\.skipTest\s*\(`,
    snapshot: String.raw`\bsnapshot\b|\.assert_match\s*\(`,
    assert: [
      String.raw`^\s*assert\b`,
      String.raw`\bpytest\.(?:raises|warns|fail|approx)\b`,
      String.raw`\bself\.assert\w*`,
    ],
    funcDecl: [String.raw`^\s*(?:async\s+)?def\s+(\w+)\s*\(`],
    tautology: [
      { kind: "infix", head: String.raw`^\s*assert\s+`, op: "==" },
      { kind: "args", head: String.raw`\bself\.assert(?:Equal|Is|DictEqual|ListEqual)\s*\(`, pair: [0, 1] },
    ],
    trivial: [String.raw`^\s*assert\s+(?:True|1)\s*(?:,.*)?$`],
  },
  {
    id: "go",
    name: "Go (testing, testify)",
    verified: true,
    files: String.raw`_test\.go$`,
    mode: "braces",
    comment: { line: ["//"], block: ["/*", "*/"] },
    strings: ['"', "`"],
    multiline: ["`"],
    charLiteral: true,
    head: String.raw`^func\s+(Test\w*)\s*\(\s*\w+\s+\*testing\.T\s*\)`,
    title: [1],
    skip: String.raw`\b\w+\.Skip(?:f|Now)?\s*\(`,
    snapshot: String.raw`\b(?:cupaloy|goldie|golden)\b`,
    assert: [
      String.raw`\b\w+\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(`,
      String.raw`\bcmp\.Diff\s*\(`,
    ],
    funcDecl: [String.raw`^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(`],
    tautology: [
      { kind: "args", head: String.raw`\b(?:assert|require)\.(?:Equal|EqualValues|Exactly)\s*\(`, pair: [1, 2] },
      { kind: "args", head: String.raw`\breflect\.DeepEqual\s*\(`, pair: [0, 1] },
    ],
    trivial: [String.raw`\b(?:assert|require)\.True\s*\(\s*\w+\s*,\s*true\s*\)`],
  },
  {
    id: "rust",
    name: "Rust (#[test], rstest)",
    verified: true,
    files: String.raw`\.rs$`,
    mode: "braces",
    ...CLIKE,
    nestedBlock: true,
    head: String.raw`^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)`,
    title: [1],
    needAttr: String.raw`#\[\s*(?:\w+::)*(?:test|rstest|test_case)\b`,
    skip: String.raw`#\[\s*ignore\b`,
    snapshot: String.raw`\binsta::|\bassert_\w*snapshot!`,
    assert: [],
    attrAsserts: String.raw`should_panic`,
    funcDecl: [String.raw`\bfn\s+(\w+)`],
    tautology: [{ kind: "args", head: String.raw`\bassert_eq!\s*\(`, pair: [0, 1] }],
    trivial: [String.raw`\bassert!\s*\(\s*true\s*\)`],
  },
  {
    id: "java",
    name: "Java (JUnit, TestNG)",
    verified: true,
    files: String.raw`(?:Tests?|IT|TestCase)\.java$|(?:^|/)src/test/.*\.java$`,
    mode: "braces",
    ...CLIKE,
    head: String.raw`^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|static|final|synchronized)\s+)*[\w<>\[\],.?]+\s+(\w+)\s*\(`,
    title: [1],
    needAttr: String.raw`@(?:\w+\.)*(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b`,
    skip: String.raw`@(?:Disabled|Ignore)\b`,
    snapshot: String.raw`\bApprovals\b|\bapproval`,
    assert: [],
    attrAsserts: String.raw`expected\s*=`,
    funcDecl: [
      String.raw`^\s*(?:(?:public|protected|private|static|final|synchronized|abstract)\s+)*[\w<>\[\],.?]+\s+(\w+)\s*\([^)]*\)\s*(?:throws[\w\s,.]+)?\{`,
    ],
    tautology: [{ kind: "args", head: String.raw`\bassert(?:Equals|Same)\s*\(`, pair: [0, 1], messageFirst: true }],
    trivial: [String.raw`\bassertTrue\s*\(\s*true\s*\)`],
  },
  {
    id: "kotlin",
    name: "Kotlin (JUnit, kotlin.test)",
    verified: false,
    files: String.raw`(?:Tests?|IT)\.kt$|(?:^|/)src/test/.*\.kt$`,
    mode: "braces",
    ...CLIKE,
    strings: ['"'],
    head: String.raw`^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|internal|private|suspend)\s+)*fun\s+(?:\x60([^\x60]+)\x60|(\w+))\s*\(`,
    title: [1, 2],
    needAttr: String.raw`@(?:\w+\.)*(?:Test|ParameterizedTest|RepeatedTest)\b`,
    skip: String.raw`@(?:Disabled|Ignore)\b`,
    snapshot: String.raw`\bApprovals\b`,
    assert: [],
    attrAsserts: String.raw`expected\s*=`,
    funcDecl: [String.raw`\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(`],
    tautology: [{ kind: "args", head: String.raw`\bassert(?:Equals|Same)\s*\(`, pair: [0, 1], messageFirst: true }],
    trivial: [String.raw`\bassertTrue\s*\(\s*true\s*\)`],
  },
  {
    id: "cpp",
    name: "C and C++ (googletest, Catch2)",
    verified: true,
    files: String.raw`(?:_tests?|Tests?|\.test|_unittest)\.(?:c|cc|cpp|cxx)$|(?:^|/)tests?/.*\.(?:c|cc|cpp|cxx)$`,
    mode: "braces",
    ...CLIKE,
    head: String.raw`^\s*(?:TEST|TEST_F|TEST_P|TYPED_TEST|TEST_CASE|SCENARIO|TEMPLATE_TEST_CASE)\s*\(\s*([^)]*)\)`,
    title: [1],
    skip: String.raw`DISABLED_|\[\.\]|\[!hide\]|\bGTEST_SKIP\b`,
    snapshot: String.raw`\bApprovals::|\bapproval`,
    assert: [String.raw`\bADD_FAILURE\b`],
    funcDecl: [String.raw`^\s*(?:static\s+|inline\s+)?[\w:<>*&]+\s+[*&]?(\w+)\s*\([^;)]*\)\s*(?:const\s*)?\{?\s*$`],
    tautology: [
      { kind: "args", head: String.raw`\b(?:EXPECT|ASSERT)_(?:EQ|STREQ)\s*\(`, pair: [0, 1] },
      { kind: "infix", head: String.raw`\b(?:REQUIRE|CHECK)\s*\(`, op: "==", paren: true },
    ],
    trivial: [String.raw`\b(?:EXPECT|ASSERT)_TRUE\s*\(\s*true\s*\)`],
  },
  {
    id: "julia",
    nestedBlock: true,
    name: "Julia (Test)",
    verified: true,
    files: String.raw`(?:^|/)test/.*\.jl$|_tests?\.jl$`,
    mode: "end",
    comment: { line: ["#"], block: ["#=", "=#"] },
    strings: ['"'],
    multiline: ['"'],
    triple: ['"""'],
    charLiteral: true,
    head: String.raw`^\s*@testset\s+(?:"([^"\n]*)"|(\w+))`,
    title: [1, 2],
    skip: String.raw`@test_skip\b|@test_broken\b`,
    snapshot: String.raw`@test_reference\b`,
    assert: [String.raw`@test(?!set\b|item\b)\w*\b`,String.raw`@inferred\b`, String.raw`@assert\b`],
    funcDecl: [String.raw`^\s*function\s+(\w+)`, String.raw`^\s*(\w+)\s*\([^)]*\)\s*=[^=]`],
    tautology: [{ kind: "infix", head: String.raw`@test\s+`, op: "==" }],
    trivial: [String.raw`@test\s+true\s*$`],
  },
];
