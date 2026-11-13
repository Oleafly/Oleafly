// @vitest-environment jsdom
import type { Editor, JSONContent } from "@tiptap/core";
import type { ZoteroHit, ZoteroLibraryStatus } from "@oleafly/backend-port";
import { NodeSelection } from "@tiptap/pm/state";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { CONTROL_GAP, DROPDOWN_TRIGGER_WIDTH, ICON_BUTTON_WIDTH } from "@/components/ui/toolbar-overflow";
import { NEW_BLOCKS, newChartSource } from "./block-templates";
import { htmlTemplate } from "./html-block";
import { REACT_TEMPLATE } from "./react-block";
import { SVG_TEMPLATE } from "./svg-block";
import { TYPST_TEMPLATE } from "./typst-block";
import { useFilesStore } from "@/store/files";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { useSettingsStore } from "@/store/settings";
import { useZoteroLibraryStore } from "@/store/zotero-library";
import { NoteImageDrop } from "./note-image-drop";
import { NOTE_WIDTH_KEY, saveNoteWidth } from "./note-prefs";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NoteToolbar } from "./NoteToolbar";
import { destroyKbEditors, kbEditor, kbMarkdown, positionOf, pressKey } from "./tests/kb-editor-fixtures";
import type { CitationItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const counter = vi.hoisted(() => vi.fn());
const zotero = vi.hoisted(() => ({ search: vi.fn(), insert: vi.fn() }));

vi.mock("@oleafly/editor/prose", async (importOriginal) => {
  const real = await importOriginal<typeof import("@oleafly/editor/prose")>();
  counter.mockImplementation(real.countedWordStarts);
  return { ...real, countedWordStarts: counter };
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

type Attach = NonNullable<NotesData["attachFile"]>;

const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const TABLE = "| Run | Ratio |\n| --- | --- |\n| 1 | 0.75 |\n";

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
  attach?: Attach;
}

function notesData(citations: readonly CitationItem[], sources: Sources): NotesData {
  return fakeNotesData({
    notes: [{ id: "n1", title: "Note", project: "Paper", relatedProjectId: sources.related, updatedAt: 1, author: "you", summary: "" }],
    citations,
    projectCitations: sources.projectCitations,
  });
}

function mount(markdown: string, citations: readonly CitationItem[] = [], sources: Sources = {}) {
  const drop = NoteImageDrop.configure({ target: () => ({ projectId: "n1", notePath: null }), attach: () => sources.attach });
  const editor = kbEditor(markdown, undefined, [drop]);
  const user = userEvent.setup();
  render(
    <NotesDataProvider value={notesData(citations, sources)}>
      <NoteToolbar editor={editor} noteId="n1" projectId={sources.projectId} readOnly={sources.readOnly} />
    </NotesDataProvider>,
  );
  return { editor, user };
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

function openMenu(name: string) {
  fireEvent.pointerDown(button(name), { button: 0, ctrlKey: false });
  return screen.getAllByRole("menu").at(-1) as HTMLElement;
}

function openMore() {
  return openMenu(enNotes.toolbar.more);
}

function openSub(menu: HTMLElement, name: string) {
  fireEvent.keyDown(within(menu).getByRole("menuitem", { name }), { key: "ArrowRight" });
  return screen.getAllByRole("menu").at(-1) as HTMLElement;
}

function select(editor: Editor, from: number, to: number) {
  act(() => {
    editor.commands.setTextSelection({ from, to });
  });
}

function inCell(editor: Editor, text: string) {
  select(editor, positionOf(editor, text), positionOf(editor, text));
}

function blocks(editor: Editor): JSONContent[] {
  return editor.getJSON().content ?? [];
}

function rows(editor: Editor): JSONContent[] {
  return blocks(editor).find((block) => block.type === "table")?.content ?? [];
}

function heading(level: number): string {
  return enNotes.toolbar.heading.replace("{{level}}", String(level));
}

beforeAll(async () => {
  await loadNamespace("editor");
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
  useNotesPrefsStore.setState({ highlightColor: "yellow" });
});

afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
});

afterEach(() => {
  cleanup();
  destroyKbEditors();
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
    await user.click(button(enEditor.hotkeys.actions.undo));
    expect(kbMarkdown(editor)).toBe("Hello");
    await user.click(button(enEditor.hotkeys.actions.redo));
    expect(kbMarkdown(editor)).toBe("Hello world");
  });

  it("turns the current block into any heading level or text from a menu that holds only those", async () => {
    const { editor } = mount("Results so far");
    expect(within(openMenu(enNotes.toolbar.blockType)).getAllByRole("menuitem").map((entry) => entry.textContent)).toEqual([
      enNotes.toolbar.text,
      ...[1, 2, 3, 4, 5, 6].map(heading),
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    for (const level of [1, 2, 3, 4, 5, 6]) {
      fireEvent.click(within(openMenu(enNotes.toolbar.blockType)).getByRole("menuitem", { name: heading(level) }));
      expect(blocks(editor)[0]).toMatchObject({ type: "heading", attrs: { level } });
    }
    fireEvent.click(within(openMenu(enNotes.toolbar.blockType)).getByRole("menuitem", { name: enNotes.toolbar.text }));
    expect(blocks(editor)[0].type).toBe("paragraph");
  });

  it("turns the current block into a quote or a code block from their own buttons and shows which one is on", async () => {
    const { editor, user } = mount("Results so far");
    const quote = button(enEditor.contextMenu.quote);
    const code = button(enEditor.toolbar.codeBlock);
    const icon = (element: HTMLElement) => element.querySelector("svg")?.getAttribute("class");
    expect(icon(code)).not.toBe(icon(button(enEditor.toolbar.inlineCode)));
    expect([quote, code].map((entry) => entry.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    await user.click(quote);
    expect(blocks(editor)[0].type).toBe("blockquote");
    expect(button(enEditor.contextMenu.quote)).toHaveAttribute("aria-pressed", "true");
    await user.click(button(enEditor.contextMenu.quote));
    expect(blocks(editor)[0].type).toBe("paragraph");
    await user.click(button(enEditor.toolbar.codeBlock));
    expect(blocks(editor)[0].type).toBe("codeBlock");
    expect(button(enEditor.toolbar.codeBlock)).toHaveAttribute("aria-pressed", "true");
    expect(button(enEditor.contextMenu.quote)).toHaveAttribute("aria-pressed", "false");
  });

  it("sets a code block's language from the Code language menu, which shows only in a code block and moves no other button", async () => {
    const { editor } = mount("```\nprint(1)\n```\n\nAfter");
    const labels = () => within(screen.getByRole("toolbar")).getAllByRole("button").map((entry) => entry.getAttribute("aria-label"));
    inCell(editor, "After");
    expect(screen.queryByRole("button", { name: enNotes.toolbar.codeLanguage })).toBeNull();
    const outside = labels();
    inCell(editor, "print");
    const inside = labels();
    expect(inside.filter((name) => name !== enNotes.toolbar.codeLanguage)).toEqual(outside);
    expect(inside[inside.indexOf(enNotes.toolbar.width) - 1]).toBe(enNotes.toolbar.codeLanguage);
    const languages = openMenu(enNotes.toolbar.codeLanguage);
    expect(within(languages).getByRole("menuitemcheckbox", { name: enNotes.toolbar.plainCode })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(languages).getByRole("menuitemcheckbox", { name: "python" }));
    expect(kbMarkdown(editor)).toBe("```python\nprint(1)\n```\n\nAfter");
  });

  it("toggles bullet, numbered and task lists and shows which one is on", async () => {
    const { editor } = mount("First point");
    const pick = (name: string) => fireEvent.click(within(openMenu(enNotes.toolbar.list)).getByRole("menuitemcheckbox", { name: new RegExp(name, "u") }));
    pick(enNotes.toolbar.bulletList);
    expect(blocks(editor)[0].type).toBe("bulletList");
    pick(enEditor.toolbar.numberedList);
    expect(blocks(editor)[0].type).toBe("orderedList");
    pick(enEditor.toolbar.taskList);
    expect(kbMarkdown(editor)).toBe("- [ ] First point");
    expect(within(openMenu(enNotes.toolbar.list)).getByRole("menuitemcheckbox", { name: /Task list/u })).toHaveAttribute("aria-checked", "true");
    act(() => {
      pressKey(editor, "(", { ctrlKey: true, shiftKey: true, keyCode: 57 });
    });
    expect(kbMarkdown(editor)).toBe("First point");
  });

  it.each([
    [enEditor.toolbar.bold, "**mask**"],
    [enEditor.toolbar.italic, "*mask*"],
    [enEditor.toolbar.underline, "<u>mask</u>"],
    [enEditor.toolbar.strikethrough, "~~mask~~"],
    [enEditor.toolbar.inlineCode, "`mask`"],
    [enEditor.toolbar.superscript, "<sup>mask</sup>"],
    [enEditor.toolbar.subscript, "<sub>mask</sub>"],
  ])("applies %s to the selected words and marks the button pressed", async (name, expected) => {
    const { editor, user } = mount("The mask ratio");
    select(editor, 5, 9);
    expect(button(name)).toHaveAttribute("aria-pressed", "false");
    await user.click(button(name));
    expect(kbMarkdown(editor)).toBe(`The ${expected} ratio`);
    select(editor, 6, 6);
    expect(button(name)).toHaveAttribute("aria-pressed", "true");
  });

  it("highlights the selected words in a colour from the Highlight menu, shows it, and clears it", async () => {
    const { editor, user } = mount("The mask ratio");
    const green = new RegExp(`^${enNotes.highlight.colors.green}`);
    select(editor, 5, 9);
    await user.click(button(enEditor.toolbar.highlight));
    expect(screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent?.replace(/\s*(⌘|Ctrl).*$/u, ""))).toEqual(
      Object.values(enNotes.highlight.colors),
    );
    await user.click(screen.getByRole("menuitemcheckbox", { name: green }));
    expect(kbMarkdown(editor)).toBe('The <mark data-color="green">mask</mark> ratio');
    select(editor, 6, 6);
    await user.click(button(enEditor.toolbar.highlight));
    expect(screen.getByRole("menuitemcheckbox", { name: green })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitem", { name: enNotes.highlight.remove }));
    expect(kbMarkdown(editor)).toBe("The mask ratio");
  });

  it("links the selected words when the person presses Enter in the link box", async () => {
    const { editor, user } = mount("See the paper");
    select(editor, 9, 14);
    await user.click(button(enNotes.toolbar.link));
    const address = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    expect(address).toHaveAttribute("placeholder", enNotes.toolbar.linkPlaceholder);
    fireEvent.keyDown(address, { key: "Enter" });
    expect(kbMarkdown(editor)).not.toContain("](");
    fireEvent.change(address, { target: { value: "  https://example.org/paper  " } });
    fireEvent.keyDown(address, { key: "a" });
    expect(kbMarkdown(editor)).not.toContain("](");
    fireEvent.keyDown(address, { key: "Enter" });
    expect(kbMarkdown(editor)).toContain("[paper](https://example.org/paper)");
  });

  it("inserts the address as a link when nothing is selected, and says when the address can't be used", async () => {
    const { editor, user } = mount("See");
    select(editor, 4, 4);
    await user.click(button(enNotes.toolbar.link));
    const address = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    fireEvent.change(address, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(address, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(enNotes.toolbar.linkInvalid);
    expect(address).toHaveAttribute("aria-invalid", "true");
    expect(kbMarkdown(editor)).toBe("See");
    fireEvent.change(address, { target: { value: "https://example.org" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(address, { key: "Enter", keyCode: 229 });
    expect(kbMarkdown(editor)).toBe("See");
    fireEvent.keyDown(address, { key: "Enter" });
    act(() => {
      editor.commands.insertContent(" more");
    });
    expect(kbMarkdown(editor)).toBe("See<https://example.org> more");
  });

  it("shows the current address for a link and removes it with Remove link or an empty Enter", async () => {
    const { editor, user } = mount("See the [paper](https://example.org/paper) and [notes](oleafly://note/n-1) here");
    select(editor, 11, 11);
    await user.click(button(enNotes.toolbar.link));
    expect(screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress })).toHaveValue("https://example.org/paper");
    await user.click(screen.getByRole("button", { name: enEditor.toolbar.removeLink }));
    expect(kbMarkdown(editor)).toBe("See the paper and [notes](oleafly://note/n-1) here");

    inCell(editor, "otes");
    await user.click(button(enNotes.toolbar.link));
    const second = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    expect(second).toHaveValue("oleafly://note/n-1");
    fireEvent.change(second, { target: { value: "   " } });
    fireEvent.keyDown(second, { key: "Enter" });
    expect(kbMarkdown(editor)).not.toContain("](");
  });

  it("offers Remove link only when the cursor is on a link", async () => {
    const { editor, user } = mount("See the paper");
    select(editor, 9, 14);
    await user.click(button(enNotes.toolbar.link));
    expect(screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress })).toHaveValue("");
    expect(screen.queryByRole("button", { name: enEditor.toolbar.removeLink })).toBeNull();
  });

  it("inserts inline and display math", async () => {
    const { editor, user } = mount("Area");
    select(editor, 5, 5);
    await user.click(button(enEditor.contextMenu.inlineMath));
    expect(kbMarkdown(editor)).toBe("Area$x^2$");
    await user.click(button(enNotes.toolbar.displayMath));
    expect(kbMarkdown(editor)).toContain("$$x^2$$");
  });

  it("inserts a citation key picked from the project references", async () => {
    const { editor } = mount("As shown", [
      { key: "he2022mae", label: "He et al., 2022" },
      { key: "dosovitskiy2021", label: "Dosovitskiy et al., 2021" },
    ]);
    select(editor, 9, 9);
    const menu = openMenu(enNotes.toolbar.citation);
    expect(await within(menu).findAllByRole("menuitem")).toHaveLength(2);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "He et al., 2022" }));
    expect(editor.getText()).toBe("As shown[@he2022mae]");
  });

  it("keeps only the view controls for a note that can't be edited", () => {
    mount("One two", [{ key: "he2022mae", label: "He et al., 2022" }], { readOnly: true, attach: vi.fn() });
    const toolbar = screen.getByRole("toolbar");
    for (const name of [
      enEditor.hotkeys.actions.undo,
      enNotes.toolbar.blockType,
      enEditor.contextMenu.quote,
      enEditor.toolbar.codeBlock,
      enNotes.toolbar.list,
      enEditor.toolbar.bold,
      enEditor.toolbar.highlight,
      enNotes.toolbar.citation,
      enNotes.toolbar.attach,
    ]) {
      expect(within(toolbar).queryByRole("button", { name })).toBeNull();
    }
    expect(within(toolbar).getByRole("button", { name: enNotes.toolbar.width })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: enNotes.toolbar.outline })).toBeInTheDocument();
    expect(toolbar).toHaveTextContent("2 words");
  });

  it("floats as formatting only, without undo, the view controls or a Notes vault", async () => {
    const editor = kbEditor("One two");
    render(<NoteToolbar editor={editor} floating />);
    const toolbar = screen.getByRole("toolbar", { name: enNotes.toolbar.label });
    expect(toolbar).toHaveAttribute("data-note-toolbar-floating");
    for (const name of [
      enEditor.hotkeys.actions.undo,
      enEditor.hotkeys.actions.redo,
      enNotes.toolbar.width,
      enNotes.toolbar.outline,
      enNotes.toolbar.citation,
      enNotes.toolbar.attach,
    ]) {
      expect(within(toolbar).queryByRole("button", { name })).toBeNull();
    }
    expect(toolbar).not.toHaveTextContent("2 words");
    select(editor, 1, 4);
    fireEvent.click(within(toolbar).getByRole("button", { name: enEditor.toolbar.bold }));
    expect(kbMarkdown(editor)).toBe("**One** two");
    const names = within(toolbar)
      .getAllByRole("button")
      .map((entry) => entry.getAttribute("aria-label"));
    expect(names.slice(0, 3)).toEqual([enNotes.toolbar.blockType, enEditor.contextMenu.quote, enEditor.toolbar.codeBlock]);
  });

  it("offers no Citation menu when the note has no references to cite", () => {
    mount("As shown", [], { projectCitations: vi.fn() });
    expect(screen.queryByRole("button", { name: enNotes.toolbar.citation })).toBeNull();
  });

  it("lists the references of the note's related project", async () => {
    const projectCitations = vi.fn(async () => [{ key: "he2022mae", label: "He 2022, MAE" }]);
    const { editor, user } = mount("As shown", [], { related: "paper-1", projectCitations });
    select(editor, 9, 9);
    await user.click(await within(openMenu(enNotes.toolbar.citation)).findByRole("menuitem", { name: "He 2022, MAE" }));
    expect(projectCitations).toHaveBeenCalledWith("paper-1");
    expect(editor.getText()).toBe("As shown[@he2022mae]");
  });

  it("says there are no references when the related project has none or can't be read", async () => {
    const projectCitations = vi.fn<NonNullable<NotesData["projectCitations"]>>(async () => []);
    mount("As shown", [], { related: "paper-1", projectCitations });
    const menu = openMenu(enNotes.toolbar.citation);
    expect(await within(menu).findByText(enNotes.toolbar.noCitations)).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem")).toBeNull();
    fireEvent.keyDown(menu, { key: "Escape" });
    projectCitations.mockRejectedValueOnce(new Error("gone"));
    expect(await within(openMenu(enNotes.toolbar.citation)).findByText(enNotes.toolbar.noCitations)).toBeInTheDocument();
  });

  it("inserts a table of the size picked in the grid, with a header row", async () => {
    const { editor, user } = mount("Before");
    await user.click(button(enEditor.table.trigger));
    await user.click(screen.getByRole("button", { name: "2 by 4 table" }));
    expect(rows(editor)).toHaveLength(2);
    expect(rows(editor)[0].content).toHaveLength(4);
    expect(rows(editor)[0].content?.[0].type).toBe("tableHeader");
  });

  it("offers the table tools only while the cursor is in a table, and writes each change as Markdown", async () => {
    const { editor } = mount(`Intro\n\n${TABLE}`);
    const tools = () => openMenu(enEditor.tableToolbar.label);
    const run = (name: string) => fireEvent.click(within(tools()).getByRole("menuitem", { name }));
    expect(screen.queryByRole("button", { name: enEditor.tableToolbar.label })).toBeNull();

    inCell(editor, "0.75");
    run(enEditor.tableToolbar.insertRowAbove);
    run(enEditor.tableToolbar.insertRowBelow);
    expect(rows(editor)).toHaveLength(4);
    run(enEditor.tableToolbar.deleteRow);
    expect(rows(editor)).toHaveLength(3);
    run(enEditor.tableToolbar.insertColumnLeft);
    run(enEditor.tableToolbar.insertColumnRight);
    expect(rows(editor)[0].content).toHaveLength(4);
    run(enEditor.tableToolbar.deleteColumn);
    expect(rows(editor)[0].content).toHaveLength(3);
    fireEvent.click(within(tools()).getByRole("menuitemcheckbox", { name: enEditor.tableToolbar.alignCenter }));
    expect(within(tools()).getByRole("menuitemcheckbox", { name: enEditor.tableToolbar.alignCenter })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(kbMarkdown(editor)).toMatch(/\| :-: \|/u);
    expect(kbMarkdown(editor)).not.toContain("<table");

    run(enEditor.tableToolbar.deleteTable);
    expect(blocks(editor).some((block) => block.type === "table")).toBe(false);
    expect(screen.queryByRole("button", { name: enEditor.tableToolbar.label })).toBeNull();
  });

  it("keeps a table Markdown by offering no row above or row removal on its header row", () => {
    const { editor } = mount(TABLE);
    inCell(editor, "Ratio");
    const menu = openMenu(enEditor.tableToolbar.label);
    expect(within(menu).queryByRole("menuitem", { name: enEditor.tableToolbar.insertRowAbove })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: enEditor.tableToolbar.deleteRow })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: enEditor.tableToolbar.insertRowBelow })).toBeInTheDocument();
  });

  it("inserts a divider, a chart and a Mermaid diagram, leaving the caret on a line after each", async () => {
    const { editor, user } = mount("Figures");
    select(editor, 8, 8);
    await user.click(button(enNotes.blocks.slash.divider));
    await user.click(button(enNotes.toolbar.chart));
    act(() => {
      editor.commands.insertContent("Caption");
    });
    await user.click(button(enNotes.toolbar.mermaid));
    const types = blocks(editor).map((block) => block.type);
    expect(types.slice(0, 4)).toEqual(["paragraph", "horizontalRule", "codeBlock", "paragraph"]);
    const fenced = blocks(editor).filter((block) => block.type === "codeBlock");
    expect(fenced.map((block) => [block.attrs?.language, block.content?.[0].text])).toEqual([
      ["chart", newChartSource()],
      [NEW_BLOCKS.mermaid.info, NEW_BLOCKS.mermaid.source],
    ]);
    expect(blocks(editor)[3]).toEqual({ type: "paragraph", attrs: { blockId: null }, content: [{ type: "text", text: "Caption" }] });
  });

  it("inserts the next footnote at the cursor and moves the cursor to its text at the end of the note", async () => {
    const { editor, user } = mount("Grain size[^1] matters\n\nMore\n\n[^1]: Sieved.");
    const at = positionOf(editor, " matters");
    select(editor, at, at);
    await user.click(button(enEditor.toolbar.insertFootnote));
    act(() => {
      editor.commands.insertContent("From the flume.");
    });
    expect(kbMarkdown(editor)).toBe("Grain size[^1][^2] matters\n\nMore\n\n[^1]: Sieved.\n\n[^2]: From the flume.");
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
    const { editor } = mount("Equations");
    fireEvent.click(within(openMenu(enNotes.blocks.insert.label)).getByRole("menuitem", { name }));
    const inserted = blocks(editor).find((node) => node.type === "codeBlock");
    expect(inserted?.attrs?.language).toBe(block.info);
    expect(inserted?.content?.[0].text).toBe(block.source);
  });

  it("sets the alt text of the selected image", async () => {
    const { editor, user } = mount("Text\n\n![](assets/plot.png)");
    expect(screen.queryByRole("button", { name: enEditor.figureDialog.altLabel })).toBeNull();
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 6)));
    });
    await user.click(button(enEditor.figureDialog.altLabel));
    const field = screen.getByRole("textbox", { name: enEditor.figureDialog.altLabel });
    expect(field).toHaveAttribute("placeholder", enEditor.figureDialog.altPlaceholder);
    fireEvent.change(field, { target: { value: "Loss falls with the mask ratio" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(kbMarkdown(editor)).toBe("Text\n\n![Loss falls with the mask ratio](assets/plot.png)");
  });

  it.each(["assets/memo.m4a", "assets/talk.mp4", "https://youtu.be/dQw4w9WgXcQ"])(
    "offers no alt text or image size for %s, which plays instead of showing a picture",
    (src) => {
      const { editor } = mount(`Text\n\n![](${src})`);
      act(() => {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 6)));
      });
      expect(editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name).toBe("image");
      expect(screen.queryByRole("button", { name: enEditor.figureDialog.altLabel })).toBeNull();
      expect(screen.queryByRole("button", { name: enNotes.toolbar.imageSize })).toBeNull();
    },
  );

  it("keeps alt text and image size for a PDF page, which shows as a picture", () => {
    const { editor } = mount("Text\n\n![](assets/paper.pdf#page=2)");
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 6)));
    });
    expect(button(enEditor.figureDialog.altLabel)).toBeTruthy();
    expect(button(enNotes.toolbar.imageSize)).toBeTruthy();
  });

  it("sizes the selected image from the Image size menu and puts it back to its own size", async () => {
    const { editor, user } = mount("Text\n\n![](assets/plot.png)");
    expect(screen.queryByRole("button", { name: enNotes.toolbar.imageSize })).toBeNull();
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 6)));
    });
    await user.click(button(enNotes.toolbar.imageSize));
    expect(screen.getByRole("menuitemradio", { name: enNotes.toolbar.originalSize })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "50%" }));
    expect(kbMarkdown(editor)).toBe("Text\n\n![](assets/plot.png){width=50%}");
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 6)));
    });
    await user.click(button(enNotes.toolbar.imageSize));
    expect(screen.getByRole("menuitemradio", { name: "50%" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: enNotes.toolbar.originalSize }));
    expect(kbMarkdown(editor)).toBe("Text\n\n![](assets/plot.png)");
  });

  it("lists the headings in the outline and scrolls to the one picked, putting focus back in the note", async () => {
    const { editor, user } = mount("# Overview\n\nText\n\n## Method\n\nMore\n\n### Ablation\n");
    const menu = openMenu(enNotes.toolbar.outline);
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Overview", "Method", "Ablation"]);
    const target = editor.view.dom.querySelector("h2") as HTMLElement;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    await user.click(within(menu).getByRole("menuitem", { name: "Method" }));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(editor.state.selection.$from.parent.textContent).toBe("Method");
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("puts focus back in the note after a width is picked or a menu is closed with Escape", async () => {
    const { editor, user } = mount("Text");
    await user.click(within(openMenu(enNotes.toolbar.width)).getByRole("menuitemradio", { name: enNotes.toolbar.widths.wide }));
    expect(editor.view.hasFocus()).toBe(true);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    openMenu(enNotes.toolbar.outline);
    await user.keyboard("{Escape}");
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("follows the headings while the outline is open, and asks for one when there is none", () => {
    const { editor } = mount("# Overview\n\n> ## Quoted\n\n##\n\n## Method   plan\n");
    const menu = openMenu(enNotes.toolbar.outline);
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Overview", "Method plan"]);
    act(() => {
      editor.commands.setContent("<p>Only text</p>");
    });
    expect(within(menu).queryByRole("menuitem")).toBeNull();
    expect(within(menu).getByText(enNotes.toolbar.emptyOutline)).toBeInTheDocument();
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
    expect(screen.getByText("3 words")).toBeInTheDocument();
    act(() => {
      editor.commands.clearContent();
    });
    expect(screen.getByText("0 words")).toBeInTheDocument();
  });

  it.each([[enEditor.table.trigger], [enNotes.toolbar.link], [enEditor.toolbar.highlight]])(
    "explains the %s button with a tooltip",
    async (label) => {
      const { user } = mount("Text");
      await user.hover(button(label));
      expect((await screen.findByRole("tooltip")).textContent).toBe(label);
    },
  );

  it("hides the word count when the Notes setting turns it off", () => {
    mount("One two");
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
    const { editor, user } = mount("As shown", [], { related: "paper-1", projectCitations: vi.fn(async () => [MAE]) });
    select(editor, 9, 9);
    const menu = openMenu(enNotes.toolbar.citation);
    const search = within(menu).getByRole("textbox", { name: searchLabel });
    await vi.waitFor(() => expect(search).toHaveFocus());
    expect(await within(menu).findByRole("menuitem", { name: MAE.label })).toBeInTheDocument();

    await user.keyboard("mae");
    expect(search).toHaveValue("mae");
    expect(search).toHaveFocus();
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

  it("offers the Zotero search before the project has any references, and from a project note", async () => {
    mount("As shown", [], { related: "paper-1", projectCitations: vi.fn(async () => []) });
    const menu = openMenu(enNotes.toolbar.citation);
    expect(within(menu).getByRole("textbox", { name: searchLabel })).toBeInTheDocument();
    expect(await within(menu).findByText(enNotes.toolbar.noCitations)).toBeInTheDocument();
    cleanup();
    mount("As shown", [MAE], { projectId: "paper-1" });
    const again = openMenu(enNotes.toolbar.citation);
    expect(within(again).getByRole("textbox", { name: searchLabel })).toBeInTheDocument();
    expect(await within(again).findByRole("menuitem", { name: MAE.label })).toBeInTheDocument();
  });

  it("keeps to the note's own references when its project isn't the open one or Zotero has nothing", async () => {
    useFilesStore.setState({ projectId: "another-paper" });
    mount("As shown", [], { related: "paper-1", projectCitations: vi.fn(async () => [MAE]) });
    const menu = openMenu(enNotes.toolbar.citation);
    expect(await within(menu).findByRole("menuitem", { name: MAE.label })).toBeInTheDocument();
    expect(within(menu).queryByRole("textbox")).toBeNull();
    cleanup();
    useFilesStore.setState({ projectId: "paper-1" });
    useZoteroLibraryStore.setState({ status: { itemCount: 0, generation: 1, libraries: [] } as unknown as ZoteroLibraryStatus });
    mount("As shown", [], { related: "paper-1", projectCitations: vi.fn(async () => [MAE]) });
    expect(await within(openMenu(enNotes.toolbar.citation)).findByRole("menuitem", { name: MAE.label })).toBeInTheDocument();
    expect(within(screen.getByRole("menu")).queryByRole("textbox")).toBeNull();
    expect(zotero.search).not.toHaveBeenCalled();
  });
});

describe("NoteToolbar in a narrow panel", () => {
  it("keeps every group on the bar and hides More when there is room", () => {
    mount("One");
    expect(within(screen.getByRole("toolbar")).queryByRole("button", { name: enNotes.toolbar.more })).toBeNull();
    expect(button(enNotes.toolbar.width)).toBeInTheDocument();
    expect(screen.getByText("1 word")).toBeInTheDocument();
  });

  it("moves the groups that do not fit into More, from the right, and keeps undo, redo and the block type", () => {
    layout(390);
    mount("One");
    expect(button(enEditor.hotkeys.actions.undo)).toBeInTheDocument();
    expect(button(enNotes.toolbar.blockType)).toBeInTheDocument();
    expect(button(enEditor.contextMenu.quote)).toBeInTheDocument();
    expect(button(enEditor.toolbar.codeBlock)).toBeInTheDocument();
    expect(button(enNotes.toolbar.list)).toBeInTheDocument();
    expect(button(enEditor.toolbar.highlight)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enEditor.contextMenu.inlineMath })).toBeNull();
    expect(screen.queryByRole("button", { name: enNotes.toolbar.width })).toBeNull();
    expect(screen.queryByText("1 word")).toBeNull();
    const menu = openMore();
    expect(within(menu).getByRole("menuitem", { name: enEditor.contextMenu.inlineMath })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: enNotes.toolbar.chart })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.standard })).toBeInTheDocument();
    expect(within(menu).getByText("1 word")).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /Bold/u })).toBeNull();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: enEditor.contextMenu.quote })).toBeNull();
  });

  it("puts only the word count in More when everything else fits", () => {
    layout(800 + DROPDOWN_TRIGGER_WIDTH + ICON_BUTTON_WIDTH + 2 * CONTROL_GAP);
    mount("One", [{ key: "he2022mae", label: "He et al., 2022" }]);
    expect(button(enNotes.toolbar.width)).toBeInTheDocument();
    expect(screen.queryByText("1 word")).toBeNull();
    expect(within(openMore()).getByText("1 word")).toBeInTheDocument();
  });

  it("lists marks and lists in More with their shortcuts and shows which are on", async () => {
    layout(0);
    const { editor, user } = mount("The mask ratio");
    select(editor, 5, 9);
    let menu = openMore();
    const bold = within(menu).getByRole("menuitemcheckbox", { name: /Bold/u });
    expect(bold).toHaveAttribute("aria-checked", "false");
    expect(bold).toHaveTextContent("Ctrl+B");
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Task list/u })).toHaveTextContent("Ctrl+Shift+9");
    await user.click(bold);
    expect(kbMarkdown(editor)).toBe("The **mask** ratio");
    select(editor, 6, 6);
    menu = openMore();
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Bold/u })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /Numbered list/u }));
    expect(blocks(editor)[0].type).toBe("orderedList");
    const colors = openSub(openMore(), enEditor.toolbar.highlight);
    expect(within(colors).getByRole("menuitemcheckbox", { name: /Yellow/u })).toHaveTextContent("Ctrl+Shift+H");
    expect(within(colors).getByRole("menuitemcheckbox", { name: /Green/u })).not.toHaveTextContent("Ctrl");
  });

  it("turns a block into a quote or a code block and sets its language from More, showing which is on", () => {
    layout(0);
    const { editor } = mount("print(1)");
    let menu = openMore();
    expect(within(menu).queryByRole("menuitem", { name: enNotes.toolbar.codeLanguage })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: enEditor.contextMenu.quote }));
    expect(blocks(editor)[0].type).toBe("blockquote");
    menu = openMore();
    expect(within(menu).getByRole("menuitemcheckbox", { name: enEditor.contextMenu.quote })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: enEditor.contextMenu.quote }));
    fireEvent.click(within(openMore()).getByRole("menuitemcheckbox", { name: enEditor.toolbar.codeBlock }));
    expect(blocks(editor)[0].type).toBe("codeBlock");
    menu = openMore();
    expect(within(menu).getByRole("menuitemcheckbox", { name: enEditor.toolbar.codeBlock })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(openSub(menu, enNotes.toolbar.codeLanguage)).getByRole("menuitemcheckbox", { name: "python" }));
    expect(kbMarkdown(editor)).toBe("```python\nprint(1)\n```");
  });

  it("inserts math, charts, diagrams and raw blocks from More", async () => {
    layout(0);
    const { editor } = mount("Area");
    select(editor, 5, 5);
    fireEvent.click(within(openMore()).getByRole("menuitem", { name: enEditor.contextMenu.inlineMath }));
    fireEvent.click(within(openMore()).getByRole("menuitem", { name: enNotes.toolbar.chart }));
    fireEvent.click(within(openMore()).getByRole("menuitem", { name: enNotes.toolbar.mermaid }));
    for (const name of ["LaTeX", "Typst"]) {
      fireEvent.keyDown(within(openSub(openMore(), enNotes.blocks.insert.label)).getByRole("menuitem", { name }), { key: "Enter" });
    }
    expect(kbMarkdown(editor)).toContain("$x^2$");
    const languages = blocks(editor)
      .filter((block) => block.type === "codeBlock")
      .map((block) => block.attrs?.language);
    expect(languages).toEqual(["chart", NEW_BLOCKS.mermaid.info, NEW_BLOCKS.latex.info, NEW_BLOCKS.typst.info]);
  });

  it("cites from the More submenu, with the Zotero search first when the note's project is open", async () => {
    layout(0);
    useFilesStore.setState({ projectId: "paper-1" });
    useZoteroLibraryStore.setState({ status: { itemCount: 1, generation: 1, libraries: [] } as unknown as ZoteroLibraryStatus });
    try {
      const { editor, user } = mount("As shown", [{ key: "he2022mae", label: "He et al., 2022" }], { projectId: "paper-1" });
      select(editor, 9, 9);
      const sub = openSub(openMore(), enNotes.toolbar.citation);
      await vi.waitFor(() => expect(within(sub).getByRole("textbox", { name: enEditor.citations.filterLabel })).toHaveFocus());
      await user.click(await within(sub).findByRole("menuitem", { name: "He et al., 2022" }));
      expect(editor.getText()).toBe("As shown[@he2022mae]");
    } finally {
      useFilesStore.setState({ projectId: null });
      useZoteroLibraryStore.setState({ status: null });
    }
  });

  it("leaves the Citation submenu out of More when there is nothing to cite", () => {
    layout(0);
    mount("As shown");
    expect(within(openMore()).queryByRole("menuitem", { name: enNotes.toolbar.citation })).toBeNull();
  });

  it("sizes and inserts a table from More and closes the menu", async () => {
    layout(0);
    const { editor, user } = mount("Before");
    fireEvent.click(within(openMore()).getByRole("button", { name: enEditor.table.trigger }));
    await user.click(screen.getByRole("button", { name: "2 by 3 table" }));
    expect(rows(editor)).toHaveLength(2);
    expect(rows(editor)[0].content).toHaveLength(3);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("links the selection from More and closes the menu", async () => {
    layout(0);
    const { editor } = mount("See the paper");
    select(editor, 9, 14);
    fireEvent.click(within(openMore()).getByRole("button", { name: enNotes.toolbar.link }));
    const address = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    fireEvent.change(address, { target: { value: "https://example.org/paper" } });
    fireEvent.keyDown(address, { key: "a" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(address, { key: "Enter" });
    expect(kbMarkdown(editor)).toBe("See the [paper](https://example.org/paper)");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("runs the table tools from More while the cursor is in a table", async () => {
    layout(0);
    const { editor } = mount(TABLE);
    inCell(editor, "0.75");
    fireEvent.click(within(openMore()).getByRole("menuitem", { name: enEditor.tableToolbar.insertRowBelow }));
    expect(rows(editor)).toHaveLength(3);
    fireEvent.click(within(openMore()).getByRole("menuitem", { name: enEditor.tableToolbar.deleteTable }));
    expect(blocks(editor).some((block) => block.type === "table")).toBe(false);
  });

  it("jumps to a heading from the outline submenu", async () => {
    layout(0);
    const { editor } = mount("# Overview\n\nText\n\n## Method\n");
    const target = editor.view.dom.querySelector("h2") as HTMLElement;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    fireEvent.click(within(openSub(openMore(), enNotes.toolbar.outline)).getByRole("menuitem", { name: "Method" }));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });
});

describe("note width", () => {
  it("picks the width from the bar, from More and from another note, and remembers it", async () => {
    mount("One");
    let menu = openMenu(enNotes.toolbar.width);
    expect(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.standard })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.wide }));
    expect(useSettingsStore.getState().notesWidth).toBe("wide");
    expect(localStorage.getItem(NOTE_WIDTH_KEY)).toBe("wide");
    menu = openMenu(enNotes.toolbar.width);
    expect(within(menu).getByRole("menuitemradio", { name: enNotes.toolbar.widths.wide })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(menu, { key: "Escape" });
    act(() => saveNoteWidth("full"));
    expect(within(openMenu(enNotes.toolbar.width)).getByRole("menuitemradio", { name: enNotes.toolbar.widths.full })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    cleanup();
    layout(0);
    mount("One");
    fireEvent.click(within(openMore()).getByRole("menuitemradio", { name: enNotes.toolbar.widths.standard }));
    expect(useSettingsStore.getState().notesWidth).toBe("standard");
  });
});

describe("attaching files", () => {
  it("offers Insert image and Attach file only when the note can take files", () => {
    mount("One");
    expect(screen.queryByRole("button", { name: enNotes.toolbar.attach })).toBeNull();
    expect(screen.queryByRole("button", { name: enEditor.toolbar.insertImage })).toBeNull();
  });

  it.each([
    ["assets/run-1a2b3c4d.ipynb", "```notebook\nassets/run-1a2b3c4d.ipynb\n```"],
    ["assets/panel-1a2b3c4d.xlsx", "```csv\npath: assets/panel-1a2b3c4d.xlsx\n```"],
    ["assets/1abc-1a2b3c4d.pdb", "```molecule\npath: assets/1abc-1a2b3c4d.pdb\n```"],
  ])("copies %s into the note and inserts the block that shows it at the cursor", async (path, fence) => {
    const attach = vi.fn<Attach>(async () => path);
    const { editor, user } = mount("Intro\n\nOutro", [], { attach });
    select(editor, 6, 6);
    await user.click(button(enNotes.toolbar.attach));
    expect(attach).toHaveBeenCalledWith("n1", expect.objectContaining({ title: enNotes.toolbar.attach }));
    await vi.waitFor(() => expect(kbMarkdown(editor)).toContain(`Intro\n\n${fence}\n\n`));
    expect(kbMarkdown(editor)).toMatch(/Outro$/u);
  });

  it("asks for an image only from Insert image, also from More", async () => {
    layout(0);
    const attach = vi.fn<Attach>(async () => "assets/plot-1a2b3c4d.png");
    const { editor } = mount("Intro", [], { attach });
    fireEvent.click(within(openMore()).getByRole("menuitem", { name: enEditor.toolbar.insertImage }));
    expect(attach.mock.calls[0][1].extensions).not.toContain("csv");
    await vi.waitFor(() => expect(kbMarkdown(editor)).toContain("![](assets/plot-1a2b3c4d.png)"));
  });
});
