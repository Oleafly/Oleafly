import { describe, expect, it } from "vitest";
import { CODE_MODE, MARKUP_MODE, MATH_MODE, TypstLexer } from "./typst-lexer";
import { K } from "./typst-nodes";

const KIND_NAMES = Object.keys(K);

type Lexed = string | [string, string];

function lex(text: string, mode: number): Lexed[] {
  const lexer = new TypstLexer(text, text.length);
  lexer.mode = mode;
  const tokens: Lexed[] = [];
  for (let kind = lexer.next(); kind !== K.End; kind = lexer.next()) {
    const name = KIND_NAMES[kind];
    tokens.push(kind === K.Space || kind === K.Parbreak ? name : [name, text.slice(lexer.start, lexer.pos)]);
  }
  return tokens;
}

describe("TypstLexer", () => {
  it.each<[number, string, Lexed[]]>([
    [MARKUP_MODE, "= Title\n== Two", [["HeadingMarker", "="], "Space", ["Text", "Title"], "Space", ["HeadingMarker", "=="], "Space", ["Text", "Two"]]],
    [MARKUP_MODE, "a = b and =x", [["Text", "a"], "Space", ["HeadingMarker", "="], "Space", ["Text", "b and"], "Space", ["Text", "=x"]]],
    [MARKUP_MODE, "-- --- -? -1 - x -y", [["Shorthand", "--"], "Space", ["Shorthand", "---"], "Space", ["Shorthand", "-?"], "Space", ["Shorthand", "-"], ["Text", "1"], "Space", ["ListMarker", "-"], "Space", ["Text", "x"], "Space", ["Text", "-y"]]],
    [MARKUP_MODE, "*bold* a*b* _x_ snake_case", [["Star", "*"], ["Text", "bold"], ["Star", "*"], "Space", ["Text", "a"], ["Text", "*b"], ["Star", "*"], "Space", ["Underscore", "_"], ["Text", "x"], ["Underscore", "_"], "Space", ["Text", "snake"], ["Text", "_case"]]],
    [MARKUP_MODE, "😀*a* 𝑥*y* 中*文* \ud800*a*", [["Text", "😀"], ["Star", "*"], ["Text", "a"], ["Star", "*"], "Space", ["Text", "𝑥"], ["Text", "*y"], ["Star", "*"], "Space", ["Text", "中"], ["Star", "*"], ["Text", "文"], ["Star", "*"], "Space", ["Text", "\ud800"], ["Star", "*"], ["Text", "a"], ["Star", "*"]]],
    [MARKUP_MODE, "+ item\n/ term: x\n12. twelve\n12.x 1.", [["EnumMarker", "+"], "Space", ["Text", "item"], "Space", ["TermMarker", "/"], "Space", ["Text", "term"], ["Colon", ":"], "Space", ["Text", "x"], "Space", ["EnumMarker", "12."], "Space", ["Text", "twelve"], "Space", ["Text", "12.x 1."]]],
    [MARKUP_MODE, "18446744073709551615. a\n18446744073709551616. b", [["EnumMarker", "18446744073709551615."], "Space", ["Text", "a"], "Space", ["Text", "18446744073709551616. b"]]],
    [MARKUP_MODE, "See https://typst.app/docs. (http://a.b/[c]d) https://x.y/(a", [["Text", "See "], ["Link", "https://typst.app/docs"], ["Text", "."], "Space", ["Text", "("], ["Link", "http://a.b/[c]d"], ["Text", ") "], ["Error", "https://x.y/(a"]]],
    [MARKUP_MODE, "<lab:el.> @ref. @ref:x <a @", [["Label", "<lab:el.>"], "Space", ["RefMarker", "@ref"], ["Text", "."], "Space", ["RefMarker", "@ref:x"], "Space", ["Error", "<a"], "Space", ["Text", "@"]]],
    [MARKUP_MODE, "\\u{1F600} \\u{110000} \\u{D800} \\u{zz} \\u{41 \\# \\", [["Escape", String.raw`\u{1F600}`], "Space", ["Error", String.raw`\u{110000}`], "Space", ["Error", String.raw`\u{D800}`], "Space", ["Error", String.raw`\u{zz}`], "Space", ["Error", String.raw`\u{41`], "Space", ["Escape", String.raw`\#`], "Space", ["Linebreak", "\\"]]],
    [MARKUP_MODE, String.raw`\ x ~ ... ..`, [["Linebreak", "\\"], "Space", ["Text", "x"], "Space", ["Shorthand", "~"], "Space", ["Shorthand", "..."], "Space", ["Text", ".."]]],
    [MARKUP_MODE, "`raw` `` ```py\ncode\n``` ```\nplain``` ``` x``` ```unclosed", [["Raw", "`raw`"], "Space", ["Raw", "``"], "Space", ["Raw", "```py\ncode\n```"], "Space", ["Raw", "```\nplain```"], "Space", ["Raw", "``` x```"], "Space", ["Error", "```unclosed"]]],
    [MARKUP_MODE, "/* a /* b */ c */ // line\n*/ x", [["BlockComment", "/* a /* b */ c */"], "Space", ["LineComment", "// line"], "Space", ["Error", "*/"], "Space", ["Text", "x"]]],
    [MARKUP_MODE, "#!shebang\nx", [["Shebang", "#!shebang"], "Space", ["Text", "x"]]],
    [MARKUP_MODE, "a\r\n\r\nb  \t c", [["Text", "a"], "Parbreak", ["Text", "b"], "Space", ["Text", "c"]]],
    [MARKUP_MODE, "\"quote\" 'single'", [["SmartQuote", "\""], ["Text", "quote"], ["SmartQuote", "\""], "Space", ["SmartQuote", "'"], ["Text", "single"], ["SmartQuote", "'"]]],
    [MARKUP_MODE, "hello world, word-word word.word wor@d", [["Text", "hello world, word-word word.word wor"], ["RefMarker", "@d"]]],
    [MARKUP_MODE, "a < b `````` c ```` ``` `` x", [["Text", "a"], "Space", ["Text", "< b"], "Space", ["Error", "`````` c ```` ``` `` x"]]],
    [MATH_MODE, "x^2_i' f(x) [|x|] ⌈x⌉ √x ∛y", [["MathText", "x"], ["Hat", "^"], ["MathText", "2"], ["Underscore", "_"], ["MathText", "i"], ["MathPrimes", "'"], "Space", ["MathText", "f"], ["LeftParen", "("], ["MathText", "x"], ["RightParen", ")"], "Space", ["LeftBrace", "[|"], ["MathText", "x"], ["RightBrace", "|]"], "Space", ["LeftBrace", "⌈"], ["MathText", "x"], ["RightBrace", "⌉"], "Space", ["Root", "√"], ["MathText", "x"], "Space", ["Root", "∛"], ["MathText", "y"]]],
    [MATH_MODE, "a -> b => c <==> d |-> e ~~ f :: g :=h", [["MathText", "a"], "Space", ["MathShorthand", "->"], "Space", ["MathText", "b"], "Space", ["MathShorthand", "=>"], "Space", ["MathText", "c"], "Space", ["MathShorthand", "<==>"], "Space", ["MathText", "d"], "Space", ["MathShorthand", "|->"], "Space", ["MathText", "e"], "Space", ["MathShorthand", "~"], ["MathShorthand", "~"], "Space", ["MathText", "f"], "Space", ["MathText", ":"], ["MathText", ":"], "Space", ["MathText", "g"], "Space", ["MathShorthand", ":="], ["MathText", "h"]]],
    [MATH_MODE, "x.y.z x. 12.5 12. 3.", [["MathText", "x"], ["Dot", "."], ["MathText", "y"], ["Dot", "."], ["MathText", "z"], "Space", ["MathText", "x"], ["Dot", "."], "Space", ["MathText", "12.5"], "Space", ["MathText", "12"], ["Dot", "."], "Space", ["MathText", "3"], ["Dot", "."]]],
    [MATH_MODE, String.raw`"str" \alpha \u{41} & ; , ! #f ' ''`, [["Str", "\"str\""], "Space", ["Escape", String.raw`\a`], ["MathIdent", "lpha"], "Space", ["Escape", String.raw`\u{41}`], "Space", ["MathAlignPoint", "&"], "Space", ["Semicolon", ";"], "Space", ["Comma", ","], "Space", ["Bang", "!"], "Space", ["Hash", "#"], ["MathText", "f"], "Space", ["MathPrimes", "'"], "Space", ["MathPrimes", "''"]]],
    [MATH_MODE, "abc 𝑥y 中文 e\u0301 👨\u200d👩\u200d👧 a\u200d", [["MathIdent", "abc"], "Space", ["MathIdent", "𝑥y"], "Space", ["MathIdent", "中文"], "Space", ["MathText", "e\u0301"], "Space", ["MathText", "👨\u200d👩\u200d👧"], "Space", ["MathText", "a\u200d"]]],
    [MATH_MODE, "x \u2028 y", [["MathText", "x"], "Space", ["MathText", "y"]]],
    [CODE_MODE, "0b101 0b12 0o7 0o9 0x1F 0xg 0x", [["Int", "0b101"], "Space", ["Error", "0b12"], "Space", ["Int", "0o7"], "Space", ["Error", "0o9"], "Space", ["Int", "0x1F"], "Space", ["Error", "0xg"], "Space", ["Error", "0x"]]],
    [CODE_MODE, "1.5e3 1e3 1em 2.5pt 3% 1..2 1.foo .5 1e+ 12abc 1.2.3 7.e2", [["Float", "1.5e3"], "Space", ["Float", "1e3"], "Space", ["Numeric", "1em"], "Space", ["Numeric", "2.5pt"], "Space", ["Numeric", "3%"], "Space", ["Int", "1"], ["Dots", ".."], ["Int", "2"], "Space", ["Int", "1"], ["Dot", "."], ["Ident", "foo"], "Space", ["Float", ".5"], "Space", ["Error", "1e+"], "Space", ["Error", "12abc"], "Space", ["Float", "1.2"], ["Float", ".3"], "Space", ["Int", "7"], ["Dot", "."], ["Ident", "e2"]]],
    [CODE_MODE, "== => != <= >= += -= *= /= .. && || ~= ~ & | − −= = ! < > + - * /", [["EqEq", "=="], "Space", ["Arrow", "=>"], "Space", ["ExclEq", "!="], "Space", ["LtEq", "<="], "Space", ["GtEq", ">="], "Space", ["PlusEq", "+="], "Space", ["HyphEq", "-="], "Space", ["StarEq", "*="], "Space", ["SlashEq", "/="], "Space", ["Dots", ".."], "Space", ["Error", "&&"], "Space", ["Error", "||"], "Space", ["Error", "~="], "Space", ["Error", "~"], "Space", ["Error", "&"], "Space", ["Error", "|"], "Space", ["Minus", "−"], "Space", ["HyphEq", "−="], "Space", ["Eq", "="], "Space", ["Error", "!"], "Space", ["Lt", "<"], "Space", ["Gt", ">"], "Space", ["Plus", "+"], "Space", ["Minus", "-"], "Space", ["Star", "*"], "Space", ["Slash", "/"]]],
    [CODE_MODE, "let x = none; auto true false not and or in as", [["Let", "let"], "Space", ["Ident", "x"], "Space", ["Eq", "="], "Space", ["None", "none"], ["Semicolon", ";"], "Space", ["Auto", "auto"], "Space", ["Bool", "true"], "Space", ["Bool", "false"], "Space", ["Not", "not"], "Space", ["And", "and"], "Space", ["Or", "or"], "Space", ["In", "in"], "Space", ["As", "as"]]],
    [CODE_MODE, "a.and x.let ..let _ foo-bar _x", [["Ident", "a"], ["Dot", "."], ["Ident", "and"], "Space", ["Ident", "x"], ["Dot", "."], ["Ident", "let"], "Space", ["Dots", ".."], ["Let", "let"], "Space", ["Underscore", "_"], "Space", ["Ident", "foo-bar"], "Space", ["Ident", "_x"]]],
    [CODE_MODE, String.raw`{ } [ ] ( ) $ , ; : <label> "a\"b" "open`, [["LeftBrace", "{"], "Space", ["RightBrace", "}"], "Space", ["LeftBracket", "["], "Space", ["RightBracket", "]"], "Space", ["LeftParen", "("], "Space", ["RightParen", ")"], "Space", ["Dollar", "$"], "Space", ["Comma", ","], "Space", ["Semicolon", ";"], "Space", ["Colon", ":"], "Space", ["Label", "<label>"], "Space", ["Str", String.raw`"a\"b"`], "Space", ["Error", "\"open"]]],
    [CODE_MODE, "@ ? `r`", [["Error", "@"], "Space", ["Error", "?"], "Space", ["Raw", "`r`"]]],
  ])("lexes %#", (mode, text, expected) => {
    expect(lex(text, mode)).toEqual(expected);
  });

  it("reads a surrogate pair as one code point unless the end cuts it", () => {
    const text = "a😀\nb";
    const whole = new TypstLexer(text, text.length);
    expect([whole.point(1), whole.unit(1), whole.unit(2), whole.point(2)]).toEqual([0x1f600, 0xd83d, 0xde00, 0xde00]);
    expect(whole.reach).toBe(3);
    expect([whole.column(3), whole.column(5)]).toEqual([2, 1]);
    const cut = new TypstLexer(text, 2);
    expect([cut.point(1), cut.unit(1), cut.reach]).toEqual([0xd83d, 0xd83d, 3]);
    expect([cut.point(5), cut.reach]).toEqual([-1, 6]);
  });

  it("records the language span of a fenced raw block", () => {
    const text = "```py\ncode\n```";
    const lexer = new TypstLexer(text, text.length);
    expect(lexer.next()).toBe(K.Raw);
    expect(lexer.aux).toEqual([3, 3, 5, 11]);
  });
});
