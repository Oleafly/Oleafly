// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: log.logError,
}));

import type { NoteLinkRecord, NoteSearchHit } from "@/lib/tauri";
import { useToastStore } from "@/store/toast";
import { NoteBacklinks } from "./NoteBacklinks";
import { NoteMentions } from "./NoteMentions";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const copy = enNotes.vault.mentions;

const NOTES: NoteItem[] = [
  { id: "lib-1", title: "Masking", project: "SSL", updatedAt: 0, author: "you", summary: "", aliases: ["MAE", "MAE", "x"] },
  { id: "lib-2", title: "Abstract draft", project: "SSL", updatedAt: 0, author: "you", summary: "", icon: "🧪" },
  { id: "lib-3", title: "Reading notes", project: "SSL", updatedAt: 0, author: "you", summary: "" },
  { id: "lib-4", title: "Linked already", project: "SSL", updatedAt: 0, author: "you", summary: "" },
];

const RECORDS: NoteLinkRecord[] = [
  { projectId: "lib-1", noteId: "n-1", title: "Masking", links: [] },
  { projectId: "lib-2", noteId: "n-2", title: "Abstract draft", links: [] },
  { projectId: "lib-3", noteId: null, title: "Reading notes", links: [] },
  { projectId: "lib-4", noteId: "n-4", title: "Linked already", links: [{ kind: "note", id: "n-1", snippet: "See it." }] },
];

function hit(id: string, title: string, snippet?: string): NoteSearchHit {
  return {
    id,
    noteId: id === "lib-2" ? "n-2" : null,
    title,
    titleRanges: [],
    score: 1,
    snippets: snippet ? [{ text: snippet, ranges: [[4, 11]] }] : [],
    tags: [],
    aliases: [],
    relatedProject: null,
    updatedAt: 0,
  };
}

function data(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes: NOTES,
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(async () => ({ text: "We ran masking twice.", version: "v1" })),
    saveNote: vi.fn(async (_id: string, text: string) => ({ text, version: "v2" })),
    noteLinks: () => Promise.resolve(RECORDS),
    searchNotes: vi.fn(async (query: string) =>
      query === '"Masking"'
        ? [
            hit("lib-1", "Masking", "Our masking ratio"),
            hit("lib-2", "Abstract draft", "Our masking ratio"),
            hit("lib-4", "Linked already", "Our masking ratio"),
            hit("gone", "Gone", "Our masking ratio"),
          ]
        : [hit("lib-2", "Abstract draft", "Like the MAE paper"), hit("lib-3", "Reading notes", "Notes on MAE")],
    ),
    ...overrides,
  };
}

function renderMentions(value = data(), noteId: string | null = "n-1") {
  const onOpenNote = vi.fn();
  const view = render(
    <NotesDataProvider value={value}>
      <NoteMentions noteId={noteId} onOpenNote={onOpenNote} className="extra" />
    </NotesDataProvider>,
  );
  return { ...view, onOpenNote, value };
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  useToastStore.setState({ toasts: [] });
  log.logError.mockClear();
});

function messages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

describe("NoteMentions", () => {
  it("lists notes that mention the title or an alias without linking here", async () => {
    const { value, onOpenNote, container } = renderMentions();
    const section = await screen.findByRole("region", { name: copy.title });
    expect(section.className).toContain("extra");
    expect(value.searchNotes).toHaveBeenCalledWith('"Masking"', 20);
    expect(value.searchNotes).toHaveBeenCalledWith('"MAE"', 20);
    expect(value.searchNotes).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.queryByText("Linked already")).not.toBeInTheDocument();
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
    expect(container.querySelector("mark")?.textContent).toBe("masking");
    fireEvent.click(screen.getByText("Abstract draft"));
    expect(onOpenNote).toHaveBeenCalledWith("n-2", { newTab: false, projectId: "lib-2" });
    fireEvent.click(screen.getByText("Reading notes"), { ctrlKey: true });
    expect(onOpenNote).toHaveBeenCalledWith(null, { newTab: true, projectId: "lib-3" });
  });

  it("leaves out notes that match only by their title, like two notes both called Untitled", async () => {
    const searchNotes = vi.fn(async () => [
      hit("lib-2", "Abstract draft"),
      { ...hit("lib-3", "Reading notes"), snippets: [{ text: "First line of the note", ranges: [] }] },
      hit("lib-5", "Draft two", "Our masking ratio"),
    ]);
    renderMentions(data({ searchNotes, notes: [...NOTES, { ...NOTES[1], id: "lib-5", title: "Draft two" }] }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("Draft two")).toBeInTheDocument();
    expect(screen.queryByText("Abstract draft")).not.toBeInTheDocument();
    expect(screen.queryByText("Reading notes")).not.toBeInTheDocument();
  });

  it("shows the snippet that holds the mention, not the note's first line", async () => {
    const searchNotes = vi.fn(async () => [
      {
        ...hit("lib-2", "Abstract draft"),
        snippets: [
          { text: "Opening line", ranges: [] },
          { text: "Our masking ratio", ranges: [[4, 11]] as [number, number][] },
        ],
      },
    ]);
    const { container } = renderMentions(data({ searchNotes }));
    await waitFor(() => expect(container.querySelector("mark")?.textContent).toBe("masking"));
    expect(screen.queryByText("Opening line")).not.toBeInTheDocument();
  });

  it("links the first mention through the other note's save path", async () => {
    const { value } = renderMentions();
    const button = await screen.findByRole("button", { name: copy.linkLabel.replace("{{title}}", "Abstract draft") });
    fireEvent.click(button);
    await waitFor(() =>
      expect(value.saveNote).toHaveBeenCalledWith("lib-2", "We ran [masking](oleafly://note/n-1) twice.", "v1"),
    );
    await waitFor(() => expect(messages()).toContain(copy.linked.replace("{{title}}", "Abstract draft")));
    expect(screen.queryByText("Abstract draft")).not.toBeInTheDocument();
  });

  it("says when the mention can no longer be linked", async () => {
    const { value } = renderMentions(data({ loadNote: vi.fn(async () => ({ text: "Nothing here.", version: "v" })) }));
    fireEvent.click(await screen.findByRole("button", { name: copy.linkLabel.replace("{{title}}", "Reading notes") }));
    await waitFor(() => expect(messages()).toContain(copy.notFound.replace("{{title}}", "Reading notes")));
    expect(value.saveNote).not.toHaveBeenCalled();
  });

  it("reports a failed save", async () => {
    renderMentions(data({ saveNote: vi.fn(async () => Promise.reject(new Error("conflict"))) }));
    fireEvent.click(await screen.findByRole("button", { name: copy.linkLabel.replace("{{title}}", "Abstract draft") }));
    await waitFor(() => expect(messages()).toContain(copy.failed.replace("{{title}}", "Abstract draft")));
  });

  it("logs a failed search instead of showing a toast", async () => {
    renderMentions(data({ searchNotes: vi.fn(async () => Promise.reject(new Error("boom"))) }));
    await waitFor(() => expect(log.logError).toHaveBeenCalledWith("find note mentions", expect.any(Error)));
    expect(messages()).toEqual([]);
  });

  it("shows nothing without a search, a linkable id or a known note", async () => {
    const { unmount } = renderMentions(data({ searchNotes: undefined }));
    await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
    unmount();
    const empty = renderMentions(data(), null);
    expect(empty.value.searchNotes).not.toHaveBeenCalled();
    empty.unmount();
    const unknown = renderMentions(data(), "n-404");
    await waitFor(() => expect(unknown.value.searchNotes).not.toHaveBeenCalled());
  });

  it("ignores answers that arrive after unmount", async () => {
    let finish: (hits: NoteSearchHit[]) => void = () => {};
    const searchNotes = vi.fn(() => new Promise<readonly NoteSearchHit[]>((resolve) => (finish = resolve)));
    const { unmount } = renderMentions(data({ searchNotes, notes: NOTES.map((note) => ({ ...note, aliases: [] })) }));
    await waitFor(() => expect(searchNotes).toHaveBeenCalled());
    unmount();
    finish([hit("lib-2", "Abstract draft", "Our masking ratio")]);
    await Promise.resolve();
    expect(screen.queryByText("Abstract draft")).not.toBeInTheDocument();
  });
});

describe("NoteBacklinks with mentions", () => {
  it("renders mentions below the backlinks and alone when nothing links here", async () => {
    const value = data();
    const { unmount } = render(
      <NotesDataProvider value={value}>
        <NoteBacklinks noteId="n-1" onOpenNote={vi.fn()} className="first" />
      </NotesDataProvider>,
    );
    const linked = await screen.findByRole("region", { name: enNotes.links.linkedFrom });
    const mentions = await screen.findByRole("region", { name: copy.title });
    expect(linked.compareDocumentPosition(mentions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mentions.className).toContain("mt-6");
    unmount();
    render(
      <NotesDataProvider value={data({ noteLinks: () => Promise.resolve(RECORDS.slice(0, 3)) })}>
        <NoteBacklinks noteId="n-1" onOpenNote={vi.fn()} className="first" />
      </NotesDataProvider>,
    );
    const alone = await screen.findByRole("region", { name: copy.title });
    expect(alone.className).toContain("first");
    expect(screen.queryByRole("region", { name: enNotes.links.linkedFrom })).not.toBeInTheDocument();
  });
});
