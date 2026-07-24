import { describe, expect, it } from "vitest";
import { serializeLatexBody } from "./serialize";
import { parseLatexBody } from "./parse";

describe("serializeLatexBody", () => {
  it("serializes a heading and marked-up paragraph", () => {
    const doc: import("@tiptap/core").JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Some " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " text." },
          ],
        },
      ],
    };
    expect(serializeLatexBody(doc)).toBe("\\section{Intro}\n\nSome \\textbf{bold} text.\n");
  });

  it("serializes bulletList and blockquote", () => {
    const doc: import("@tiptap/core").JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
          ],
        },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "a quote" }] }] },
      ],
    };
    expect(serializeLatexBody(doc)).toBe(
      "\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}\n\n\\begin{quote}\na quote\n\\end{quote}\n",
    );
  });

  it("is idempotent: serialize(parse(serialize(doc))) === serialize(doc)", () => {
    const doc = parseLatexBody("\\section{Intro}\nSome \\textbf{bold} text.\n");
    const first = serializeLatexBody(doc);
    const second = serializeLatexBody(parseLatexBody(first));
    expect(second).toBe(first);
  });

  it("preserves nested-mark order (outermost first) so parse/serialize round-trips converge", () => {
    const src = "\\textbf{\\textit{X}}\n";
    const first = serializeLatexBody(parseLatexBody(src));
    const second = serializeLatexBody(parseLatexBody(first));
    expect(first).toBe(src);
    expect(second).toBe(first);
  });

  it("serializes an orderedList as enumerate", () => {
    const doc: import("@tiptap/core").JSONContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
          ],
        },
      ],
    };
    expect(serializeLatexBody(doc)).toBe("\\begin{enumerate}\n  \\item one\n  \\item two\n\\end{enumerate}\n");
  });

  it("serializes a rawBlock mixed with a heading and paragraph without losing either", () => {
    const doc: import("@tiptap/core").JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
        { type: "rawBlock", attrs: { source: "% a comment" } },
        { type: "paragraph", content: [{ type: "text", text: "more text." }] },
      ],
    };
    expect(serializeLatexBody(doc)).toBe("\\section{Intro}\n\n% a comment\n\nmore text.\n");
  });

  it("wraps a link mark together with a formatting mark on the same run", () => {
    const doc: import("@tiptap/core").JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://x.com" } }],
            },
          ],
        },
      ],
    };
    expect(serializeLatexBody(doc)).toBe("\\textbf{\\href{https://x.com}{click}}\n");
  });

  it("escapes special LaTeX characters in plain text", () => {
    const doc: import("@tiptap/core").JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "100% off, cost $5 #tag foo_bar A&B ~n ^m \\slash" }],
        },
      ],
    };
    expect(serializeLatexBody(doc)).toBe(
      "100\\% off, cost \\$5 \\#tag foo\\_bar A\\&B \\textasciitilde{}n \\textasciicircum{}m \\textbackslash{}slash\n",
    );
  });

  it("round-trips escaped special characters through parse and back", () => {
    const src = "cut p99 latency 38\\% and saved \\$14M/year\n";
    expect(serializeLatexBody(parseLatexBody(src))).toBe(src);
  });

  it("serializes a rawInline node verbatim, inline with surrounding text", () => {
    const doc: import("@tiptap/core").JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ratel " },
            { type: "rawInline", attrs: { source: "\\hfill" } },
            { type: "text", text: " more" },
          ],
        },
      ],
    };
    expect(serializeLatexBody(doc)).toBe("Ratel \\hfill more\n");
  });

  it("returns just a trailing newline for an empty document", () => {
    expect(serializeLatexBody({ type: "doc", content: [] })).toBe("\n");
    expect(serializeLatexBody({ type: "doc" })).toBe("\n");
  });
});
