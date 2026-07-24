import { describe, expect, it } from "vitest";
import { parseLatexBody } from "./parse";

function fullText(node: { content?: { text?: string }[] } | undefined): string {
  return (node?.content ?? []).map((n) => n.text ?? "").join("");
}

describe("parseLatexBody", () => {
  it("parses a section heading and a paragraph with marks and a link", () => {
    const body = "\\section{Intro}\nSome \\textbf{bold} and \\textit{italic} text with a \\href{https://example.com}{link}.\n";
    const doc = parseLatexBody(body);
    expect(doc.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Intro" }],
    });
    const paragraph = doc.content?.[1];
    expect(paragraph?.type).toBe("paragraph");
    const bold = paragraph?.content?.find((n) => n.marks?.some((m) => m.type === "bold"));
    expect(bold?.text).toBe("bold");
    const link = paragraph?.content?.find((n) => n.marks?.some((m) => m.type === "link"));
    expect(link?.text).toBe("link");
    expect(link?.marks?.find((m) => m.type === "link")?.attrs?.href).toBe("https://example.com");
    expect(fullText(paragraph)).toBe("Some bold and italic text with a link.");
  });

  it("preserves spacing between words in a plain paragraph with no macros", () => {
    const doc = parseLatexBody("This is a plain paragraph with several words.\n");
    const paragraph = doc.content?.[0];
    expect(paragraph?.type).toBe("paragraph");
    expect(fullText(paragraph)).toBe("This is a plain paragraph with several words.");
  });

  it("parses a quote environment as a blockquote", () => {
    const body = "\\begin{quote}\na quote\n\\end{quote}\n";
    const doc = parseLatexBody(body);
    expect(doc.content?.[0]).toMatchObject({
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a quote" }] }],
    });
  });

  it("parses itemize and enumerate as bulletList/orderedList", () => {
    const bulleted = parseLatexBody("\\begin{itemize}\n\\item one\n\\item two\n\\end{itemize}\n");
    expect(bulleted.content?.[0].type).toBe("bulletList");
    expect(bulleted.content?.[0].content).toHaveLength(2);
    expect(bulleted.content?.[0].content?.[0]).toMatchObject({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
    });

    const numbered = parseLatexBody("\\begin{enumerate}\n\\item first\n\\end{enumerate}\n");
    expect(numbered.content?.[0].type).toBe("orderedList");
  });

  it("falls back to an inline rawInline for an isolated unrecognized macro, not a block", () => {
    const doc = parseLatexBody("\\newcommand{\\foo}{bar}\n\\foo\n");
    const paragraph = doc.content?.find((n) => n.type === "paragraph");
    expect(paragraph).toBeDefined();
    expect(paragraph?.content?.some((n) => n.type === "rawInline")).toBe(true);
  });

  it("preserves a custom macro's arguments instead of dropping them (unregistered macro signature)", () => {
    const body = "\\role{Senior Engineer}{Google}{Mountain View}{2020 -- Present}\n";
    const doc = parseLatexBody(body);
    const paragraph = doc.content?.find((n) => n.type === "paragraph");
    const rawInline = paragraph?.content?.find((n) => n.type === "rawInline");
    expect(rawInline?.attrs?.source).toBe(
      "\\role{Senior Engineer}{Google}{Mountain View}{2020 -- Present}",
    );
  });

  it("preserves escaped special characters as literal text instead of dropping them", () => {
    const doc = parseLatexBody("cut p99 latency 38\\% and saved \\$14M/year\n");
    const paragraph = doc.content?.find((n) => n.type === "paragraph");
    expect(fullText(paragraph)).toBe("cut p99 latency 38% and saved $14M/year");
  });

  it("keeps unrecognized inline commands like \\hfill and \\\\ inline instead of splitting the paragraph", () => {
    const body = "\\textbf{Ratel} \\hfill \\href{https://x.com}{y} \\\\\nmore text\n";
    const doc = parseLatexBody(body);
    expect(doc.content?.filter((n) => n.type === "paragraph")).toHaveLength(1);
    const paragraph = doc.content?.[0];
    expect(paragraph?.content?.some((n) => n.type === "rawInline" && n.attrs?.source === "\\hfill")).toBe(true);
    expect(paragraph?.content?.some((n) => n.type === "rawInline" && n.attrs?.source === "\\\\")).toBe(true);
  });

  it("preserves a comment as a rawBlock instead of dropping it", () => {
    const doc = parseLatexBody("Some text % a trailing comment\nmore text.\n");
    const rawBlock = doc.content?.find((n) => n.type === "rawBlock");
    expect(rawBlock).toBeDefined();
    expect(rawBlock?.attrs?.source).toContain("a trailing comment");
    const texts = doc.content?.filter((n) => n.type === "paragraph").map((n) => fullText(n));
    expect(texts).toContain("Some text");
    expect(texts).toContain("more text.");
  });

  it("falls back to a rawBlock for unrecognized environments", () => {
    const doc = parseLatexBody("\\begin{tabular}{cc}\na & b\n\\end{tabular}\n");
    const rawBlock = doc.content?.find((n) => n.type === "rawBlock");
    expect(rawBlock).toBeDefined();
    expect(rawBlock?.attrs?.source).toContain("\\begin{tabular}");
    expect(rawBlock?.attrs?.source).toContain("\\end{tabular}");
  });
});
