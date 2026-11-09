// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { isMac } from "@/lib/utils";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NoteLinkMenu } from "./NoteLinkMenu";
import type { NoteHeading } from "./note-link-format";
import {
  canEmbed,
  candidateHref,
  candidateText,
  chooseNoteLink,
  docHeadings,
  headingCandidates,
  headingTarget,
  HEADING_LIMIT,
  linkCandidates,
  noteLinkExtensions,
  noteLinkSuggestion,
  parseLinkQuery,
  scrollViewToHeading,
  type LinkableNote,
  type LinkCandidate,
  type NoteLinkOptions,
} from "./note-links";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";

const NOTES: LinkableNote[] = [
  { noteId: "self", projectId: "lib-0", title: "This note" },
  { noteId: "n-1", projectId: "lib-1", title: "Masking report", aliases: ["MR", "mask study"] },
  { noteId: "n-2", projectId: "lib-2", title: "Abstract draft", color: "rose", icon: "🧪" },
];
const REMOTE: NoteHeading[] = [
  { level: 1, text: "Goals", slug: "goals" },
  { level: 2, text: "Method", slug: "method" },
];

let editors: Editor[] = [];

function build(markdown: string, overrides: Partial<NoteLinkOptions> = {}) {
  const options: NoteLinkOptions = {
    getNotes: () => NOTES,
    getProjects: () => [{ projectId: "proj", title: "Masking project", color: null }],
    getHeadings: () => REMOTE,
    onOpenNote: vi.fn(),
    onOpenProject: vi.fn(),
    currentProjectId: "lib-0",
    ...overrides,
  };
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...noteBaseExtensions(), ...noteLinkExtensions(options)],
    content: parseNoteMarkdown(markdown).doc,
  });
  editors.push(editor);
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => ({ left: 10, top: 10, bottom: 20, right: 0 }));
  return { editor, options };
}

function atEnd(editor: Editor) {
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
}

function type(editor: Editor, text: string) {
  act(() => {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  const plugin = editor.state.plugins.find((candidate) => "menuId" in candidate.spec && "noteLinks" in candidate.spec);
  return plugin?.props.handleKeyDown?.call(plugin, editor.view, event) ?? false;
}

function markdown(editor: Editor): string {
  return serializeNoteMarkdown(editor.getJSON());
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  for (const editor of editors) {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
  editors = [];
});

describe("link queries", () => {
  it("splits a name, a heading and an alias", () => {
    expect(parseLinkQuery("Mask")).toEqual({ name: "Mask", heading: null, alias: null });
    expect(parseLinkQuery("Mask#Meth|shown ")).toEqual({ name: "Mask", heading: "Meth", alias: "shown" });
    expect(parseLinkQuery("#Goals")).toEqual({ name: "", heading: "Goals", alias: null });
    expect(parseLinkQuery("Mask| ")).toEqual({ name: "Mask", heading: null, alias: null });
  });

  it("matches aliases and drops projects for embeds", () => {
    expect(linkCandidates(NOTES, [], "mask stu", "lib-0")).toEqual([
      { kind: "note", id: "n-1", projectId: "lib-1", title: "Masking report", color: undefined, icon: undefined, alias: "mask study" },
    ]);
    expect(linkCandidates(NOTES, [{ projectId: "p", title: "Masks", color: null }], "mask", "lib-0", true).map((item) => item.kind)).toEqual([
      "note",
    ]);
    expect(linkCandidates(NOTES, [], "mr", "lib-0")[0]).toMatchObject({ id: "n-1", alias: "MR" });
  });

  it("finds the note a heading belongs to", () => {
    expect(headingTarget(NOTES, "", "lib-0")?.noteId).toBe("self");
    expect(headingTarget(NOTES, "mr", "lib-0")?.noteId).toBe("n-1");
    expect(headingTarget(NOTES, "abs", "lib-0")?.noteId).toBe("n-2");
    expect(headingTarget(NOTES, "zzz", "lib-0")).toBeNull();
    expect(headingTarget(NOTES, "", "other")).toBeNull();
  });

  it("filters and caps headings", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ level: 2, text: `Part ${index}`, slug: `part-${index}` }));
    expect(headingCandidates(NOTES[1], many, "", false)).toHaveLength(HEADING_LIMIT);
    expect(headingCandidates(NOTES[1], many, "part 1", false).map((item) => (item.kind === "heading" ? item.heading.slug : ""))).toEqual(
      ["part-1", "part-10", "part-11", "part-12", "part-13", "part-14", "part-15", "part-16", "part-17", "part-18", "part-19"],
    );
  });

  it("names and addresses every kind of choice", () => {
    const heading: LinkCandidate = { kind: "heading", id: "n-1", projectId: "lib-1", title: "Masking report", heading: REMOTE[1], self: false };
    expect(candidateHref(heading)).toBe("oleafly://note/n-1#method");
    expect(candidateText(heading, null)).toBe("Masking report > Method");
    expect(candidateText({ ...heading, self: true }, null)).toBe("Method");
    expect(candidateText({ ...heading, title: " " }, null)).toBe("n-1 > Method");
    expect(candidateText(heading, "here")).toBe("here");
    expect(candidateHref({ kind: "project", id: "p", title: "P", color: null })).toBe("oleafly://project/p");
    expect(canEmbed({ kind: "project", id: "p", title: "P", color: null })).toBe(false);
    expect(canEmbed({ ...heading, self: true })).toBe(false);
    expect(canEmbed(heading)).toBe(true);
  });
});

describe("heading links in the editor", () => {
  it("lists this note's headings for [[# and links to one", () => {
    const { editor } = build("# Intro\n\n## Results\n\n## Results\n\nText");
    expect(docHeadings(editor.state.doc).map((heading) => heading.slug)).toEqual(["intro", "results", "results-1"]);
    atEnd(editor);
    type(editor, " [[#res");
    const suggestion = noteLinkSuggestion(editor.state);
    expect(suggestion?.headings).toBe(true);
    expect(suggestion?.items.map((item) => (item.kind === "heading" ? item.heading.slug : item.id))).toEqual(["results", "results-1"]);
    press(editor, "ArrowDown");
    expect(press(editor, "Enter")).toBe(true);
    expect(markdown(editor)).toContain("Text [Results](oleafly://note/self#results-1)");
  });

  it("waits for another note's headings, then links with an alias", () => {
    let ready = false;
    const getHeadings = vi.fn(() => (ready ? REMOTE : null));
    const { editor } = build("A", { getHeadings });
    atEnd(editor);
    type(editor, " [[Abstract#me");
    expect(noteLinkSuggestion(editor.state)).toMatchObject({ loading: true, items: [] });
    ready = true;
    type(editor, "t|see method");
    expect(getHeadings).toHaveBeenCalledWith("lib-2");
    expect(noteLinkSuggestion(editor.state)?.alias).toBe("see method");
    expect(press(editor, "Tab")).toBe(true);
    expect(markdown(editor)).toBe("A [see method](oleafly://note/n-2#method) ");
  });

  it("says when the target is unknown or the index is loading", () => {
    const { editor } = build("A");
    atEnd(editor);
    type(editor, " [[Nothing here#x");
    expect(noteLinkSuggestion(editor.state)).toMatchObject({ loading: false, items: [] });
    const loading = build("A", { getNotes: () => null });
    atEnd(loading.editor);
    type(loading.editor, " [[Abs#x");
    expect(noteLinkSuggestion(loading.editor.state)).toMatchObject({ loading: true, items: [] });
    const none = build("A", { getHeadings: undefined });
    atEnd(none.editor);
    type(none.editor, " [[Abs#x");
    expect(noteLinkSuggestion(none.editor.state)?.loading).toBe(true);
  });

  it("embeds a note from ![[ and from Shift+Enter", () => {
    const { editor } = build("A");
    atEnd(editor);
    type(editor, " ![[Abs");
    expect(noteLinkSuggestion(editor.state)?.embed).toBe(true);
    expect(press(editor, "Enter")).toBe(true);
    expect(markdown(editor)).toBe("A\n\n![Abstract draft](oleafly://note/n-2)");

    const other = build("B");
    atEnd(other.editor);
    type(other.editor, " [[Mask");
    expect(press(other.editor, "Enter", { shiftKey: true })).toBe(true);
    expect(markdown(other.editor)).toBe("B\n\n![Masking report](oleafly://note/n-1)");

    const project = build("C");
    atEnd(project.editor);
    type(project.editor, " [[Masking project");
    expect(chooseNoteLink(project.editor.view, 0, true)).toBe(true);
    expect(markdown(project.editor)).toBe("C [Masking project](oleafly://project/proj) ");
  });

  it("scrolls to a heading in this note and opens other notes at a heading", () => {
    const { editor, options } = build("# Top\n\n## Goal\n\nSee [g](oleafly://note/self#goal) and [m](oleafly://note/n-1#method).");
    const anchors = editor.view.dom.querySelectorAll("a");
    const chips = editor.view.dom.querySelectorAll<HTMLElement>(".note-link");
    expect(chips[0].dataset.noteHeading).toBe("goal");
    expect(chips[1].dataset.noteId).toBe("n-1");
    anchors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(editor.state.selection.$from.parent.textContent).toBe("Goal");
    expect(options.onOpenNote).not.toHaveBeenCalled();
    anchors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...(isMac ? { metaKey: true } : { ctrlKey: true }) }));
    expect(options.onOpenNote).toHaveBeenLastCalledWith("self", { newTab: true, projectId: "lib-0", heading: "goal" });
    anchors[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(options.onOpenNote).toHaveBeenLastCalledWith("n-1", { newTab: false, projectId: "lib-1", heading: "method" });
    expect(scrollViewToHeading(editor.view, "missing")).toBe(false);
  });
});

describe("the link menu", () => {
  it("shows headings, aliases, loading text and an embed button", () => {
    let ready = false;
    const { editor } = build("A", { getHeadings: () => (ready ? REMOTE : null) });
    render(<NoteLinkMenu editor={editor} />);
    atEnd(editor);
    type(editor, " [[mr");
    expect(screen.getByText("MR")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: enNotes.kb.links.embedNamed.replace("{{title}}", "Masking report") }));
    expect(markdown(editor)).toBe("A\n\n![Masking report](oleafly://note/n-1)");

    atEnd(editor);
    type(editor, "[[Abstract#");
    expect(screen.getByText(enNotes.kb.links.loadingHeadings)).toBeTruthy();
    ready = true;
    type(editor, "G");
    expect(screen.getByText("Abstract draft")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Goals" })).toBeTruthy();
    type(editor, "zz");
    expect(screen.getByText(enNotes.kb.links.noHeadings)).toBeTruthy();
  });

  it("titles this note's headings and the embed list", () => {
    const { editor } = build("# Here\n\nA");
    render(<NoteLinkMenu editor={editor} />);
    atEnd(editor);
    type(editor, " [[#");
    expect(screen.getByText(enNotes.kb.links.thisNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Embed/u })).toBeNull();
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    type(editor, " ![[");
    expect(screen.getByText(enNotes.kb.links.embedHeading)).toBeTruthy();
  });
});
