// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: log.logError,
}));

import type { NoteLinkRecord, NoteSearchHit } from "@/lib/tauri";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { useToastStore } from "@/store/toast";
import { NoteBacklinks } from "./NoteBacklinks";
import { NoteMentions } from "./NoteMentions";
import { NotePanelSections } from "./NoteListItem";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NoteLinkIndexProvider } from "./use-note-links";
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
  return fakeNotesData({
    notes: NOTES,
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
  });
}

function renderMentions(value = data(), noteId: string | null = "n-1") {
  const onOpenNote = vi.fn();
  const view = render(
    <NotesDataProvider value={value}>
      <NoteLinkIndexProvider>
        <NoteMentions noteId={noteId} onOpenNote={onOpenNote} />
      </NoteLinkIndexProvider>
    </NotesDataProvider>,
  );
  return { ...view, onOpenNote, value };
}

afterEach(() => {
  useToastStore.setState({ toasts: [] });
  useNotesPrefsStore.getState().set("mentionsOpen", true);
  log.logError.mockClear();
});

function messages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

function header(count?: number): HTMLElement {
  return screen.getByRole("button", { name: count === undefined ? copy.title : `${copy.title} ${count}` });
}

describe("NoteMentions", () => {
  it("lists notes that mention the title or an alias without linking here", async () => {
    const { value, onOpenNote, container } = renderMentions();
    await screen.findByRole("region", { name: copy.title });
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
    await waitFor(() => expect(log.logError).toHaveBeenCalledWith("query", expect.any(Error)));
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

describe("NoteMentions folding", () => {
  it("shows the count in the header and folds and opens from it by click, Enter or Space", async () => {
    const user = userEvent.setup();
    renderMentions();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    const toggle = header(2);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(list?.tagName).toBe("UL");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(list).not.toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("region", { name: copy.title })).toBeInTheDocument();
    expect(header(2)).toBe(toggle);
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("remembers the folded choice for the next note it shows", async () => {
    const first = renderMentions();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    fireEvent.click(header(2));
    expect(useNotesPrefsStore.getState().mentionsOpen).toBe(false);
    first.unmount();
    const next = renderMentions(data(), "n-2");
    expect(await screen.findByRole("region", { name: copy.title })).toBeInTheDocument();
    expect(header()).toHaveAttribute("aria-expanded", "false");
    await act(async () => {});
    expect(next.value.searchNotes).not.toHaveBeenCalled();
  });

  it("doesn't search while folded and searches once opened", async () => {
    useNotesPrefsStore.getState().set("mentionsOpen", false);
    const { value } = renderMentions();
    const toggle = await screen.findByRole("button", { name: copy.title });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await act(async () => {});
    expect(value.searchNotes).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(useNotesPrefsStore.getState().mentionsOpen).toBe(true);
    await waitFor(() => expect(value.searchNotes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(header(2)).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the header with a zero count when opening finds nothing", async () => {
    useNotesPrefsStore.getState().set("mentionsOpen", false);
    const searchNotes = vi.fn(async () => []);
    renderMentions(data({ searchNotes }));
    fireEvent.click(await screen.findByRole("button", { name: copy.title }));
    await waitFor(() => expect(header(0)).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByRole("region", { name: copy.title })).toHaveAttribute("aria-busy", "false");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("stays hidden when it is open and nothing mentions the note", async () => {
    const searchNotes = vi.fn(async () => []);
    renderMentions(data({ searchNotes }));
    await waitFor(() => expect(searchNotes).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("region", { name: copy.title })).not.toBeInTheDocument();
  });

  it("shows no folded header for a note it can't search", async () => {
    useNotesPrefsStore.getState().set("mentionsOpen", false);
    renderMentions(data({ searchNotes: undefined }));
    await act(async () => {});
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("stays in the info panel when nothing mentions the note, with a zero count and a short line", async () => {
    const searchNotes = vi.fn(async () => []);
    render(
      <NotesDataProvider value={data({ searchNotes })}>
        <NoteLinkIndexProvider>
          <NotePanelSections>
            <NoteMentions noteId="n-1" onOpenNote={vi.fn()} />
          </NotePanelSections>
        </NoteLinkIndexProvider>
      </NotesDataProvider>,
    );
    const section = await screen.findByRole("region", { name: copy.title });
    await waitFor(() => expect(header(0)).toBeInTheDocument());
    expect(section).toHaveTextContent(enNotes.info.noMentions);
  });
});

describe("NoteBacklinks with mentions", () => {
  it("searches only once the section nears the screen, and not again for a new vault revision", async () => {
    let show: (visible: boolean) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
          show = (visible) => {
            const target = document.querySelector("[aria-hidden]");
            if (target) callback([{ target, isIntersecting: visible }]);
          };
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const value = data({ revision: 1 });
    const view = renderMentions(value);
    await waitFor(() => expect(document.querySelector("[aria-hidden]")).not.toBeNull());
    expect(value.searchNotes).not.toHaveBeenCalled();
    act(() => show(true));
    await screen.findByRole("region", { name: copy.title });
    const calls = vi.mocked(value.searchNotes ?? vi.fn()).mock.calls.length;
    view.rerender(
      <NotesDataProvider value={{ ...value, revision: 2 }}>
        <NoteLinkIndexProvider>
          <NoteMentions noteId="n-1" onOpenNote={vi.fn()} />
        </NoteLinkIndexProvider>
      </NotesDataProvider>,
    );
    await act(async () => {});
    expect(value.searchNotes).toHaveBeenCalledTimes(calls);
    vi.unstubAllGlobals();
  });

  it("renders mentions below the backlinks and alone when nothing links here", async () => {
    const value = data();
    const { unmount } = render(
      <NotesDataProvider value={value}>
        <NoteLinkIndexProvider>
          <NoteBacklinks noteId="n-1" onOpenNote={vi.fn()} />
        </NoteLinkIndexProvider>
      </NotesDataProvider>,
    );
    const linked = await screen.findByRole("region", { name: enNotes.links.linkedFrom });
    const mentions = await screen.findByRole("region", { name: copy.title });
    expect(linked.compareDocumentPosition(mentions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(
      <NotesDataProvider value={data({ noteLinks: () => Promise.resolve(RECORDS.slice(0, 3)) })}>
        <NoteLinkIndexProvider>
          <NoteBacklinks noteId="n-1" onOpenNote={vi.fn()} />
        </NoteLinkIndexProvider>
      </NotesDataProvider>,
    );
    await screen.findByRole("region", { name: copy.title });
    expect(screen.queryByRole("region", { name: enNotes.links.linkedFrom })).not.toBeInTheDocument();
  });
});
