// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";

describe("serializeMarkdownBody", () => {
  it("round-trips headings, bold, italic, links, and lists", () => {
    const body = `# Heading\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n- item one\n- item two\n`;
    const { doc } = parseMarkdownBody(body);
    expect(serializeMarkdownBody(doc)).toBe(body.trimEnd());
  });

  it("is idempotent on its own output", () => {
    const body = `# Heading\n\nSome **bold** text.\n`;
    const first = serializeMarkdownBody(parseMarkdownBody(body).doc);
    const second = serializeMarkdownBody(parseMarkdownBody(first).doc);
    expect(second).toBe(first);
  });

  it("keeps Pandoc citations, footnotes, comments and a bare < when a block is rewritten", () => {
    const body =
      "Jak uvádí [@novak2020, s. 3; viz @dvorak_2019], papír[^1] <!-- ověřit --> a 1 < 2.\n\n[^1]: Poznámka.";
    expect(serializeMarkdownBody(parseMarkdownBody(body).doc)).toBe(body);
  });

  it("escapes text that would read back as HTML or a link", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Tag <b> and [@key](x) stay text." }],
        },
      ],
    };
    const out = serializeMarkdownBody(doc);
    expect(out).toBe("Tag &lt;b> and \\[@key\\](x) stay text.");
    expect(serializeMarkdownBody(parseMarkdownBody(out).doc)).toBe(out);
  });
});
