// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { createWysiwygExtensions, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NEW_BLOCKS, newChartSource } from "./block-templates";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NoteToolbar } from "./NoteToolbar";
import type { CitationItem } from "./types";

let editors: Editor[] = [];
let hosts: HTMLElement[] = [];

function notesData(citations: readonly CitationItem[]): NotesData {
  return {
    notes: [],
    artifacts: [],
    experiments: [],
    agents: [],
    papers: [],
    citations,
    proposeEdits: vi.fn(),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
  };
}

function mount(markdown: string, citations: readonly CitationItem[] = []) {
  const element = document.createElement("div");
  document.body.append(element);
  hosts.push(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions(),
    content: parseMarkdownBody(markdown).doc,
  });
  editors.push(editor);
  const user = userEvent.setup();
  render(
    <NotesDataProvider value={notesData(citations)}>
      <NoteToolbar editor={editor} />
    </NotesDataProvider>,
  );
  return { editor, user };
}

function markdownOf(editor: Editor): string {
  return serializeMarkdownBody(editor.getJSON());
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

function openMenu(name: string) {
  fireEvent.pointerDown(button(name), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

function select(editor: Editor, from: number, to: number) {
  act(() => {
    editor.commands.setTextSelection({ from, to });
  });
}

function blocks(editor: Editor): JSONContent[] {
  return editor.getJSON().content ?? [];
}

function heading(level: number, name: string): string {
  return name.replace("{{level}}", String(level));
}

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
  const rect = new DOMRect(0, 0, 0, 0);
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect;
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  for (const host of hosts) host.remove();
  editors = [];
  hosts = [];
});

describe("NoteToolbar", () => {
  it("labels itself as the formatting toolbar", () => {
    mount("Hello");
    expect(screen.getByRole("toolbar", { name: enNotes.toolbar.label })).toBeInTheDocument();
  });

  it("undoes and redoes edits and disables each button when there is nothing to step to", async () => {
    const { editor, user } = mount("Hello");
    expect(button(enEditor.hotkeys.actions.undo)).toBeDisabled();
    expect(button(enEditor.hotkeys.actions.redo)).toBeDisabled();

    act(() => {
      editor.chain().insertContentAt(6, " world").run();
    });
    expect(button(enEditor.hotkeys.actions.undo)).toBeEnabled();
    await user.click(button(enEditor.hotkeys.actions.undo));
    expect(markdownOf(editor).trim()).toBe("Hello");
    expect(button(enEditor.hotkeys.actions.redo)).toBeEnabled();
    await user.click(button(enEditor.hotkeys.actions.redo));
    expect(markdownOf(editor).trim()).toBe("Hello world");
  });

  it("turns the current block into headings, text, a quote or a code block", async () => {
    const { editor, user } = mount("Results so far");
    const trigger = button(enNotes.toolbar.blockType);
    expect(trigger.querySelector(".lucide-type")).not.toBeNull();
    expect(trigger).not.toHaveClass("bg-primary/10");

    for (const level of [1, 2, 3, 4]) {
      const menu = openMenu(enNotes.toolbar.blockType);
      await user.click(within(menu).getByRole("menuitem", { name: heading(level, enNotes.toolbar.heading) }));
      expect(blocks(editor)[0]).toMatchObject({ type: "heading", attrs: { level } });
      expect(button(enNotes.toolbar.blockType).querySelector(`.lucide-heading-${level}`)).not.toBeNull();
    }
    expect(button(enNotes.toolbar.blockType)).toHaveClass("bg-primary/10");

    await user.click(within(openMenu(enNotes.toolbar.blockType)).getByRole("menuitem", { name: enNotes.toolbar.text }));
    expect(blocks(editor)[0].type).toBe("paragraph");
    expect(button(enNotes.toolbar.blockType)).not.toHaveClass("bg-primary/10");

    await user.click(within(openMenu(enNotes.toolbar.blockType)).getByRole("menuitem", { name: enEditor.contextMenu.quote }));
    expect(blocks(editor)[0].type).toBe("blockquote");
    expect(button(enNotes.toolbar.blockType)).toHaveClass("bg-primary/10");
    await user.click(within(openMenu(enNotes.toolbar.blockType)).getByRole("menuitem", { name: enEditor.contextMenu.quote }));
    expect(blocks(editor)[0].type).toBe("paragraph");

    await user.click(within(openMenu(enNotes.toolbar.blockType)).getByRole("menuitem", { name: enEditor.toolbar.codeBlock }));
    expect(blocks(editor)[0].type).toBe("codeBlock");
    expect(button(enNotes.toolbar.blockType)).toHaveClass("bg-primary/10");
  });

  it("toggles bullet and numbered lists and shows which one is on", async () => {
    const { editor, user } = mount("First point");
    expect(button(enNotes.toolbar.list).querySelector(".lucide-list")).not.toBeNull();

    await user.click(within(openMenu(enNotes.toolbar.list)).getByRole("menuitem", { name: enNotes.toolbar.bulletList }));
    expect(blocks(editor)[0].type).toBe("bulletList");
    expect(button(enNotes.toolbar.list)).toHaveClass("bg-primary/10");

    await user.click(within(openMenu(enNotes.toolbar.list)).getByRole("menuitem", { name: enEditor.toolbar.numberedList }));
    expect(blocks(editor)[0].type).toBe("orderedList");
    expect(button(enNotes.toolbar.list).querySelector(".lucide-list-ordered")).not.toBeNull();
  });

  it.each([
    [enEditor.toolbar.bold, "**mask**"],
    [enEditor.toolbar.italic, "*mask*"],
    [enEditor.toolbar.strikethrough, "~~mask~~"],
    [enEditor.toolbar.inlineCode, "`mask`"],
  ])("applies %s to the selected words and marks the button pressed", async (name, expected) => {
    const { editor, user } = mount("The mask ratio");
    select(editor, 5, 9);
    expect(button(name)).toHaveAttribute("aria-pressed", "false");
    await user.click(button(name));
    expect(markdownOf(editor)).toContain(`The ${expected} ratio`);
    select(editor, 6, 6);
    expect(button(name)).toHaveAttribute("aria-pressed", "true");
  });

  it("links the selected words when the person presses Enter in the link box", async () => {
    const { editor, user } = mount("See the paper");
    select(editor, 9, 14);
    await user.click(button(enNotes.toolbar.link));
    const address = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    expect(address).toHaveAttribute("placeholder", enNotes.toolbar.linkPlaceholder);

    fireEvent.keyDown(address, { key: "Enter" });
    expect(markdownOf(editor)).not.toContain("](");

    fireEvent.change(address, { target: { value: "  https://example.org/paper  " } });
    fireEvent.keyDown(address, { key: "a" });
    expect(markdownOf(editor)).not.toContain("](");

    fireEvent.keyDown(address, { key: "Enter" });
    expect(markdownOf(editor)).toContain("[paper](https://example.org/paper)");
  });

  it("inserts inline and display math", async () => {
    const { editor, user } = mount("Area");
    select(editor, 5, 5);
    await user.click(button(enEditor.contextMenu.inlineMath));
    expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe("mathInline");
    expect(markdownOf(editor)).toContain("$x^2$");

    await user.click(button(enNotes.toolbar.displayMath));
    let display = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "mathDisplay") display = true;
    });
    expect(display).toBe(true);
    expect(markdownOf(editor)).toContain("$$x^2$$");
  });

  it("inserts a citation key picked from the project references", async () => {
    const { editor, user } = mount("As shown", [
      { key: "he2022mae", label: "He et al., 2022" },
      { key: "dosovitskiy2021", label: "Dosovitskiy et al., 2021" },
    ]);
    select(editor, 9, 9);
    const menu = openMenu(enNotes.toolbar.citation);
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
    await user.click(within(menu).getByRole("menuitem", { name: "He et al., 2022" }));
    expect(editor.getText()).toBe("As shown[@he2022mae]");
  });

  it("says there are no references when the project has none", () => {
    mount("As shown");
    const menu = openMenu(enNotes.toolbar.citation);
    expect(within(menu).queryByRole("menuitem")).not.toBeInTheDocument();
    expect(within(menu).getByText(enNotes.toolbar.noCitations)).toBeInTheDocument();
  });

  it("sizes a new table by hovering the grid and inserts it on click", async () => {
    const { editor, user } = mount("Before");
    await user.click(button(enEditor.toolbar.insertTable));
    expect(screen.getByText("1 × 1")).toBeInTheDocument();
    const cell = (cols: number, rows: number) =>
      button(enNotes.toolbar.tableSize.replace("{{cols}}", String(cols)).replace("{{rows}}", String(rows)));
    expect(within(screen.getByRole("dialog")).getAllByRole("button")).toHaveLength(64);
    expect(cell(1, 1)).toHaveClass("bg-primary/10");
    expect(cell(2, 1)).not.toHaveClass("bg-primary/10");

    fireEvent.mouseEnter(cell(5, 2));
    expect(screen.getByText("5 × 2")).toBeInTheDocument();
    expect(cell(5, 2)).toHaveClass("bg-primary/10");
    expect(cell(3, 3)).not.toHaveClass("bg-primary/10");

    fireEvent.focus(cell(2, 4));
    expect(screen.getByText("2 × 4")).toBeInTheDocument();

    await user.click(cell(4, 2));
    const table = blocks(editor).find((block) => block.type === "table");
    expect(table?.content).toHaveLength(2);
    expect(table?.content?.[0].content).toHaveLength(4);
    expect(table?.content?.[0].content?.[0].type).toBe("tableHeader");
  });

  it("shows row, column and delete tools only while the cursor is in a table", async () => {
    const { editor, user } = mount("Intro\n\n| Run | Ratio |\n| --- | --- |\n| 1 | 0.75 |\n");
    expect(screen.queryByRole("button", { name: enNotes.toolbar.addRow })).not.toBeInTheDocument();

    let cellPosition = 0;
    editor.state.doc.descendants((node, position) => {
      if (cellPosition === 0 && node.type.name === "tableCell") cellPosition = position + 2;
    });
    select(editor, cellPosition, cellPosition);

    await user.click(button(enNotes.toolbar.addRow));
    const rows = () => blocks(editor).find((block) => block.type === "table")?.content ?? [];
    expect(rows()).toHaveLength(3);
    await user.click(button(enNotes.toolbar.addColumn));
    expect(rows()[0].content).toHaveLength(3);
    await user.click(button(enEditor.tableToolbar.deleteTable));
    expect(blocks(editor).some((block) => block.type === "table")).toBe(false);
    expect(screen.queryByRole("button", { name: enNotes.toolbar.addRow })).not.toBeInTheDocument();
  });

  it("inserts a chart and a Mermaid diagram as fenced blocks", async () => {
    const { editor, user } = mount("Figures");
    await user.click(button(enNotes.toolbar.chart));
    const chart = blocks(editor).find((block) => block.type === "codeBlock");
    expect(chart?.attrs?.language).toBe("chart");
    expect(chart?.content?.[0].text).toBe(newChartSource());

    await user.click(button(enNotes.toolbar.mermaid));
    const mermaid = blocks(editor).filter((block) => block.type === "codeBlock").at(-1);
    expect(mermaid?.attrs?.language).toBe(NEW_BLOCKS.mermaid.info);
    expect(mermaid?.content?.[0].text).toBe(NEW_BLOCKS.mermaid.source);
  });

  it.each([
    [enNotes.toolbar.latexBlock, NEW_BLOCKS.latex],
    [enNotes.toolbar.typstBlock, NEW_BLOCKS.typst],
  ])("inserts a %s from the raw block menu", async (name, block) => {
    const { editor, user } = mount("Equations");
    await user.click(within(openMenu(enNotes.toolbar.rawBlock)).getByRole("menuitem", { name }));
    const inserted = blocks(editor).find((node) => node.type === "codeBlock");
    expect(inserted?.attrs?.language).toBe(block.info);
    expect(inserted?.content?.[0].text).toBe(block.source);
  });

  it("lists the headings in the outline, indented by level, and scrolls to the one picked", async () => {
    const { editor, user } = mount("# Overview\n\nText\n\n## Method\n\nMore\n\n### Ablation\n");
    const menu = openMenu(enNotes.toolbar.outline);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Overview", "Method", "Ablation"]);
    expect(items[0].style.paddingInlineStart).toBe("0.5rem");
    expect(items[2].style.paddingInlineStart).toBe("1.5rem");

    const target = editor.view.dom.querySelector("h2") as HTMLElement;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    await user.click(items[1]);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });

  it("does not scroll when the outline entry has no element on the page", async () => {
    const { editor, user } = mount("# Overview\n");
    const nodeDOM = vi.spyOn(editor.view, "nodeDOM").mockReturnValue(null);
    const menu = openMenu(enNotes.toolbar.outline);
    await user.click(within(menu).getByRole("menuitem", { name: "Overview" }));
    expect(nodeDOM).toHaveBeenCalledWith(0);
  });

  it("asks for a heading when the outline is empty", () => {
    mount("Just a paragraph");
    const menu = openMenu(enNotes.toolbar.outline);
    expect(within(menu).getByText(enNotes.toolbar.emptyOutline)).toBeInTheDocument();
  });

  it("counts the words in the note as it changes", () => {
    const { editor } = mount("One");
    expect(screen.getByText("1 word")).toBeInTheDocument();
    act(() => {
      editor.commands.setContent(parseMarkdownBody("The mask ratio\n\nis   0.75").doc);
    });
    expect(screen.getByText("5 words")).toBeInTheDocument();
    act(() => {
      editor.commands.clearContent();
    });
    expect(screen.getByText("0 words")).toBeInTheDocument();
  });
});
