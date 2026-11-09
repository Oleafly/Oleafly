// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { createWysiwygExtensions, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import type { ZoteroHit, ZoteroLibraryStatus } from "@oleafly/backend-port";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NEW_BLOCKS, newChartSource } from "./block-templates";
import { htmlTemplate } from "./html-block";
import { REACT_TEMPLATE } from "./react-block";
import { SVG_TEMPLATE } from "./svg-block";
import { TYPST_TEMPLATE } from "./typst-block";
import { useToastStore } from "@/store/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useZoteroLibraryStore } from "@/store/zotero-library";
import { NOTE_WIDTH_KEY, saveNoteWidth } from "./note-prefs";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NoteToolbar } from "./NoteToolbar";
import type { CitationItem } from "./types";

const counter = vi.hoisted(() => vi.fn());
const zotero = vi.hoisted(() => ({ search: vi.fn(), insert: vi.fn() }));

vi.mock("./note-word-count", async (importOriginal) => {
  const real = await importOriginal<typeof import("./note-word-count")>();
  counter.mockImplementation(real.noteWordCount);
  return { ...real, noteWordCount: counter };
});

vi.mock("@/lib/zotero/search-client", () => ({
  cachedZoteroSearch: () => null,
  searchZoteroLibrary: zotero.search,
}));

vi.mock("@/features/zotero-actions", () => ({ insertZoteroCitation: zotero.insert }));

vi.mock("@/features/zotero-cite", () => ({
  projectBibliography: () => ({ keys: new Set(["taken2020"]), doiToKey: new Map(), links: {} }),
  existingKeyForHit: () => null,
}));

let editors: Editor[] = [];
let hosts: HTMLElement[] = [];
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

function layout(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-note-toolbar-groups") ? width : 0;
    },
  });
}

interface Sources {
  related?: string;
  projectCitations?: NotesData["projectCitations"];
  readOnly?: boolean;
  projectId?: string;
}

function notesData(citations: readonly CitationItem[], sources: Sources): NotesData {
  return {
    notes: [{ id: "n1", title: "Note", project: "Paper", relatedProjectId: sources.related, updatedAt: 1, author: "you", summary: "" }],
    artifacts: [],
    experiments: [],
    papers: [],
    citations,
    projectCitations: sources.projectCitations,
    loadNote: vi.fn(),
    saveNote: vi.fn(),
  };
}

function mount(markdown: string, citations: readonly CitationItem[] = [], sources: Sources = {}) {
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
    <NotesDataProvider value={notesData(citations, sources)}>
      <NoteToolbar editor={editor} noteId="n1" projectId={sources.projectId} readOnly={sources.readOnly} />
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

beforeEach(() => {
  layout(2000);
  localStorage.removeItem(NOTE_WIDTH_KEY);
  useSettingsStore.setState({ notesWidth: "standard", notesShowWordCount: true });
});

afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
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

  it("inserts the address as a link when nothing is selected, and says when the address can't be used", async () => {
    const { editor, user } = mount("See");
    select(editor, 4, 4);
    const before = markdownOf(editor);
    await user.click(button(enNotes.toolbar.link));
    const address = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    fireEvent.change(address, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(address, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(enNotes.toolbar.linkInvalid);
    expect(address).toHaveAttribute("aria-invalid", "true");
    expect(markdownOf(editor)).toBe(before);
    fireEvent.change(address, { target: { value: "https://example.org" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(address, { key: "Enter", keyCode: 229 });
    expect(markdownOf(editor)).not.toContain("](");
    fireEvent.keyDown(address, { key: "Enter" });
    expect(markdownOf(editor)).toContain("See<https://example.org>");
    act(() => {
      editor.commands.insertContent(" more");
    });
    expect(markdownOf(editor)).toContain("<https://example.org> more");
  });

  it("shows the current address for a link and removes it with Remove link or an empty Enter", async () => {
    const { editor, user } = mount("See the [paper](https://example.org/paper) and [notes](oleafly://note/n-1) here");
    select(editor, 11, 11);
    await user.click(button(enNotes.toolbar.link));
    const address = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    expect(address).toHaveValue("https://example.org/paper");
    await user.click(screen.getByRole("button", { name: enEditor.toolbar.removeLink }));
    expect(markdownOf(editor)).toContain("See the paper and [notes](oleafly://note/n-1) here");

    const notes = markdownOf(editor).indexOf("notes") + 1;
    select(editor, notes, notes);
    await user.click(button(enNotes.toolbar.link));
    const second = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    expect(second).toHaveValue("oleafly://note/n-1");
    fireEvent.change(second, { target: { value: "   " } });
    fireEvent.keyDown(second, { key: "Enter" });
    expect(markdownOf(editor)).not.toContain("](");
  });

  it("offers Remove link only when the cursor is on a link", async () => {
    const { editor, user } = mount("See the paper");
    select(editor, 9, 14);
    await user.click(button(enNotes.toolbar.link));
    expect(screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress })).toHaveValue("");
    expect(screen.queryByRole("button", { name: enEditor.toolbar.removeLink })).not.toBeInTheDocument();
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
    expect(await within(menu).findAllByRole("menuitem")).toHaveLength(2);
    await user.click(within(menu).getByRole("menuitem", { name: "He et al., 2022" }));
    expect(editor.getText()).toBe("As shown[@he2022mae]");
  });

  it("keeps only the view controls for a note that can't be edited", () => {
    layout(2000);
    mount("One two", [{ key: "he2022mae", label: "He et al., 2022" }], { readOnly: true });
    const toolbar = screen.getByRole("toolbar");
    for (const name of [
      enEditor.hotkeys.actions.undo,
      enEditor.hotkeys.actions.redo,
      enNotes.toolbar.blockType,
      enNotes.toolbar.list,
      enEditor.toolbar.bold,
      enNotes.toolbar.citation,
      enNotes.toolbar.displayMath,
    ]) {
      expect(within(toolbar).queryByRole("button", { name })).toBeNull();
    }
    expect(within(toolbar).getByRole("button", { name: enNotes.toolbar.width })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: enNotes.toolbar.outline })).toBeInTheDocument();
    expect(toolbar).toHaveTextContent("2 words");
  });

  it("offers no Citation menu when the note has no references to cite", () => {
    mount("As shown", [], { projectCitations: vi.fn() });
    expect(screen.queryByRole("button", { name: enNotes.toolbar.citation })).not.toBeInTheDocument();
  });

  it("lists the references of the note's related project", async () => {
    const projectCitations = vi.fn(async () => [{ key: "he2022mae", label: "He 2022, MAE" }]);
    const { editor, user } = mount("As shown", [], { related: "paper-1", projectCitations });
    select(editor, 9, 9);
    const menu = openMenu(enNotes.toolbar.citation);
    await user.click(await within(menu).findByRole("menuitem", { name: "He 2022, MAE" }));
    expect(projectCitations).toHaveBeenCalledWith("paper-1");
    expect(editor.getText()).toBe("As shown[@he2022mae]");
  });

  it("says there are no references when the related project has none or can't be read", async () => {
    const projectCitations = vi.fn<NonNullable<NotesData["projectCitations"]>>(async () => []);
    mount("As shown", [], { related: "paper-1", projectCitations });
    const menu = openMenu(enNotes.toolbar.citation);
    expect(await within(menu).findByText(enNotes.toolbar.noCitations)).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem")).not.toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    projectCitations.mockRejectedValueOnce(new Error("gone"));
    const again = openMenu(enNotes.toolbar.citation);
    expect(await within(again).findByText(enNotes.toolbar.noCitations)).toBeInTheDocument();
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

  it("leaves the caret on a line after an inserted block, so typing lands outside its hidden source", async () => {
    const { editor, user } = mount("Figures");
    select(editor, 8, 8);
    await user.click(button(enNotes.toolbar.chart));
    act(() => {
      editor.commands.insertContent("Caption");
    });
    const content = blocks(editor);
    const chart = content.findIndex((block) => block.type === "codeBlock");
    expect(content[chart]?.content?.[0].text).toBe(newChartSource());
    expect(content[chart + 1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "Caption" }] });
  });

  it.each([
    ["LaTeX", NEW_BLOCKS.latex],
    ["Typst", { info: "{=typst}", source: TYPST_TEMPLATE }],
    ["SVG", { info: "svg", source: SVG_TEMPLATE }],
    [
      "HTML",
      {
        info: "html",
        get source() {
          return htmlTemplate();
        },
      },
    ],
    ["React", { info: "jsx", source: REACT_TEMPLATE }],
  ])("inserts a %s block from the Insert block menu", async (name, block) => {
    const { editor, user } = mount("Equations");
    await user.click(within(openMenu(enNotes.blocks.insert.label)).getByRole("menuitem", { name }));
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

  it("moves the caret to the outline heading and puts focus back in the note", async () => {
    const { editor, user } = mount("# Overview\n\nText\n\n## Method\n\nMore\n");
    const menu = openMenu(enNotes.toolbar.outline);
    await user.click(within(menu).getByRole("menuitem", { name: "Method" }));
    expect(editor.state.selection.$from.parent.textContent).toBe("Method");
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("puts focus back in the note after a width is picked or a menu is closed with Escape", async () => {
    const { editor, user } = mount("Text");
    const menu = openMenu(enNotes.toolbar.width);
    await user.click(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.wide }));
    expect(editor.view.hasFocus()).toBe(true);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    openMenu(enNotes.toolbar.outline);
    await user.keyboard("{Escape}");
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("follows the headings while the outline is open", () => {
    const { editor } = mount("# Overview\n\nText\n");
    const menu = openMenu(enNotes.toolbar.outline);
    expect(within(menu).getByRole("menuitem", { name: "Overview" })).toBeInTheDocument();
    act(() => {
      editor.commands.setContent("<p>Only text</p>");
    });
    expect(within(menu).queryByRole("menuitem")).toBeNull();
    expect(within(menu).getByText(enNotes.toolbar.emptyOutline)).toBeInTheDocument();
  });

  it("lists the same headings as the outline panel, leaving out quoted and empty ones", () => {
    mount("# Overview\n\n> ## Quoted\n\n##\n\n## Method   plan\n");
    const menu = openMenu(enNotes.toolbar.outline);
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Overview", "Method plan"]);
  });

  it("checks the formatting once per change, not on every transaction", () => {
    const { editor } = mount("Some **bold** words");
    const isActive = vi.spyOn(editor, "isActive");
    act(() => {
      editor.view.dispatch(editor.state.tr.setMeta("unrelated", true));
    });
    expect(isActive).not.toHaveBeenCalled();
    act(() => {
      editor.commands.setTextSelection(7);
    });
    const checks = isActive.mock.calls.length;
    expect(checks).toBeGreaterThan(0);
    act(() => {
      editor.view.dispatch(editor.state.tr.setMeta("unrelated", true));
    });
    expect(isActive).toHaveBeenCalledTimes(checks);
    expect(button(enEditor.toolbar.bold)).toHaveAttribute("aria-pressed", "true");
  });

  it("counts the words once for each version of the note", () => {
    const { editor } = mount("One two");
    counter.mockClear();
    act(() => {
      editor.commands.insertContentAt(1, "Zero ");
    });
    expect(counter).toHaveBeenCalledTimes(1);
    act(() => {
      editor.view.dispatch(editor.state.tr.setMeta("unrelated", true));
    });
    expect(counter).toHaveBeenCalledTimes(1);
    expect(screen.getByText(enNotes.toolbar.words_other.replace("{{count}}", "3"))).toBeInTheDocument();
  });

  it.each([
    [enEditor.toolbar.insertTable],
    [enNotes.toolbar.link],
  ])("explains the %s button with a tooltip", async (label) => {
    const { user } = mount("Text");
    await user.hover(button(label));
    expect((await screen.findByRole("tooltip")).textContent).toBe(label);
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
    expect(screen.getByText("4 words")).toBeInTheDocument();
    act(() => {
      editor.commands.clearContent();
    });
    expect(screen.getByText("0 words")).toBeInTheDocument();
  });

  it("hides the word count when the Notes setting turns it off", () => {
    mount("One two");
    expect(screen.getByText("2 words")).toBeInTheDocument();
    act(() => useSettingsStore.getState().setNotesAppearance("notesShowWordCount", false));
    expect(screen.queryByText("2 words")).toBeNull();
    act(() => useSettingsStore.getState().setNotesAppearance("notesShowWordCount", true));
    expect(screen.getByText("2 words")).toBeInTheDocument();
  });
});

function zoteroHit(citationKey: string, title: string): ZoteroHit {
  return {
    library: "user",
    itemKey: citationKey.toUpperCase(),
    citationKey,
    keySource: "bbt",
    title,
    authors: ["Vaswani"],
    authorCount: 1,
    year: "2017",
    itemType: "journalArticle",
    dateModified: "2024-01-01",
    score: 1,
  };
}

describe("citing from Zotero", () => {
  const MAE = { key: "he2022mae", label: "He 2022, MAE" };
  const searchLabel = enEditor.citations.filterLabel;

  beforeAll(async () => {
    await loadNamespace("references");
  });

  beforeEach(() => {
    useFilesStore.setState({ projectId: "paper-1" });
    useZoteroLibraryStore.setState({ status: { itemCount: 3, generation: 1, libraries: [] } as unknown as ZoteroLibraryStatus });
    zotero.search.mockReset();
    zotero.search.mockResolvedValue({
      generation: 1,
      total: 3,
      complete: true,
      hits: [zoteroHit("vaswani2017", "Attention is all you need"), zoteroHit("taken2020", "Already cited"), zoteroHit("he2022mae", "Masked autoencoders")],
    });
    zotero.insert.mockReset();
    zotero.insert.mockImplementation((hit: ZoteroHit, insert: (key: string) => string | null) => insert(hit.citationKey));
  });

  afterEach(() => {
    useFilesStore.setState({ projectId: null });
    useZoteroLibraryStore.setState({ status: null });
  });

  it("searches Zotero when the note's project is the open one, and cites the picked entry", async () => {
    const projectCitations = vi.fn(async () => [MAE]);
    const { editor, user } = mount("As shown", [], { related: "paper-1", projectCitations });
    select(editor, 9, 9);
    const menu = openMenu(enNotes.toolbar.citation);
    const search = within(menu).getByRole("textbox", { name: searchLabel });
    await vi.waitFor(() => expect(search).toHaveFocus());
    expect(await within(menu).findByRole("menuitem", { name: MAE.label })).toBeInTheDocument();

    await user.keyboard("mae");
    expect(search).toHaveValue("mae");
    expect(search).toHaveFocus();
    expect(within(menu).getByRole("menuitem", { name: MAE.label })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(within(menu).getByRole("menuitem", { name: MAE.label })).toHaveFocus();

    fireEvent.change(search, { target: { value: "attention" } });
    const pick = await within(menu).findByRole("menuitem", { name: /vaswani2017/u });
    expect(within(menu).getByText(enEditor.citations.zoteroHeading)).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: MAE.label })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: /taken2020/u })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: /he2022mae/u })).toBeNull();

    await user.click(pick);
    expect(editor.getText()).toBe("As shown[@vaswani2017]");
    expect(zotero.insert).toHaveBeenCalledWith(expect.objectContaining({ citationKey: "vaswani2017" }), expect.any(Function));
  });

  it("says nothing matched when neither the project nor Zotero has the search", async () => {
    zotero.search.mockResolvedValue({ generation: 1, total: 0, complete: true, hits: [] });
    mount("As shown", [], { related: "paper-1", projectCitations: vi.fn(async () => [MAE]) });
    const menu = openMenu(enNotes.toolbar.citation);
    fireEvent.change(within(menu).getByRole("textbox", { name: searchLabel }), { target: { value: "zzz" } });
    expect(await within(menu).findByText(enEditor.citations.noMatches)).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem")).toBeNull();
  });

  it("offers the Zotero search before the project has any references", async () => {
    mount("As shown", [], { related: "paper-1", projectCitations: vi.fn(async () => []) });
    const menu = openMenu(enNotes.toolbar.citation);
    expect(within(menu).getByRole("textbox", { name: searchLabel })).toBeInTheDocument();
    expect(await within(menu).findByText(enNotes.toolbar.noCitations)).toBeInTheDocument();
  });

  it("searches Zotero from a project note, whose project is the open one", async () => {
    mount("As shown", [MAE], { projectId: "paper-1" });
    const menu = openMenu(enNotes.toolbar.citation);
    expect(within(menu).getByRole("textbox", { name: searchLabel })).toBeInTheDocument();
    expect(await within(menu).findByRole("menuitem", { name: MAE.label })).toBeInTheDocument();
  });

  it("keeps to the note's own references when its project isn't the open one", async () => {
    useFilesStore.setState({ projectId: "another-paper" });
    mount("As shown", [], { related: "paper-1", projectCitations: vi.fn(async () => [MAE]) });
    const menu = openMenu(enNotes.toolbar.citation);
    expect(await within(menu).findByRole("menuitem", { name: MAE.label })).toBeInTheDocument();
    expect(within(menu).queryByRole("textbox")).toBeNull();
    expect(zotero.search).not.toHaveBeenCalled();
  });

  it("offers no Zotero search for a note with no project, or when Zotero has nothing to search", async () => {
    mount("As shown", [], { projectCitations: vi.fn() });
    expect(screen.queryByRole("button", { name: enNotes.toolbar.citation })).toBeNull();
    cleanup();
    useZoteroLibraryStore.setState({ status: { itemCount: 0, generation: 1, libraries: [] } as unknown as ZoteroLibraryStatus });
    mount("As shown", [], { related: "paper-1", projectCitations: vi.fn(async () => [MAE]) });
    const menu = openMenu(enNotes.toolbar.citation);
    expect(await within(menu).findByRole("menuitem", { name: MAE.label })).toBeInTheDocument();
    expect(within(menu).queryByRole("textbox")).toBeNull();
  });
});

describe("NoteToolbar in a narrow panel", () => {
  function more() {
    return within(screen.getByRole("toolbar")).getByRole("button", { name: enNotes.toolbar.more });
  }

  function openMore() {
    fireEvent.pointerDown(more(), { button: 0, ctrlKey: false });
    return screen.getByRole("menu");
  }

  function openSub(menu: HTMLElement, name: string) {
    fireEvent.keyDown(within(menu).getByRole("menuitem", { name }), { key: "ArrowRight" });
    return screen.getAllByRole("menu").at(-1) as HTMLElement;
  }

  it("keeps every group on the bar and hides More when there is room", () => {
    mount("One");
    expect(within(screen.getByRole("toolbar")).queryByRole("button", { name: enNotes.toolbar.more })).toBeNull();
    expect(button(enNotes.toolbar.width)).toBeInTheDocument();
    expect(screen.getByText("1 word")).toBeInTheDocument();
  });

  it("moves the groups that do not fit into More, from the right, and keeps undo, redo and the block type", () => {
    layout(300);
    mount("One");
    expect(button(enEditor.hotkeys.actions.undo)).toBeInTheDocument();
    expect(button(enEditor.hotkeys.actions.redo)).toBeInTheDocument();
    expect(button(enNotes.toolbar.blockType)).toBeInTheDocument();
    expect(button(enNotes.toolbar.list)).toBeInTheDocument();
    expect(button(enEditor.toolbar.bold)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enEditor.contextMenu.inlineMath })).toBeNull();
    expect(screen.queryByRole("button", { name: enNotes.toolbar.width })).toBeNull();
    expect(screen.queryByText("1 word")).toBeNull();
    expect(more().parentElement).toHaveClass("ml-auto");

    const menu = openMore();
    expect(within(menu).getByRole("menuitem", { name: enEditor.contextMenu.inlineMath })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: enNotes.toolbar.chart })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.standard })).toBeInTheDocument();
    expect(within(menu).getByText("1 word")).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: enEditor.toolbar.bold })).toBeNull();
    expect(within(menu).getAllByRole("separator")).toHaveLength(4);
  });

  it("puts only the word count in More when everything else fits, and leaves More beside the view controls", () => {
    layout(620);
    mount("One", [{ key: "he2022mae", label: "He et al., 2022" }]);
    expect(button(enNotes.toolbar.width)).toBeInTheDocument();
    expect(screen.queryByText("1 word")).toBeNull();
    expect(more().parentElement).not.toHaveClass("ml-auto");
    expect(within(openMore()).getByText("1 word")).toBeInTheDocument();
  });

  it("lists marks and lists in More with their shortcuts and shows which are on", async () => {
    layout(0);
    const { editor, user } = mount("The mask ratio");
    select(editor, 5, 9);
    expect(more()).not.toHaveClass("bg-primary/10");
    let menu = openMore();
    const bold = within(menu).getByRole("menuitemcheckbox", { name: /Bold/ });
    expect(bold).toHaveAttribute("aria-checked", "false");
    expect(bold).toHaveTextContent("Ctrl+B");
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Strikethrough/ })).toHaveTextContent("Ctrl+Shift+S");
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Bullet list/ })).toHaveTextContent("Ctrl+Shift+8");
    await user.click(bold);
    expect(markdownOf(editor)).toContain("The **mask** ratio");
    select(editor, 6, 6);
    expect(more()).toHaveClass("bg-primary/10");
    menu = openMore();
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Bold/ })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Italic/ })).toHaveAttribute("aria-checked", "false");

    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /Numbered list/ }));
    expect(blocks(editor)[0].type).toBe("orderedList");
    menu = openMore();
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Numbered list/ })).toHaveAttribute("aria-checked", "true");
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /Bullet list/ }));
    expect(blocks(editor)[0].type).toBe("bulletList");

    for (const name of [/Italic/, /Strikethrough/, /Inline code/]) {
      select(editor, 1, 3);
      await user.click(within(openMore()).getByRole("menuitemcheckbox", { name }));
    }
    expect(markdownOf(editor)).toMatch(/[*~`]/u);
  });

  it("inserts math, charts, diagrams and raw blocks from More", async () => {
    layout(0);
    const { editor, user } = mount("Area");
    select(editor, 5, 5);
    await user.click(within(openMore()).getByRole("menuitem", { name: enEditor.contextMenu.inlineMath }));
    expect(markdownOf(editor)).toContain("$x^2$");
    await user.click(within(openMore()).getByRole("menuitem", { name: enNotes.toolbar.displayMath }));
    expect(markdownOf(editor)).toContain("$$x^2$$");
    await user.click(within(openMore()).getByRole("menuitem", { name: enNotes.toolbar.chart }));
    await user.click(within(openMore()).getByRole("menuitem", { name: enNotes.toolbar.mermaid }));
    for (const name of ["LaTeX", "Typst"]) {
      const item = within(openSub(openMore(), enNotes.blocks.insert.label)).getByRole("menuitem", { name });
      fireEvent.keyDown(item, { key: "Enter" });
    }
    const languages = blocks(editor)
      .filter((block) => block.type === "codeBlock")
      .map((block) => block.attrs?.language);
    expect(languages).toEqual(["chart", NEW_BLOCKS.mermaid.info, NEW_BLOCKS.latex.info, NEW_BLOCKS.typst.info]);
  });

  it("cites a reference from the More submenu and says when there is none", async () => {
    layout(0);
    const { editor, user } = mount("As shown", [{ key: "he2022mae", label: "He et al., 2022" }]);
    select(editor, 9, 9);
    const sub = openSub(openMore(), enNotes.toolbar.citation);
    await user.click(await within(sub).findByRole("menuitem", { name: "He et al., 2022" }));
    expect(editor.getText()).toBe("As shown[@he2022mae]");
  });

  it("puts the Zotero search first in the More submenu when the note's project is open", async () => {
    layout(0);
    useFilesStore.setState({ projectId: "paper-1" });
    useZoteroLibraryStore.setState({ status: { itemCount: 1, generation: 1, libraries: [] } as unknown as ZoteroLibraryStatus });
    try {
      mount("As shown", [{ key: "he2022mae", label: "He et al., 2022" }], { projectId: "paper-1" });
      const sub = openSub(openMore(), enNotes.toolbar.citation);
      const search = within(sub).getByRole("textbox", { name: enEditor.citations.filterLabel });
      await vi.waitFor(() => expect(search).toHaveFocus());
      expect(await within(sub).findByRole("menuitem", { name: "He et al., 2022" })).toBeInTheDocument();
    } finally {
      useFilesStore.setState({ projectId: null });
      useZoteroLibraryStore.setState({ status: null });
    }
  });

  it("leaves the Citation submenu out of More when there is nothing to cite", () => {
    layout(0);
    mount("As shown");
    expect(within(openMore()).queryByRole("menuitem", { name: enNotes.toolbar.citation })).not.toBeInTheDocument();
  });

  it("sizes and inserts a table from the More submenu", async () => {
    layout(0);
    const { editor, user } = mount("Before");
    const sub = openSub(openMore(), enEditor.toolbar.insertTable);
    expect(within(sub).getAllByRole("menuitem")).toHaveLength(64);
    expect(within(sub).getByText("1 × 1")).toBeInTheDocument();
    const cell = within(sub).getByRole("menuitem", { name: "3 by 2 table" });
    fireEvent.focus(cell);
    expect(within(sub).getByText("3 × 2")).toBeInTheDocument();
    expect(cell).toHaveClass("bg-primary/10");
    expect(within(sub).getByRole("menuitem", { name: "4 by 2 table" })).not.toHaveClass("bg-primary/10");
    await user.click(cell);
    const table = blocks(editor).find((block) => block.type === "table");
    expect(table?.content).toHaveLength(2);
    expect(table?.content?.[0].content).toHaveLength(3);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("links the selection from the More submenu and closes the menu", () => {
    layout(0);
    const { editor } = mount("See the paper");
    select(editor, 9, 14);
    const sub = openSub(openMore(), enNotes.toolbar.link);
    const address = within(sub).getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    expect(address).toHaveFocus();
    fireEvent.change(address, { target: { value: "https://example.org/paper" } });
    fireEvent.keyDown(address, { key: "a" });
    expect(address).toHaveFocus();
    fireEvent.keyDown(address, { key: "ArrowLeft" });
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.keyDown(address, { key: "Enter" });
    expect(markdownOf(editor)).toContain("[paper](https://example.org/paper)");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lets Escape close the menu from the link box", () => {
    layout(0);
    mount("See the paper");
    const sub = openSub(openMore(), enNotes.toolbar.link);
    fireEvent.keyDown(within(sub).getByRole("textbox", { name: enNotes.toolbar.linkAddress }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not move focus when the link submenu itself is focused from inside", () => {
    layout(0);
    mount("See the paper");
    const sub = openSub(openMore(), enNotes.toolbar.link);
    const address = within(sub).getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    act(() => address.blur());
    fireEvent.focus(address);
    expect(address).not.toHaveFocus();
  });

  it("runs the table tools from More while the cursor is in a table", async () => {
    layout(0);
    const { editor, user } = mount("| Run | Ratio |\n| --- | --- |\n| 1 | 0.75 |\n");
    let cellPosition = 0;
    editor.state.doc.descendants((node, position) => {
      if (cellPosition === 0 && node.type.name === "tableCell") cellPosition = position + 2;
    });
    select(editor, cellPosition, cellPosition);
    const rows = () => blocks(editor).find((block) => block.type === "table")?.content ?? [];
    await user.click(within(openMore()).getByRole("menuitem", { name: enNotes.toolbar.addRow }));
    expect(rows()).toHaveLength(3);
    await user.click(within(openMore()).getByRole("menuitem", { name: enNotes.toolbar.addColumn }));
    expect(rows()[0].content).toHaveLength(3);
    await user.click(within(openMore()).getByRole("menuitem", { name: enEditor.tableToolbar.deleteTable }));
    expect(blocks(editor).some((block) => block.type === "table")).toBe(false);
  });

  it("jumps to a heading from the outline submenu", async () => {
    layout(0);
    const { editor, user } = mount("# Overview\n\nText\n\n## Method\n");
    const target = editor.view.dom.querySelector("h2") as HTMLElement;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    const sub = openSub(openMore(), enNotes.toolbar.outline);
    await user.click(within(sub).getByRole("menuitem", { name: "Method" }));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });
});

describe("note width", () => {
  it("picks the width from the bar, shows it with its icon and remembers it", async () => {
    const { user } = mount("One");
    expect(button(enNotes.toolbar.width).querySelector(".lucide-rectangle-vertical")).not.toBeNull();
    let menu = openMenu(enNotes.toolbar.width);
    expect(within(menu).getByText(enNotes.toolbar.width)).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.standard })).toHaveAttribute("aria-checked", "true");
    await user.click(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.wide }));
    expect(useSettingsStore.getState().notesWidth).toBe("wide");
    expect(localStorage.getItem(NOTE_WIDTH_KEY)).toBe("wide");
    expect(button(enNotes.toolbar.width).querySelector(".lucide-rectangle-horizontal")).not.toBeNull();
    menu = openMenu(enNotes.toolbar.width);
    expect(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.wide })).toHaveAttribute("aria-checked", "true");
    await user.click(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.full }));
    expect(button(enNotes.toolbar.width).querySelector(".lucide-move-horizontal")).not.toBeNull();
  });

  it("follows a width picked in another note", () => {
    mount("One");
    act(() => saveNoteWidth("full"));
    expect(button(enNotes.toolbar.width).querySelector(".lucide-move-horizontal")).not.toBeNull();
  });

  it("offers the width in More when the view controls do not fit", async () => {
    layout(0);
    const { user } = mount("One");
    fireEvent.pointerDown(within(screen.getByRole("toolbar")).getByRole("button", { name: enNotes.toolbar.more }), {
      button: 0,
      ctrlKey: false,
    });
    await user.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: enNotes.toolbar.widths.full }));
    expect(useSettingsStore.getState().notesWidth).toBe("full");
  });
});

describe("inserting a notebook", () => {
  type Importer = NonNullable<NotesData["importNotebook"]>;

  function mountNotebooks(importNotebook: Importer, viewId: string | null = "note:n1") {
    const element = document.createElement("div");
    if (viewId) element.setAttribute("data-view", viewId);
    document.body.append(element);
    hosts.push(element);
    const editor = new Editor({ element, extensions: createWysiwygExtensions(), content: parseMarkdownBody("Intro\n\nOutro").doc });
    editors.push(editor);
    const user = userEvent.setup();
    render(
      <NotesDataProvider value={{ ...notesData([], {}), importNotebook }}>
        <NoteToolbar editor={editor} />
      </NotesDataProvider>,
    );
    return { editor, user };
  }

  function notebookBlocks(editor: Editor) {
    return blocks(editor).filter((block) => block.type === "codeBlock" && block.attrs?.language === "notebook");
  }

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("offers no notebook button when notes cannot import files", () => {
    mount("One");
    expect(screen.queryByRole("button", { name: enNotes.toolbar.notebook })).toBeNull();
  });

  it("copies a picked notebook into the note and inserts its block at the cursor", async () => {
    const importNotebook = vi.fn<Importer>(async () => "assets/run-1a2b3c4d.ipynb");
    const { editor, user } = mountNotebooks(importNotebook);
    select(editor, 6, 6);
    await user.click(button(enNotes.toolbar.notebook));
    expect(importNotebook).toHaveBeenCalledWith("n1");
    await vi.waitFor(() => expect(notebookBlocks(editor)).toHaveLength(1));
    expect(blocks(editor).map((block) => block.type)).toEqual(["paragraph", "codeBlock", "paragraph", "paragraph"]);
    expect(editor.state.selection.$head.parent.content.size).toBe(0);
    expect(markdownOf(editor)).toContain("```notebook\nassets/run-1a2b3c4d.ipynb\n```\n\nOutro");
  });

  it("leaves the note alone when the file dialog is closed", async () => {
    const importNotebook = vi.fn<Importer>(async () => null);
    const { editor, user } = mountNotebooks(importNotebook);
    const before = markdownOf(editor);
    await user.click(button(enNotes.toolbar.notebook));
    await vi.waitFor(() => expect(importNotebook).toHaveBeenCalled());
    await Promise.resolve();
    expect(markdownOf(editor)).toBe(before);
  });

  it.each([
    ["an error", new Error("The file is larger than the 64 MiB limit."), "The file is larger than the 64 MiB limit."],
    ["a message", "Pick it again.", "Pick it again."],
  ])("says why the notebook could not be added when the copy fails with %s", async (_case, failure, detail) => {
    const { editor, user } = mountNotebooks(vi.fn<Importer>(() => Promise.reject(failure)));
    await user.click(button(enNotes.toolbar.notebook));
    await vi.waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
        enNotes.notebook.importFailed.replace("{{error}}", detail),
      ]),
    );
    expect(notebookBlocks(editor)).toHaveLength(0);
  });

  it("does nothing outside a note's panel", async () => {
    const importNotebook = vi.fn<Importer>(async () => "assets/run.ipynb");
    const { user } = mountNotebooks(importNotebook, "home:1");
    await user.click(button(enNotes.toolbar.notebook));
    expect(importNotebook).not.toHaveBeenCalled();
  });

  it("drops the block when the note closed while the dialog was open", async () => {
    let finish: (path: string) => void = () => {};
    const importNotebook = vi.fn<Importer>(() => new Promise((resolve) => (finish = resolve)));
    const { editor, user } = mountNotebooks(importNotebook);
    await user.click(button(enNotes.toolbar.notebook));
    editor.destroy();
    finish("assets/run.ipynb");
    await Promise.resolve();
    expect(editor.isDestroyed).toBe(true);
  });

  it("inserts a notebook from More when the bar is narrow", async () => {
    layout(0);
    const importNotebook = vi.fn<Importer>(async () => "assets/run.ipynb");
    const { editor, user } = mountNotebooks(importNotebook);
    fireEvent.pointerDown(within(screen.getByRole("toolbar")).getByRole("button", { name: enNotes.toolbar.more }), {
      button: 0,
      ctrlKey: false,
    });
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: enNotes.toolbar.notebook }));
    await vi.waitFor(() => expect(notebookBlocks(editor)).toHaveLength(1));
  });
});
