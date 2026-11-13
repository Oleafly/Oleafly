// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteLinkRecord } from "@/lib/tauri";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { NoteDocument } from "./NoteDocument";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NoteLinkIndexProvider } from "./use-note-links";
import type { NoteItem, NoteSource } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const editors = vi.hoisted(() => ({ last: null as Editor | null }));
const files = vi.hoisted(() => ({
  list: vi.fn(async () => [
    { path: "assets/plot.png", is_dir: false },
    { path: "assets/run.csv", is_dir: false },
    { path: "notes.md", is_dir: false },
  ]),
  sizes: vi.fn(async () => ({ "assets/plot.png": 2048, "assets/run.csv": 100 })),
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      editors.last = editor;
      return editor;
    },
  };
});

vi.mock("./NoteAssistant", async () => {
  const { forwardRef } = await import("react");
  return {
    NoteAssistant: forwardRef(function NoteAssistant(props: { review: ReactNode }, _ref) {
      return <section data-testid="note-assistant">{props.review}</section>;
    }),
  };
});

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listNoteTags: () => Promise.resolve([]),
  listFiles: files.list,
  projectFileSizes: files.sizes,
}));

const TEXT = [
  "---",
  "title: Masking",
  "kind: note",
  "id: n-1",
  "status: draft",
  "---",
  "",
  "Results are in ![plot](assets/plot.png) and [Gone](oleafly://note/n-gone).",
  "",
].join("\n");

const NOTE: NoteItem = { id: "lib-1", title: "Masking", project: "Vision", updatedAt: 1, author: "you", summary: "" };
const OTHER: NoteItem = { id: "lib-2", title: "Method", project: "Vision", updatedAt: 1, author: "you", summary: "" };
const RECORDS: NoteLinkRecord[] = [
  { projectId: "lib-1", noteId: "n-1", title: "Masking", links: [{ kind: "note", id: "n-gone", snippet: "Results are in", line: 8 }] },
  { projectId: "lib-2", noteId: "n-2", title: "Method", links: [{ kind: "note", id: "n-1", snippet: "See Masking." }] },
];

function fakeData() {
  const saveNote = vi.fn(async (_id: string, text: string): Promise<NoteSource> => ({ text, version: "v2" }));
  const data: NotesData = fakeNotesData({
    notes: [NOTE, OTHER],
    loadNote: vi.fn(async (id: string) => ({ text: id === "lib-1" ? TEXT : "# Method\nSee Masking.", version: "v1" })),
    saveNote,
    noteLinks: () => Promise.resolve(RECORDS),
  });
  return { data, saveNote };
}

async function open(infoPanel?: HTMLElement | null) {
  const fake = fakeData();
  const onOpenNote = vi.fn();
  const view = render(
    <NotesDataProvider value={fake.data}>
      <NoteLinkIndexProvider>
        <NoteDocument note={NOTE} insertRequest={null} onOpenNote={onOpenNote} infoPanel={infoPanel} />
      </NoteLinkIndexProvider>
    </NotesDataProvider>,
  );
  await screen.findByLabelText(enNotes.document.titleLabel);
  return { ...view, editor: editors.last as Editor, fake, onOpenNote };
}

function article(): HTMLElement {
  return document.querySelector("article") as HTMLElement;
}

async function save() {
  await act(async () => {
    fireEvent.blur(window);
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const initialPrefs = useNotesPrefsStore.getState();

afterEach(() => {
  useNotesPrefsStore.setState(initialPrefs, true);
  editors.last = null;
  for (const element of document.querySelectorAll("[data-info-target]")) element.remove();
});

function target(): HTMLElement {
  const element = document.createElement("div");
  element.dataset.infoTarget = "";
  document.body.append(element);
  return element;
}

describe("note info in a note", () => {
  it("keeps properties under the title and the link lists at the end when there is no side panel", async () => {
    await open();
    expect(within(article()).getByRole("region", { name: enNotes.kb.properties.title })).toBeInTheDocument();
    expect(within(article()).getByRole("textbox", { name: "Value of status" })).toHaveValue("draft");
    expect(await within(article()).findByRole("region", { name: enNotes.links.linkedFrom })).toHaveTextContent("Method");
    expect(document.querySelector("[data-note-info]")).toBeNull();
  });

  it("ends the note with its text when the info panel is closed", async () => {
    await open(null);
    await act(async () => {});
    expect(screen.queryByRole("region", { name: enNotes.kb.properties.title })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Value of status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: enNotes.links.linkedFrom })).not.toBeInTheDocument();
    expect(document.querySelector("[data-note-info]")).toBeNull();
  });

  it("moves properties, links, dead links and attachments into the info panel", async () => {
    const panel = target();
    const { editor, fake, onOpenNote } = await open(panel);
    expect(within(article()).queryByRole("textbox", { name: "Value of status" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Masking" })).toBeInTheDocument();
    const regions = () =>
      within(panel)
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label") ?? region.querySelector("h2 [id]")?.textContent);
    await waitFor(() => expect(within(panel).getByRole("button", { name: `${enNotes.linksSearch.dead.title} 1` })).toBeInTheDocument());
    expect(regions()).toEqual([
      enNotes.kb.properties.title,
      enNotes.links.linkedFrom,
      enNotes.citations.references,
      enNotes.linksSearch.dead.title,
      enNotes.attachments.list,
    ]);
    expect(within(panel).getByRole("button", { name: `${enNotes.citations.references} 0` })).toBeInTheDocument();
    expect(within(panel).getByText(enNotes.info.noReferences)).toBeInTheDocument();
    expect(within(panel).getByRole("region", { name: enNotes.links.linkedFrom })).toHaveTextContent("Method");

    const attachments = within(panel).getByRole("region", { name: enNotes.attachments.list });
    await waitFor(() => expect(within(attachments).getByRole("button", { name: "plot.png" })).toBeInTheDocument());
    expect(within(attachments).getByRole("button", { name: "run.csv" })).toBeInTheDocument();
    expect(within(attachments).getByText(enNotes.attachments.unused)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: `${enNotes.attachments.list} 2` })).toBeInTheDocument();
    fireEvent.click(within(attachments).getByRole("button", { name: "plot.png" }));
    expect(onOpenNote).toHaveBeenCalledWith("lib-1", { newTab: false });

    const dead = within(panel).getByRole("region", { name: enNotes.linksSearch.dead.title });
    expect(dead).toHaveTextContent("Line 8: the note no longer exists");
    fireEvent.click(within(dead).getByRole("button", { name: /Line 8/u }));
    expect(onOpenNote).toHaveBeenLastCalledWith("lib-1", { newTab: false, heading: expect.stringContaining("Results") });

    const words = () => panel.querySelector('[data-note-stat="words"] dd')?.textContent;
    const before = Number(words());
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " two more");
    });
    expect(Number(words())).toBe(before + 2);

    const status = within(panel).getByRole("textbox", { name: "Value of status" });
    fireEvent.change(status, { target: { value: "final" } });
    fireEvent.blur(status);
    await save();
    expect(fake.saveNote.mock.calls.at(-1)?.[1]).toContain("status: final");
  });

  it("keeps the info panel busy while the note loads", async () => {
    const panel = target();
    let finish: (source: NoteSource) => void = () => {};
    const data = fakeNotesData({
      notes: [NOTE],
      loadNote: () =>
        new Promise<NoteSource>((resolve) => {
          finish = resolve;
        }),
    });
    render(
      <NotesDataProvider value={data}>
        <NoteLinkIndexProvider>
          <NoteDocument note={NOTE} insertRequest={null} infoPanel={panel} />
        </NoteLinkIndexProvider>
      </NotesDataProvider>,
    );
    expect(panel.querySelector("svg.animate-spin")).not.toBeNull();
    expect(panel.querySelector("[data-note-info]")).toBeNull();
    await act(async () => finish({ text: TEXT, version: "v1" }));
    expect(await within(panel).findByRole("heading", { name: "Masking" })).toBeInTheDocument();
    expect(panel.querySelector("svg.animate-spin")).toBeNull();
  });

  it("folds each panel section and remembers it", async () => {
    const panel = target();
    await open(panel);
    const linked = await within(panel).findByRole("button", { name: `${enNotes.links.linkedFrom} 1` });
    fireEvent.click(linked);
    expect(useNotesPrefsStore.getState().backlinksOpen).toBe(false);
    expect(linked).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(panel).getByRole("button", { name: `${enNotes.kb.properties.title} 1` }));
    expect(useNotesPrefsStore.getState().propertiesOpen).toBe(false);
    await waitFor(() => expect(within(panel).getByRole("button", { name: `${enNotes.linksSearch.dead.title} 1` })).toBeInTheDocument());
    fireEvent.click(within(panel).getByRole("button", { name: `${enNotes.linksSearch.dead.title} 1` }));
    expect(useNotesPrefsStore.getState().deadLinksOpen).toBe(false);
    const attachments = within(panel).getByRole("button", { name: new RegExp(`^${enNotes.attachments.list}`, "u") });
    fireEvent.click(attachments);
    expect(useNotesPrefsStore.getState().attachmentsOpen).toBe(false);
    expect(attachments).toHaveAttribute("aria-expanded", "false");
  });
});
