// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../typst";
import { parseTypst } from "../../typst-parser";
import { htmlToTypst } from "./html-to-typst";

beforeAll(async () => {
  await loadTypstParser();
});

function errors(source: string): number {
  let count = 0;
  parseTypst(source).iterate({
    enter(node) {
      if (node.type.isError) count += 1;
    },
  });
  return count;
}

describe("htmlToTypst", () => {
  it.each([
    ["bold and italic", "<p>Hello <b>bold</b> and <i>italic</i> world</p>", "Hello *bold* and _italic_ world"],
    ["strong inside a word", "<p>un<strong>believ</strong>able</p>", "un#strong[believ]able"],
    ["underline, strike and highlight", "<p><u>u</u> <s>s</s> <mark>m</mark></p>", "#underline[u] #strike[s] #highlight[m]"],
    ["superscript and subscript", "<p>x<sup>2</sup> H<sub>2</sub>O</p>", "x#super[2] H#sub[2]O"],
    ["inline code", "<p>Run <code>ls -l</code> now</p>", "Run `ls -l` now"],
    ["a link", '<p>See <a href="https://typst.app">the site</a>.</p>', 'See #link("https://typst.app")[the site].'],
    ["a bare link", '<p><a href="https://typst.app">https://typst.app</a></p>', "https://typst.app"],
    ["headings", "<h1>Title</h1><h3>Deep</h3>", "= Title\n\n=== Deep"],
    ["a line break", "<p>one<br>two</p>", "one \\\ntwo"],
    ["Google Docs bold spans", '<p><span style="font-weight:700">Bold</span> and <span style="font-style:italic">it</span></p>', "*Bold* and _it_"],
  ])("converts %s", (_name, html, expected) => {
    expect(htmlToTypst(html)).toBe(expected);
  });

  it("converts nested lists", () => {
    expect(htmlToTypst("<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul><ol><li>first</li></ol>")).toBe(
      "- one\n  - inner\n- two\n\n+ first",
    );
  });

  it("escapes Typst markup characters in text", () => {
    const typst = htmlToTypst("<p><b>Price</b> $5 #1 *star* _x_ @me &lt;tag&gt; [a] a // b `c` ~</p>");
    expect(typst).toBe(
      "*Price* \\$5 \\#1 \\*star\\* \\_x\\_ \\@me \\<tag> \\[a\\] a \\// b \\`c\\` \\~",
    );
    expect(errors(typst ?? "")).toBe(0);
  });

  it("escapes markers at the start of a paragraph", () => {
    expect(htmlToTypst("<p><b>x</b></p><p>= not a heading</p><p>- not a list</p><p>1. not an enum</p>")).toBe(
      "*x*\n\n\\= not a heading\n\n\\- not a list\n\n1\\. not an enum",
    );
  });

  it("converts a table with a header row", () => {
    const typst = htmlToTypst(
      "<table><tr><th>Name</th><th>Count</th></tr><tr><td>Alpha</td><td><b>1</b></td></tr></table>",
    );
    expect(typst).toBe(
      "#table(\n  columns: 2,\n  table.header([Name], [Count]),\n  [Alpha], [*1*],\n)",
    );
    expect(errors(typst ?? "")).toBe(0);
  });

  it("converts block quotes and preformatted code", () => {
    expect(htmlToTypst("<blockquote><p><b>Quoted</b></p></blockquote>")).toBe("#quote(block: true)[*Quoted*]");
    expect(htmlToTypst("<p><b>Code:</b></p><pre>let x = 1;\nlet y = 2;</pre>")).toBe(
      "*Code:*\n\n```\nlet x = 1;\nlet y = 2;\n```",
    );
  });

  it("leaves image pastes and lone code blocks to the default paste", () => {
    expect(htmlToTypst("<p><img src='x.png'></p>", { hasFiles: true })).toBeNull();
    expect(htmlToTypst("<pre>code</pre>")).toBeNull();
    expect(htmlToTypst("")).toBeNull();
  });

  it("drops scripts and styles", () => {
    expect(htmlToTypst("<p><b>a</b><script>alert(1)</script><style>p{}</style></p>")).toBe("*a*");
  });
});
