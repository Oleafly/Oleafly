// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { RawBlock } from "./raw-block";

describe("RawBlock", () => {
  it("round-trips through getJSON/setContent with its source attr intact", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
      content: { type: "doc", content: [{ type: "rawBlock", attrs: { source: "\\foo{bar}" } }] },
    });
    const json = editor.getJSON();
    expect(json.content?.[0]).toMatchObject({ type: "rawBlock", attrs: { source: "\\foo{bar}" } });
    editor.destroy();
  });

  it("preserves special characters through getJSON without DOM escaping corruption", () => {
    const source = "<script>&amp;\nline one\n\nline three";
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
      content: { type: "doc", content: [{ type: "rawBlock", attrs: { source } }] },
    });
    const json = editor.getJSON();
    expect(json.content?.[0]?.attrs?.source).toBe(source);
    editor.destroy();
  });

  it("preserves special characters through a render-to-HTML and reparse round trip", () => {
    const source = 'line1\nline2\n\nline3 <x> & "quotes" \'single\'';
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
      content: { type: "doc", content: [{ type: "rawBlock", attrs: { source } }] },
    });
    const html = editor.getHTML();
    editor.destroy();

    const reparsed = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
      content: html,
    });
    const json = reparsed.getJSON();
    expect(json.content?.[0]?.attrs?.source).toBe(source);
    reparsed.destroy();
  });
});
