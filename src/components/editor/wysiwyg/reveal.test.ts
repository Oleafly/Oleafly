// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { createWysiwygExtensions, parseMarkdownBody } from "@oleafly/wysiwyg";
import { useFilesStore } from "@/store/files";
import { setWysiwygDocument, setWysiwygEditor, waitForWysiwygDocument } from "./controller";
import { markdownMathRanges } from "./markdown-source";
import { revealVisualLocation } from "./reveal";

const SOURCE = [
  "# Intro",
  "",
  "First paragraph with $x^2$.",
  "",
  "## Methods",
  "",
  "We measured it.",
  "",
].join("\n");

let editor: Editor;

function load(source: string): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const { doc } = parseMarkdownBody(source, { preservedInlineRanges: markdownMathRanges(source) });
  const created = new Editor({
    element,
    extensions: createWysiwygExtensions(),
    content: doc,
    editorProps: { handleScrollToSelection: () => true },
  });
  useFilesStore.setState({
    files: { "notes.md": { content: source } } as unknown as ReturnType<typeof useFilesStore.getState>["files"],
  });
  return created;
}

function selectedBlock(): string {
  const { $from } = editor.state.selection;
  return $from.node(1).textContent;
}

beforeEach(() => {
  editor = load(SOURCE);
});

afterEach(() => {
  setWysiwygEditor(null);
  editor.destroy();
  document.body.innerHTML = "";
});

describe("revealVisualLocation", () => {
  it("waits for the Visual editor to hold the file, then selects the block at the offset", async () => {
    const shown = revealVisualLocation(
      { path: "notes.md", range: { from: SOURCE.indexOf("## Methods"), to: SOURCE.indexOf("## Methods") + 10 } },
      new AbortController().signal,
      { select: true, focus: false },
    );
    setWysiwygEditor(editor as unknown as ReactEditor);
    setWysiwygDocument(editor as unknown as ReactEditor, "notes.md");

    expect(await shown).toBe(true);
    expect(selectedBlock()).toBe("Methods");
  });

  it("finds a line number's block", async () => {
    setWysiwygEditor(editor as unknown as ReactEditor);
    setWysiwygDocument(editor as unknown as ReactEditor, "notes.md");
    expect(
      await revealVisualLocation({ path: "notes.md", line: 7 }, new AbortController().signal, {
        select: true,
        focus: false,
      }),
    ).toBe(true);
    expect(selectedBlock()).toBe("We measured it.");
  });

  it("leaves the selection alone when asked to", async () => {
    setWysiwygEditor(editor as unknown as ReactEditor);
    setWysiwygDocument(editor as unknown as ReactEditor, "notes.md");
    const before = editor.state.selection.from;
    expect(
      await revealVisualLocation({ path: "notes.md", line: 7 }, new AbortController().signal, {
        select: false,
        focus: false,
      }),
    ).toBe(true);
    expect(editor.state.selection.from).toBe(before);
  });

  it("declines when the editor's blocks no longer match the source", async () => {
    setWysiwygEditor(editor as unknown as ReactEditor);
    setWysiwygDocument(editor as unknown as ReactEditor, "notes.md");
    useFilesStore.setState({
      files: { "notes.md": { content: `${SOURCE}\nA new paragraph.\n` } } as unknown as ReturnType<
        typeof useFilesStore.getState
      >["files"],
    });
    expect(
      await revealVisualLocation({ path: "notes.md", line: 1 }, new AbortController().signal, {
        select: true,
        focus: false,
      }),
    ).toBe(false);
  });

  it("stops waiting when the jump is cancelled", async () => {
    const abort = new AbortController();
    const waiting = waitForWysiwygDocument("other.md", abort.signal);
    setWysiwygEditor(editor as unknown as ReactEditor);
    setWysiwygDocument(editor as unknown as ReactEditor, "notes.md");
    abort.abort();
    expect(await waiting).toBeNull();
  });
});
