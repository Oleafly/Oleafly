// @vitest-environment jsdom
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { Editor, type JSONContent } from "@tiptap/core";
import { DecorationSet } from "@tiptap/pm/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHighlightLanguage } from "@/components/ui/code-highlighter";
import { withBlockViews } from "./block-views";
import {
  blockSpans,
  codeHighlightKey,
  codeHighlightPlugin,
  codeLanguage,
  DEFER_HIGHLIGHT_CHARS,
  DEFER_HIGHLIGHT_MS,
} from "./code-highlight";
import "./tests/setup";

const editors: Editor[] = [];

function build(...content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions().map(withBlockViews),
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}

function codeBlock(language: string | null, text: string): JSONContent {
  return { type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("codeLanguage", () => {
  it.each([
    ["python", "python"],
    ["Py", "python"],
    ["matlab", "octave"],
    ["bash", "shell"],
    ["c++", "cpp"],
    ["yml", "yaml"],
    ["r  {.numberLines}", "r"],
    ["julia", "julia"],
    ["SQL", "sql"],
    ["tex", "latex"],
  ])("maps %s to %s", (info, name) => {
    expect(codeLanguage(info)).toBe(name);
  });

  it.each(["", "klingon", "stata", "toString", "constructor"])("has no highlighter for %s", (info) => {
    expect(codeLanguage(info)).toBeUndefined();
  });
});

describe("token spans", () => {
  it("keeps the spans of a code block for as long as the block node is unchanged", async () => {
    await loadHighlightLanguage("go");
    const editor = build(codeBlock("go", "package a0"));
    const node = editor.state.doc.child(0);
    const first = blockSpans(node, "go");
    expect(first).not.toBeNull();
    expect(blockSpans(node, "go")).toBe(first);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, "1");
    expect(blockSpans(editor.state.doc.child(0), "go")).not.toBe(first);
  });
});

describe("codeHighlightPlugin", () => {
  it("decorates known languages without replacing the editable text", async () => {
    const editor = build(codeBlock("python", "def f():\n    return 1"), codeBlock("klingon", "qapla"), codeBlock(null, "x"));
    await vi.waitFor(() => expect(editor.view.dom.querySelector("code .tok-keyword")).not.toBeNull());
    const code = editor.view.dom.querySelector(".note-code-lang code") as HTMLElement;
    expect(code.textContent).toBe("def f():\n    return 1");
    expect([...code.querySelectorAll(".tok-keyword")].map((node) => node.textContent)).toEqual(["def", "return"]);
    editor.commands.insertContentAt(2, "x");
    expect(editor.state.doc.child(0).textContent).toBe("dxef f():\n    return 1");
    expect(codeHighlightKey.getState(editor.state)?.find().length).toBeGreaterThan(0);
  });

  it("keeps its decorations for selection-only changes and loads languages added later", async () => {
    const editor = build({ type: "paragraph", content: [{ type: "text", text: "hello" }] });
    const before = codeHighlightKey.getState(editor.state);
    editor.commands.setTextSelection(2);
    expect(codeHighlightKey.getState(editor.state)).toBe(before);
    editor.commands.insertContentAt(editor.state.doc.content.size, codeBlock("toml", 'name = "x"'));
    await vi.waitFor(() => expect(editor.view.dom.querySelector(".tok-string")).not.toBeNull());
  });

  it("only re-highlights the code block an edit touched", async () => {
    await loadHighlightLanguage("python");
    const editor = build(codeBlock("python", "def a():\n    return 1"), codeBlock("python", "def b():\n    return 2"));
    const second = () => codeHighlightKey.getState(editor.state)?.find(editor.state.doc.child(0).nodeSize, editor.state.doc.content.size) ?? [];
    const before = second().map((decoration) => decoration.from);
    expect(before.length).toBeGreaterThan(0);
    const create = vi.spyOn(DecorationSet, "create");
    try {
      editor.commands.insertContentAt(3, "x");
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
    expect(second().map((decoration) => decoration.from - 1)).toEqual(before);
  });

  it("waits for a pause before re-highlighting a long code block", async () => {
    await loadHighlightLanguage("python");
    const long = Array.from({ length: Math.ceil(DEFER_HIGHLIGHT_CHARS / 5) }, (_, index) => `x${index} = 1`).join("\n");
    const editor = build(codeBlock("python", long));
    await vi.waitFor(() => expect(editor.view.dom.querySelector(".tok-variableName")).not.toBeNull());
    vi.useFakeTimers();
    try {
      editor.commands.insertContentAt(1, "def ");
      await Promise.resolve();
      expect(editor.view.dom.querySelector(".tok-keyword")).toBeNull();
      await vi.advanceTimersByTimeAsync(DEFER_HIGHLIGHT_MS);
      expect(editor.view.dom.querySelector(".tok-keyword")?.textContent).toBe("def");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops dispatching once the editor is gone", async () => {
    const editor = build(codeBlock("lua", "local x = 1"));
    editor.destroy();
    expect(await loadHighlightLanguage("lua")).not.toBeNull();
    expect(codeHighlightPlugin().spec.key).toBe(codeHighlightKey);
  });
});
