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
    ["spaces inside a formatting tag", "<p>a <b>bold </b>b</p>", "a #strong[bold] b"],
    ["a link whose address has a quote", `<p><a href='https://x.y/a"b'>t</a></p>`, String.raw`#link("https://x.y/a\"b")[t]`],
    ["a numbered paragraph", "<p>12. twelve</p>", String.raw`12\. twelve`],
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

  it("keeps a line break inside a table cell", () => {
    expect(htmlToTypst("<table><tr><td>a<br>b</td><td>c</td></tr></table>")).toBe(
      "#table(\n  columns: 2,\n  [a \\ b], [c],\n)",
    );
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

describe("htmlToTypst block and inline coverage", () => {
  it.each([
    ["a definition list", "<dl><dt>Term</dt><dd>Meaning</dd></dl>", "/ Term: Meaning"],
    ["a horizontal rule", "<p>a</p><hr><p>b</p>", "a\n\n#line(length: 100%)\n\nb"],
    ["a block quote", "<blockquote><p>q</p></blockquote>", "#quote(block: true)[q]"],
    ["an empty quote and heading", "<blockquote> </blockquote><h2></h2><p>x</p>", "x"],
    ["code with a backtick", "<p><code>a`b</code></p>", '#raw("a`b")'],
    ["code across lines", "<p><code>a\nb</code></p>", String.raw`#raw("a\nb")`],
    ["empty code", "<p>x<code></code>y</p>", "xy"],
    ["keyboard, sample and teletype text", "<p><kbd>K</kbd> <samp>S</samp> <tt>T</tt></p>", "`K` `S` `T`"],
    ["an anchor link", '<p><a href="#top">anchor</a></p>', "anchor"],
    ["a script link", '<p><a href="javascript:alert(1)">js</a></p>', "js"],
    ["a link without an address", '<p><a href="">empty</a></p>', "empty"],
    ["a link without text", '<p><a href="https://x.y"></a></p>', '#link("https://x.y")'],
    [
      "decorated spans",
      '<p><span style="text-decoration: underline">u</span> <span style="text-decoration-line: line-through">s</span></p>',
      "#underline[u] #strike[s]",
    ],
    [
      "numeric and keyword font weights",
      '<p><span style="font-weight: bolder">b</span> <span style="font-weight:600">c</span> <span style="font-weight:400">d</span> <span style="font-weight:abc">e</span></p>',
      "*b* *c* d e",
    ],
    ["bold tags that Google Docs marks as normal", '<p><b style="font-weight:normal">not</b></p>', "not"],
    ["scripts and styles", "<p>a<script>x</script>b<style>y</style></p>", "ab"],
    [
      "semantic inline tags",
      "<p><em>e</em> <cite>c</cite> <var>v</var> <ins>i</ins> <del>d</del> <strike>s</strike> <small>m</small> <span>z</span></p>",
      "_e_ _c_ _v_ #underline[i] #strike[d] #strike[s] m z",
    ],
    ["a block inside a paragraph", "<p>a<div>block</div>b</p>", "a\n\nblock\n\nb"],
    ["mixed blocks and text in a division", "<div><p>a</p><div>b</div>c</div>", "a\n\nb\n\nc"],
    ["a lone element wrapped in containers", "<div><span><b>lone</b></span></div>", "*lone*"],
    ["formatting in a heading", "<h1><b>Bold</b> title</h1>", "= *Bold* title"],
    ["runs of whitespace", "<p>multi   space\n\ttext</p>", "multi space text"],
    ["a stray element in a list", "<ul><li>a</li><p>stray</p></ul>", "- a"],
  ])("converts %s", (_name, html, expected) => {
    expect(htmlToTypst(html)).toBe(expected);
  });

  it("fills short table rows and spans merged cells", () => {
    expect(htmlToTypst('<table><tr><td colspan="2">A</td></tr><tr><td>B</td></tr></table>')).toBe(
      "#table(\n  columns: 2,\n  table.cell(colspan: 2)[A],\n  [B], [],\n)",
    );
    expect(htmlToTypst("<table><tr><th>H</th><th>I</th></tr><tr><td>1</td></tr></table>")).toBe(
      "#table(\n  columns: 2,\n  table.header([H], [I]),\n  [1], [],\n)",
    );
  });

  it("fences preformatted text among other blocks with a longer fence than its content", () => {
    expect(htmlToTypst('<p>a</p><pre><code class="language-py">x ``` y\n</code></pre>')).toBe(
      "a\n\n````py\nx ``` y\n````",
    );
  });

  it("leaves a lone preformatted block, empty input and pasted files to the plain paste", () => {
    expect(htmlToTypst("<pre>plain\n</pre>")).toBeNull();
    expect(htmlToTypst("   ")).toBeNull();
    expect(htmlToTypst("<p></p>")).toBeNull();
    expect(htmlToTypst("<p><b>x</b></p>", { hasFiles: true })).toBeNull();
    expect(htmlToTypst("<table><tr><td>1</td></tr></table>", { hasFiles: true })).toBe("#table(\n  columns: 1,\n  [1],\n)");
  });
});
