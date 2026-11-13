// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { WYSIWYG_EXTENSIONS } from "../schema";
import { markdownEngine } from "./engine";
import { parseMarkdownBody } from "./parse";
import { markdownBlockKey, serializeMarkdownBody, serializeMarkdownDoc } from "./serialize";
import { createMarkdownSourceSnapshot } from "./source-layout";

const SOURCE = "# Title\n\nSome *text*  with [a link](x.md).\n\n```py {.numberLines}\nprint(1)\n```\n\n- one\n- two\n";

describe("markdownEngine", () => {
  it("builds one editor per extension set and reuses it for every parse and serialize", () => {
    const first = markdownEngine(WYSIWYG_EXTENSIONS);
    const created = vi.spyOn(Editor.prototype, "on");
    for (let round = 0; round < 5; round += 1) {
      serializeMarkdownBody(parseMarkdownBody(SOURCE).doc);
    }
    expect(created).not.toHaveBeenCalled();
    created.mockRestore();
    expect(markdownEngine(WYSIWYG_EXTENSIONS)).toBe(first);
  });

  it("prepares its markdown-it renderer once however often it parses", () => {
    parseMarkdownBody(SOURCE);
    const { md } = markdownEngine(WYSIWYG_EXTENSIONS).storage.markdown.parser as unknown as {
      md: { renderer: { rules: Record<string, unknown> } };
    };
    const fence = md.renderer.rules.fence;
    for (let round = 0; round < 3; round += 1) parseMarkdownBody(SOURCE);
    expect(md.renderer.rules.fence).toBe(fence);
    expect(parseMarkdownBody(SOURCE).doc.content?.[2]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "py {.numberLines}" },
    });
  });

  it("parses the same document on every call", () => {
    expect(parseMarkdownBody(SOURCE)).toEqual(parseMarkdownBody(SOURCE));
  });
});

describe("serializeMarkdownDoc", () => {
  function load(source: string) {
    const { doc, layout } = parseMarkdownBody(source);
    const node = markdownEngine(WYSIWYG_EXTENSIONS).schema.nodeFromJSON(doc);
    return { node, snapshot: createMarkdownSourceSnapshot(layout, node.toJSON()) };
  }

  it("writes the same Markdown as the JSON serializer", () => {
    const { node, snapshot } = load(SOURCE);
    expect(serializeMarkdownDoc(node)).toBe(serializeMarkdownBody(node.toJSON()));
    expect(serializeMarkdownDoc(node, snapshot)).toBe(serializeMarkdownBody(node.toJSON(), snapshot));
    expect(serializeMarkdownDoc(node, snapshot)).toBe(SOURCE);
  });

  it("keeps untouched blocks byte for byte when another block changes", () => {
    const { node, snapshot } = load(SOURCE);
    const paragraph = node.child(1);
    const edited = node.replace(
      1 + node.child(0).nodeSize,
      1 + node.child(0).nodeSize + paragraph.content.size,
      node.type.schema.node("doc", null, [node.type.schema.node("paragraph", null, node.type.schema.text("Changed"))]).slice(1, 8),
    );
    expect(serializeMarkdownDoc(edited, snapshot)).toBe(SOURCE.replace("Some *text*  with [a link](x.md).", "Changed"));
  });

  it("computes each block key once per node", () => {
    const { node } = load(SOURCE);
    const block = node.child(0);
    const toJSON = vi.spyOn(block, "toJSON");
    expect(markdownBlockKey(block)).toBe(JSON.stringify(block.toJSON()));
    toJSON.mockClear();
    markdownBlockKey(block);
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("takes block keys a caller already has", () => {
    const { node } = load(SOURCE);
    const { layout } = parseMarkdownBody(SOURCE);
    const keys: string[] = [];
    node.forEach((block) => keys.push(markdownBlockKey(block)));
    expect(createMarkdownSourceSnapshot(layout, node.toJSON(), keys)).toEqual(
      createMarkdownSourceSnapshot(layout, node.toJSON()),
    );
  });
});
