// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { createWysiwygExtensions, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { isMac } from "@/lib/utils";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import {
  chooseNoteLink,
  closeNoteLinkMenu,
  createCandidate,
  headingTarget,
  highlightNoteLink,
  insertNoteLink,
  linkCandidates,
  linkedNoteCreator,
  NOTE_LIMIT,
  noteLinkExtensions,
  noteLinkOptionId,
  noteLinkSuggestion,
  parseLinkQuery,
  PROJECT_LIMIT,
  type LinkableNote,
  type LinkableProject,
  type NoteLinkOptions,
} from "./note-links";

const NOTES: LinkableNote[] = [
  { noteId: "n-1", projectId: "lib-1", title: "Masking report", color: "rose", icon: "🧪" },
  { noteId: "n-2", projectId: "lib-2", title: "Abstract draft" },
  { noteId: "n-3", projectId: "lib-3", title: "Reading notes on masking" },
];
const PROJECTS: LinkableProject[] = [
  { projectId: "ssl", title: "SSL masking", color: "#ff0000" },
  { projectId: "thesis", title: "Thesis", color: null },
];

let editors: Editor[] = [];

interface Built {
  editor: Editor;
  options: NoteLinkOptions;
  refresh: () => void;
  unsubscribed: () => boolean;
}

function build(markdown: string, overrides: Partial<NoteLinkOptions> = {}): Built {
  let listener: (() => void) | null = null;
  let stopped = false;
  const options: NoteLinkOptions = {
    getNotes: () => NOTES,
    getProjects: () => PROJECTS,
    onOpenNote: vi.fn(),
    onOpenProject: vi.fn(),
    subscribe: (next) => {
      listener = next;
      return () => {
        stopped = true;
      };
    },
    ...overrides,
  };
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...createWysiwygExtensions(), ...noteLinkExtensions(options)],
    content: parseMarkdownBody(markdown).doc,
  });
  editors.push(editor);
  return { editor, options, refresh: () => listener?.(), unsubscribed: () => stopped };
}

function markdown(editor: Editor): string {
  return serializeMarkdownBody(editor.getJSON());
}

function typeText(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

function cursorAtEnd(editor: Editor) {
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  const plugin = editor.state.plugins.find((candidate) => "menuId" in candidate.spec);
  return plugin?.props.handleKeyDown?.call(plugin, editor.view, event) ?? false;
}

function chips(editor: Editor): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>(".note-link")];
}

function click(editor: Editor, init: MouseEventInit = {}, selector = "a"): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  editor.view.dom.querySelector(selector)?.dispatchEvent(event);
  return event;
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  for (const editor of editors) {
    if (editor.isDestroyed) continue;
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
  editors = [];
});

describe("note link markdown", () => {
  it("keeps note and project links through a parse and a save", () => {
    const body = "See [Masking report](oleafly://note/n-1) and [SSL masking](oleafly://project/ssl).";
    const { editor } = build(body);
    expect(markdown(editor)).toBe(body);
    const anchors = [...editor.view.dom.querySelectorAll("a")];
    expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual(["oleafly://note/n-1", "oleafly://project/ssl"]);
  });

  it("leaves other links alone", () => {
    const body = "Read [the docs](https://example.org) and [a file](notes/a.md).";
    const { editor } = build(body);
    expect(chips(editor)).toEqual([]);
    expect(markdown(editor)).toBe(body);
    expect(editor.commands.setLink({ href: "javascript:alert(1)" })).toBe(false);
  });
});

describe("note link chips", () => {
  it("colours a note link and shows a project dot", () => {
    const { editor } = build("[Masking report](oleafly://note/n-1) [SSL masking](oleafly://project/ssl) [Thesis](oleafly://project/thesis)\n");
    const [note, project, plain] = chips(editor);
    expect(note.dataset.noteLink).toBe("note");
    expect(note.classList.contains("note-link-start")).toBe(true);
    expect(note.getAttribute("style")).toContain("--note-color");
    expect(project.dataset.noteLink).toBe("project");
    expect(project.dataset.projectColor).toBe("#ff0000");
    expect(project.getAttribute("style")).toContain("--note-project: #ff0000");
    expect(plain.dataset.projectColor).toBe("none");
    expect(chips(editor).some((chip) => chip.dataset.missing)).toBe(false);
  });

  it("marks only the first piece of a link that mixes formatting", () => {
    const { editor } = build("[Masking **report**](oleafly://note/n-1)\n");
    const pieces = chips(editor);
    expect(pieces).toHaveLength(2);
    expect(pieces.map((piece) => piece.classList.contains("note-link-start"))).toEqual([true, false]);
  });

  it("mutes a link whose note or project is gone and says so", () => {
    const { editor } = build("[Old](oleafly://note/gone) [Old project](oleafly://project/gone)\n");
    const [note, project] = chips(editor);
    expect(note.dataset.missing).toBe("true");
    expect(note.dataset.tooltip).toBe(enNotes.links.missingNote);
    expect(note.classList.contains("note-link-missing")).toBe(true);
    expect(project.dataset.tooltip).toBe(enNotes.links.missingProject);
  });

  it("does not call a link missing before the lists load, and updates when they do", () => {
    let notes: LinkableNote[] | null = null;
    let projects: LinkableProject[] | null = null;
    const { editor, refresh, unsubscribed } = build("[Masking report](oleafly://note/n-1) [SSL](oleafly://project/ssl)\n", {
      getNotes: () => notes,
      getProjects: () => projects,
    });
    expect(chips(editor).map((chip) => chip.dataset.missing)).toEqual([undefined, undefined]);
    expect(chips(editor)[0].getAttribute("style")).toBeNull();
    notes = [];
    projects = [];
    refresh();
    expect(chips(editor).map((chip) => chip.dataset.missing)).toEqual(["true", "true"]);
    notes = NOTES;
    projects = PROJECTS;
    refresh();
    expect(chips(editor).map((chip) => chip.dataset.missing)).toEqual([undefined, undefined]);
    editor.destroy();
    expect(unsubscribed()).toBe(true);
    refresh();
  });
});

describe("opening links", () => {
  it("opens a note in place, or in a new tab with the platform's selection key", () => {
    const { editor, options } = build("[Masking report](oleafly://note/n-1)\n");
    const event = click(editor);
    expect(event.defaultPrevented).toBe(true);
    expect(options.onOpenNote).toHaveBeenLastCalledWith("n-1", { newTab: false, projectId: "lib-1" });
    click(editor, isMac ? { metaKey: true } : { ctrlKey: true });
    expect(options.onOpenNote).toHaveBeenLastCalledWith("n-1", { newTab: true, projectId: "lib-1" });
    click(editor, isMac ? { ctrlKey: true } : { metaKey: true }, ".note-link");
    expect(options.onOpenNote).toHaveBeenLastCalledWith("n-1", { newTab: false, projectId: "lib-1" });
  });

  it("opens a project, even before the project list is known", () => {
    const known = build("[SSL](oleafly://project/ssl)\n");
    click(known.editor);
    expect(known.options.onOpenProject).toHaveBeenCalledWith("ssl", { newTab: false });
    const unknown = build("[Other](oleafly://project/other)\n", { getProjects: () => null });
    click(unknown.editor);
    expect(unknown.options.onOpenProject).toHaveBeenCalledWith("other", { newTab: false });
  });

  it("does nothing for a missing target but still keeps the browser from following it", () => {
    const { editor, options } = build("[Old](oleafly://note/gone) [Old](oleafly://project/gone)\n");
    expect(click(editor).defaultPrevented).toBe(true);
    expect(click(editor, {}, 'a[href="oleafly://project/gone"]').defaultPrevented).toBe(true);
    expect(options.onOpenNote).not.toHaveBeenCalled();
    expect(options.onOpenProject).not.toHaveBeenCalled();
  });

  it("offers to create the note a typed link names, then links it", async () => {
    const createNote = vi.fn(async (title: string) => ({ noteId: "n-9", projectId: "lib-9", title }));
    const { editor } = build("A\n", { createNote });
    cursorAtEnd(editor);
    typeText(editor, "[[Brand new idea");
    const items = noteLinkSuggestion(editor.state)?.items ?? [];
    expect(items.at(-1)).toEqual({ kind: "create", id: "Brand new idea", title: "Brand new idea" });
    expect(press(editor, "Enter")).toBe(true);
    expect(press(editor, "Enter")).toBe(true);
    await vi.waitFor(() => expect(markdown(editor)).toBe("A[Brand new idea](oleafly://note/n-9) "));
    expect(createNote).toHaveBeenCalledExactlyOnceWith("Brand new idea");
  });

  it("offers no create for a note that already exists, an embed, a heading or an empty name", () => {
    const { editor } = build("A\n", { createNote: vi.fn() });
    cursorAtEnd(editor);
    typeText(editor, "[[masking REPORT");
    expect(noteLinkSuggestion(editor.state)?.items.some((item) => item.kind === "create")).toBe(false);
    const kinds = (text: string) => {
      const next = build("A\n", { createNote: vi.fn() }).editor;
      cursorAtEnd(next);
      typeText(next, text);
      return noteLinkSuggestion(next.state)?.items.map((item) => item.kind) ?? [];
    };
    expect(kinds("![[New")).not.toContain("create");
    expect(kinds("[[New#part")).not.toContain("create");
    expect(kinds("[[")).not.toContain("create");
    const without = build("A\n").editor;
    cursorAtEnd(without);
    typeText(without, "[[Brand new");
    expect(noteLinkSuggestion(without.state)?.items.some((item) => item.kind === "create")).toBe(false);
  });

  it("leaves the text alone when the created note can't be linked", async () => {
    const createNote = vi.fn(async () => null);
    const { editor } = build("A\n", { createNote });
    cursorAtEnd(editor);
    typeText(editor, "[[Lost");
    press(editor, "Enter");
    await vi.waitFor(() => expect(createNote).toHaveBeenCalled());
    await Promise.resolve();
    expect(editor.state.doc.textContent).toBe("A[[Lost");
  });

  it("creates a note for a broken link, points the link at it and opens it", async () => {
    const createNote = vi.fn(async (title: string) => ({ noteId: "n-9", projectId: "lib-9", title }));
    const { editor, options } = build("See [Old idea](oleafly://note/gone) here\n", { createNote });
    expect(chips(editor)[0].dataset.tooltip).toBe(enNotes.links.missingNoteCreate);
    click(editor);
    await vi.waitFor(() => expect(markdown(editor)).toBe("See [Old idea](oleafly://note/n-9) here"));
    expect(createNote).toHaveBeenCalledExactlyOnceWith("Old idea");
    expect(options.onOpenNote).toHaveBeenCalledWith("n-9", { newTab: false, projectId: "lib-9" });
  });

  it("does not create a note from a broken link in a read-only note", () => {
    const createNote = vi.fn();
    const { editor } = build("[Old](oleafly://note/gone)\n", { createNote });
    editor.setEditable(false);
    click(editor);
    expect(createNote).not.toHaveBeenCalled();
  });

  it("offers to create a note from a broken link only while the note can be edited", async () => {
    const { editor } = build("[Old](oleafly://note/gone)\n", { createNote: vi.fn() });
    expect(chips(editor)[0].dataset.tooltip).toBe(enNotes.links.missingNoteCreate);
    editor.setEditable(false);
    await vi.waitFor(() => expect(chips(editor)[0].dataset.tooltip).toBe(enNotes.links.missingNote));
    editor.setEditable(true);
    await vi.waitFor(() => expect(chips(editor)[0].dataset.tooltip).toBe(enNotes.links.missingNoteCreate));
  });

  it("shows the plain missing-note text in a note that opens read-only", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      editable: false,
      extensions: [...createWysiwygExtensions(), ...noteLinkExtensions({ getNotes: () => NOTES, getProjects: () => PROJECTS, onOpenNote: vi.fn(), onOpenProject: vi.fn(), createNote: vi.fn() })],
      content: parseMarkdownBody("[Old](oleafly://note/gone)\n").doc,
    });
    editors.push(editor);
    await vi.waitFor(() => expect(chips(editor)[0].dataset.tooltip).toBe(enNotes.links.missingNote));
  });

  it("creates the linked note through the data layer and reads its link id", async () => {
    const create = vi.fn(async () => "lib-7");
    const load = vi.fn(async () => ({ text: "---\nkind: note\nid: abc-123\ntitle: Plan\n---\n" }));
    await expect(linkedNoteCreator(create, load)("Plan")).resolves.toEqual({ noteId: "abc-123", projectId: "lib-7", title: "Plan" });
    expect(create).toHaveBeenCalledWith("Plan");
    expect(load).toHaveBeenCalledWith("lib-7");
    const failing = vi.fn(async () => {
      throw new Error("disk full");
    });
    await expect(linkedNoteCreator(failing, load)("Plan")).resolves.toBeNull();
  });

  it("ignores other buttons, other links, selections and clicks outside links", () => {
    const { editor, options } = build("[Masking report](oleafly://note/n-1) and [web](https://example.org)\n");
    expect(click(editor, { button: 1 }).defaultPrevented).toBe(false);
    expect(click(editor, {}, 'a[href^="https"]').defaultPrevented).toBe(false);
    expect(click(editor, {}, "p").defaultPrevented).toBe(false);
    editor.view.dom.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 4)));
    expect(click(editor).defaultPrevented).toBe(true);
    expect(options.onOpenNote).not.toHaveBeenCalled();
    const outside = document.createElement("a");
    outside.href = "oleafly://note/n-1";
    document.body.append(outside);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: outside });
    const plugin = editor.state.plugins.find((candidate) => "menuId" in candidate.spec);
    expect(plugin?.props.handleDOMEvents?.click?.call(plugin, editor.view, event as PointerEvent)).toBe(false);
    outside.remove();
  });
});

describe("candidates", () => {
  it("ranks titles that start with the query first and leaves out the current note", () => {
    expect(linkCandidates(NOTES, PROJECTS, "mask", "lib-2").map((item) => item.title)).toEqual([
      "Masking report",
      "Reading notes on masking",
      "SSL masking",
    ]);
    expect(linkCandidates(NOTES, PROJECTS, " ", "lib-1").map((item) => item.id)).toEqual(["n-2", "n-3", "ssl", "thesis"]);
    expect(linkCandidates(NOTES, PROJECTS, "zzz")).toEqual([]);
  });

  it("matches accented titles whether the title or the query is composed or decomposed", () => {
    const decomposed = "E\u0301cole notes";
    const notes: LinkableNote[] = [{ noteId: "n-e", projectId: "lib-e", title: decomposed, aliases: ["Cafe\u0301 plan"] }];
    expect(linkCandidates(notes, [], "\u00c9c").map((item) => item.id)).toEqual(["n-e"]);
    expect(linkCandidates(notes, [], "e\u0301co").map((item) => item.id)).toEqual(["n-e"]);
    const [alias] = linkCandidates(notes, [], "caf\u00e9");
    expect(alias.kind === "note" ? alias.alias : null).toBe("Cafe\u0301 plan");
    expect(headingTarget(notes, "\u00e9cole notes")?.noteId).toBe("n-e");
    expect(createCandidate({ getNotes: () => notes, getProjects: () => [], onOpenNote: vi.fn(), onOpenProject: vi.fn(), createNote: vi.fn() }, parseLinkQuery("\u00c9cole notes"), false)).toBeNull();
  });

  it("limits each group", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ noteId: `n${index}`, projectId: `p${index}`, title: `Note ${index}` }));
    const projects = Array.from({ length: 10 }, (_, index) => ({ projectId: `p${index}`, title: `Project ${index}`, color: null }));
    const items = linkCandidates(many, projects, "");
    expect(items.filter((item) => item.kind === "note")).toHaveLength(NOTE_LIMIT);
    expect(items.filter((item) => item.kind === "project")).toHaveLength(PROJECT_LIMIT);
  });
});

describe("typing [[", () => {
  it("opens a filtered list, moves through it and inserts the chosen link", () => {
    const { editor } = build("See this\n", { currentProjectId: "lib-2" });
    cursorAtEnd(editor);
    typeText(editor, " [[mask");
    const open = noteLinkSuggestion(editor.state);
    expect(open?.query).toBe("mask");
    expect(open?.items.map((item) => item.title)).toEqual(["Masking report", "Reading notes on masking", "SSL masking"]);
    expect(editor.view.dom.getAttribute("aria-controls")).toBe(open?.menuId);
    expect(editor.view.dom.getAttribute("aria-activedescendant")).toBe(noteLinkOptionId(open?.menuId ?? "", 0));

    expect(press(editor, "ArrowDown")).toBe(true);
    expect(press(editor, "ArrowDown")).toBe(true);
    expect(noteLinkSuggestion(editor.state)?.index).toBe(2);
    expect(press(editor, "ArrowDown")).toBe(true);
    expect(noteLinkSuggestion(editor.state)?.index).toBe(0);
    expect(press(editor, "ArrowUp")).toBe(true);
    expect(noteLinkSuggestion(editor.state)?.index).toBe(2);
    expect(press(editor, "ArrowUp")).toBe(true);
    typeText(editor, "i");
    expect(noteLinkSuggestion(editor.state)?.index).toBe(0);
    expect(press(editor, "ArrowDown")).toBe(true);

    expect(press(editor, "Enter")).toBe(true);
    expect(noteLinkSuggestion(editor.state)).toBeNull();
    expect(editor.view.dom.hasAttribute("aria-controls")).toBe(false);
    typeText(editor, "next");
    expect(markdown(editor)).toBe("See this [Reading notes on masking](oleafly://note/n-3) next");
  });

  it("inserts with Tab as a plain link inside formatted text", () => {
    const { editor } = build("**Bold**\n");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    typeText(editor, "[[ssl");
    expect(press(editor, "Tab")).toBe(true);
    expect(markdown(editor)).toBe("**Bo**[SSL masking](oleafly://project/ssl) **ld**");
  });

  it("does not add a second space before existing text", () => {
    const { editor } = build("A b\n");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    typeText(editor, "[[thes");
    expect(chooseNoteLink(editor.view, 0)).toBe(true);
    expect(markdown(editor)).toBe("A[Thesis](oleafly://project/thesis) b");
    expect(editor.state.selection.from).toBe(9);
  });

  it("uses the id when a candidate has no title", () => {
    const { editor } = build("A\n", { getNotes: () => [{ noteId: "n-9", projectId: "lib-9", title: "  " }] });
    cursorAtEnd(editor);
    typeText(editor, "[[");
    expect(press(editor, "Enter")).toBe(true);
    expect(markdown(editor)).toBe("A[n-9](oleafly://note/n-9) ");
  });

  it("works the list out once per editor state, and again when the notes change", () => {
    let notes = NOTES;
    const getNotes = vi.fn(() => notes);
    const { editor } = build("A\n", { getNotes });
    cursorAtEnd(editor);
    typeText(editor, " [[mask");
    const first = noteLinkSuggestion(editor.state);
    expect(noteLinkSuggestion(editor.state)).toBe(first);
    notes = NOTES.slice(0, 1);
    expect(noteLinkSuggestion(editor.state)?.items.filter((item) => item.kind === "note")).toHaveLength(1);
  });

  it("closes with Escape until the trigger is typed again", () => {
    const { editor } = build("A\n");
    cursorAtEnd(editor);
    typeText(editor, " [[ab");
    const outer = vi.fn();
    editor.view.dom.parentElement?.addEventListener("keydown", outer);
    const escapeKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(escapeKey);
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(noteLinkSuggestion(editor.state)).toBeNull();
    typeText(editor, "c");
    expect(noteLinkSuggestion(editor.state)).toBeNull();
    expect(press(editor, "Enter")).toBe(false);
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.delete(from - 5, from));
    expect(noteLinkSuggestion(editor.state)).toBeNull();
    typeText(editor, "[[");
    expect(noteLinkSuggestion(editor.state)?.query).toBe("");
    closeNoteLinkMenu(editor.view);
    expect(noteLinkSuggestion(editor.state)).toBeNull();
  });

  it("shows an empty list that leaves keys alone, except Escape", () => {
    const { editor } = build("A\n");
    cursorAtEnd(editor);
    typeText(editor, "[[zzz");
    const empty = noteLinkSuggestion(editor.state);
    expect(empty?.items).toEqual([]);
    expect(empty?.index).toBe(0);
    expect(editor.view.dom.hasAttribute("aria-activedescendant")).toBe(false);
    expect(press(editor, "ArrowDown")).toBe(false);
    expect(press(editor, "Enter")).toBe(false);
    expect(chooseNoteLink(editor.view, 0)).toBe(false);
    expect(press(editor, "Escape")).toBe(true);
  });

  it("leaves modified keys, Shift+Enter, other keys and IME composition alone", () => {
    const { editor } = build("A\n");
    cursorAtEnd(editor);
    typeText(editor, "[[");
    expect(press(editor, "ArrowDown", { metaKey: true })).toBe(false);
    expect(press(editor, "ArrowDown", { ctrlKey: true })).toBe(false);
    expect(press(editor, "ArrowDown", { altKey: true })).toBe(false);
    expect(press(editor, "a")).toBe(false);
    expect(press(editor, "Enter", { isComposing: true })).toBe(false);
    highlightNoteLink(editor.view, 3);
    expect(noteLinkSuggestion(editor.state)?.index).toBe(3);
  });

  it("does not open in code, with a selection, or after a closed pair", () => {
    const code = build("```\nx\n```\n");
    editor_end(code.editor);
    typeText(code.editor, "[[a");
    expect(noteLinkSuggestion(code.editor.state)).toBeNull();

    const inline = build("Use `x` now\n");
    inline.editor.view.dispatch(inline.editor.state.tr.setSelection(TextSelection.create(inline.editor.state.doc, 6)));
    typeText(inline.editor, "[[a");
    expect(noteLinkSuggestion(inline.editor.state)).toBeNull();

    const plain = build("A\n");
    cursorAtEnd(plain.editor);
    typeText(plain.editor, "[[a]]");
    expect(noteLinkSuggestion(plain.editor.state)).toBeNull();
    typeText(plain.editor, " [[b");
    plain.editor.view.dispatch(plain.editor.state.tr.setSelection(TextSelection.create(plain.editor.state.doc, 1, 3)));
    expect(noteLinkSuggestion(plain.editor.state)).toBeNull();
    expect(press(plain.editor, "Enter")).toBe(false);
  });

  it("lists nothing while the notes and projects are still loading", () => {
    const { editor } = build("A\n", { getNotes: () => null, getProjects: () => null });
    closeNoteLinkMenu(editor.view);
    cursorAtEnd(editor);
    typeText(editor, "[[");
    expect(noteLinkSuggestion(editor.state)?.items).toEqual([]);
  });

  it("refuses to insert without an open list or a link mark", () => {
    const { editor } = build("A\n");
    expect(insertNoteLink(editor.view, { kind: "project", id: "ssl", title: "SSL", color: null })).toBe(false);
    const bare = new Editor({ element: document.createElement("div"), extensions: [...createWysiwygExtensions().filter((extension) => extension.name !== "link"), ...noteLinkExtensions(build("A\n").options)], content: "<p>A</p>" });
    editors.push(bare);
    cursorAtEnd(bare);
    typeText(bare, "[[");
    expect(noteLinkSuggestion(bare.state)).not.toBeNull();
    expect(press(bare, "Enter")).toBe(false);
    expect(noteLinkSuggestion(createPlainState())).toBeNull();
  });
});

function editor_end(editor: Editor) {
  const pos = editor.state.doc.firstChild ? editor.state.doc.firstChild.nodeSize - 1 : 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

function createPlainState() {
  const plain = new Editor({ element: document.createElement("div"), extensions: createWysiwygExtensions(), content: "<p>[[</p>" });
  editors.push(plain);
  return plain.state;
}
