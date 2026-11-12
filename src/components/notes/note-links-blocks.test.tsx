// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteLinkMenu } from "./NoteLinkMenu";
import {
  type BlockChoice,
  blockCandidates,
  canEmbed,
  candidateHref,
  candidateText,
  chooseNoteLink,
  type LinkableNote,
  type NoteLinkOptions,
  noteLinkExtensions,
  noteLinkSuggestion,
  scrollViewToHeading,
} from "./note-links";
import { destroyKbEditors, kbEditor, kbMarkdown as markdown } from "./tests/kb-editor-fixtures";
import "./tests/setup";

const NOTES: LinkableNote[] = [
  { noteId: "self", projectId: "lib-0", title: "This note" },
  { noteId: "n-2", projectId: "lib-2", title: "Abstract draft" },
];
const REMOTE: BlockChoice[] = [
  { id: "res", kind: "paragraph", text: "Accuracy rose to 64%", at: 3, trailing: false, live: false },
  { id: null, kind: "item", text: "Check the seed", at: 5, trailing: false, live: false },
];

function build(text: string, overrides: Partial<NoteLinkOptions> = {}) {
  const options: NoteLinkOptions = {
    getNotes: () => NOTES,
    getProjects: () => [],
    getBlocks: () => REMOTE,
    onOpenNote: vi.fn(),
    onOpenProject: vi.fn(),
    currentProjectId: "lib-0",
    ...overrides,
  };
  const editor = kbEditor(text, null, noteLinkExtensions(options));
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => ({ left: 10, top: 10, bottom: 20, right: 0 }));
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
  return { editor, options };
}

function type(editor: Editor, text: string) {
  act(() => {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
}

afterEach(destroyKbEditors);

describe("block links in the [[ menu", () => {
  it("lists this note's blocks for [[#^ and gives the chosen one an id", () => {
    const { editor } = build("Accuracy rose ^acc\n\nSeed check\n\nEnd");
    type(editor, " [[#^seed");
    const suggestion = noteLinkSuggestion(editor.state);
    expect(suggestion?.blocks).toBe(true);
    expect(suggestion?.items.map((item) => (item.kind === "block" ? item.block.text : item.kind))).toEqual(["Seed check"]);
    act(() => {
      chooseNoteLink(editor.view, 0);
    });
    const saved = markdown(editor);
    const id = /Seed check \^([a-z0-9]{6})/u.exec(saved)?.[1];
    expect(id).toBeDefined();
    expect(saved).toContain(`End [Seed check](oleafly://note/self#^${id})`);
  });

  it("links to another note's block by its id, or asks for an id first", async () => {
    const assignBlockId = vi.fn(() => Promise.resolve("new-1"));
    const { editor } = build("A", { assignBlockId });
    type(editor, " [[Abstract#^");
    expect(noteLinkSuggestion(editor.state)?.items).toHaveLength(2);
    act(() => {
      chooseNoteLink(editor.view, 0);
    });
    expect(markdown(editor)).toBe("A [Abstract draft > Accuracy rose to 64%](oleafly://note/n-2#^res) ");
    type(editor, "[[Abstract#^check");
    await act(async () => {
      chooseNoteLink(editor.view, 0);
      await Promise.resolve();
    });
    expect(assignBlockId).toHaveBeenCalledWith("lib-2", REMOTE[1]);
    expect(markdown(editor)).toContain("[Abstract draft > Check the seed](oleafly://note/n-2#^new-1)");
  });

  it("says when blocks are loading or none match, and renders block options", () => {
    let ready = false;
    const { editor } = build("A", { getBlocks: () => (ready ? REMOTE : null) });
    render(<NoteLinkMenu editor={editor} />);
    type(editor, " [[Abstract#^");
    expect(screen.getByText("Loading blocks")).toBeTruthy();
    ready = true;
    type(editor, "zzz");
    expect(screen.getByText("No matching blocks")).toBeTruthy();
    for (let index = 0; index < 3; index++) {
      act(() => {
        editor.view.dispatch(editor.state.tr.delete(editor.state.selection.from - 1, editor.state.selection.from));
      });
    }
    expect(screen.getByText("^res")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Check the seed/u })).toBeTruthy();
  });

  it("builds addresses, labels and embeds for blocks", () => {
    const [block] = blockCandidates(NOTES[1], REMOTE, "accuracy", false);
    if (block.kind !== "block") throw new Error("not a block");
    expect(candidateHref(block)).toBe("oleafly://note/n-2#^res");
    expect(candidateText(block, null)).toBe("Abstract draft > Accuracy rose to 64%");
    expect(candidateText({ ...block, self: true }, null)).toBe("Accuracy rose to 64%");
    expect(canEmbed(block)).toBe(true);
    expect(canEmbed({ ...block, self: true })).toBe(false);
    expect(blockCandidates(NOTES[1], REMOTE, "res", false)).toHaveLength(1);
  });

  it("scrolls to a block from a #^ fragment", () => {
    const { editor } = build("One\n\nTarget ^tg\n\nThree");
    expect(scrollViewToHeading(editor.view, "^tg")).toBe(true);
    expect(editor.state.doc.resolve(editor.state.selection.from).parent.textContent).toBe("Target");
  });
});
