// @vitest-environment jsdom
import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { destroyOpenedEditors, openMarkdown, positionAfter, typeAtEndOf } from "../test-helpers";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";

afterEach(destroyOpenedEditors);

function blocks(source: string): JSONContent[] {
  return parseMarkdownBody(source).doc.content ?? [];
}

function marksOf(block: JSONContent): string[] {
  return (block.content ?? []).flatMap((node) => node.marks?.map((mark) => mark.type) ?? []);
}

describe("Pandoc fenced divs for alignment", () => {
  it.each(["center", "right", "justify", "left"])("reads ::: {.%s} as an aligned paragraph", (align) => {
    const [paragraph] = blocks(`::: {.${align}}\nSome text\n:::`);
    expect(paragraph.type).toBe("paragraph");
    expect(paragraph.attrs?.textAlign).toBe(align);
  });

  it("keeps inline formatting inside the div", () => {
    const source = "::: {.center}\nSome **bold**, *italic*, `code`, ~~gone~~, <u>under</u> and a [link](https://example.com)\n:::";
    const [paragraph] = blocks(source);
    expect(paragraph.attrs?.textAlign).toBe("center");
    expect(marksOf(paragraph)).toEqual(["bold", "italic", "code", "strike", "underline", "link"]);
    expect(serializeMarkdownBody(parseMarkdownBody(source).doc)).toBe(source);
  });

  it("aligns headings and keeps their level", () => {
    const source = "::: {.right}\n## A **bold** title\n:::";
    const [heading] = blocks(source);
    expect(heading).toMatchObject({ type: "heading", attrs: { level: 2, textAlign: "right" } });
    expect(serializeMarkdownBody(parseMarkdownBody(source).doc)).toBe(source);
  });

  it("aligns every paragraph inside one div", () => {
    const parsed = blocks("::: {.justify}\nFirst\n\nSecond\n:::\n\nAfter");
    expect(parsed.map((block) => block.attrs?.textAlign ?? null)).toEqual(["justify", "justify", null]);
  });

  it("accepts the bare class and a closing run of colons", () => {
    expect(blocks(":::: center ::::\nText\n::::")[0].attrs?.textAlign).toBe("center");
  });

  it("round-trips an aligned paragraph inside a quote", () => {
    const source = "> ::: {.center}\n> quoted *text*\n> :::";
    expect(serializeMarkdownBody(parseMarkdownBody(source).doc)).toBe(source);
  });

  it.each([
    ["another class", "::: {.note}\nText\n:::"],
    ["extra attributes", "::: {.center #intro}\nText\n:::"],
    ["a list inside", "::: {.center}\n- one\n- two\n:::"],
    ["no closing fence", "::: {.center}\nText"],
  ])("leaves a div with %s as text", (_name, source) => {
    const parsed = blocks(source);
    expect(parsed.every((block) => block.attrs?.textAlign == null)).toBe(true);
  });
});

describe("editing next to aligned blocks", () => {
  it("keeps an untouched div byte for byte", () => {
    const source = "::::   {.center}\nHello  **world**\n::::\n\n:::right\nOther\n:::\n\nEdit end";
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "end", "!");
    expect(save()).toBe(source.replace("Edit end", "Edit end!"));
  });

  it("keeps the fence and inline marks when the aligned text is edited", () => {
    const source = "Before\n\n::: {.justify}\nSome *text* and **more** end\n:::\n\nAfter";
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "end", "!");
    expect(save()).toBe(source.replace("end\n", "end!\n"));
  });

  it("writes a fence when a paragraph is aligned and drops it when unset", () => {
    const source = "First *one*\n\nSecond";
    const { editor, save } = openMarkdown(source);
    editor.chain().setTextSelection(positionAfter(editor, "First")).setTextAlign("center").run();
    expect(save()).toBe("::: {.center}\nFirst *one*\n:::\n\nSecond");
    editor.chain().setTextSelection(positionAfter(editor, "First")).unsetTextAlign().run();
    expect(save()).toBe(source);
  });

  it("aligns a heading from the command", () => {
    const { editor, save } = openMarkdown("### Title\n\nText");
    editor.chain().setTextSelection(positionAfter(editor, "Title")).setTextAlign("right").run();
    expect(save()).toBe("::: {.right}\n### Title\n:::\n\nText");
  });

  it("writes no fence around an empty aligned paragraph", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "center" } }, { type: "paragraph", content: [{ type: "text", text: "x" }] }] };
    expect(serializeMarkdownBody(doc)).not.toContain(":::");
  });
});
