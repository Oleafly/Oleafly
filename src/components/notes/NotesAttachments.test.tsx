// @vitest-environment jsdom
import type { FileEntry } from "@oleafly/backend-port";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { appQueryClient } from "@/lib/query";
import { useToastStore } from "@/store/toast";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const tauri = vi.hoisted(() => ({
  listFiles: vi.fn<(projectId: string) => Promise<FileEntry[]>>(),
  projectFileSizes: vi.fn<(projectId: string, paths: readonly string[]) => Promise<Record<string, number>>>(),
}));
const reveal = vi.hoisted(() => vi.fn(async () => true));
const clipboard = vi.hoisted(() => vi.fn(async (_text: string) => undefined));

vi.mock("@/lib/tauri", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/tauri")>()), ...tauri }));
vi.mock("./note-reveal", () => ({ revealNoteLocation: reveal }));
vi.mock("@/lib/clipboard", () => ({ writeClipboardText: clipboard, readClipboardText: vi.fn() }));
vi.mock("@/components/ui/mermaid-diagram", () => ({
  renderDiagram: vi.fn(() => Promise.resolve(document.createElementNS("http://www.w3.org/2000/svg", "svg"))),
}));

import { NotesAttachments } from "./NotesAttachments";
import { NotesHome } from "./NotesHome";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const copy = enNotes.attachments;

const NOTES: NoteItem[] = [
  { id: "lab", title: "Lab plan", project: "Notes", updatedAt: 2, author: "you", summary: "" },
  { id: "trip", title: "Field trip", project: "Notes", updatedAt: 1, author: "you", summary: "" },
];

const TEXTS: Record<string, string> = {
  lab: "---\ntitle: Lab plan\n---\n\nIntro\n\n![plot](assets/plot.png)\n",
  trip: "![talk](assets/talk.mp3)\n",
};

const FILES: Record<string, FileEntry[]> = {
  lab: [
    { path: "note.md", is_dir: false },
    { path: "assets/plot.png", is_dir: false },
    { path: "assets/old.pdf", is_dir: false },
  ],
  trip: [{ path: "assets/talk.mp3", is_dir: false }],
};

function data(overrides: Partial<NotesData> = {}): NotesData {
  return fakeNotesData({
    notes: NOTES,
    revision: 1,
    loadNote: vi.fn(async (id: string) => ({ text: TEXTS[id], version: TEXTS[id] })),
    resolveAsset: vi.fn(async () => "data:image/png;base64,AAAA"),
    revealAsset: vi.fn(async () => undefined),
    ...overrides,
  });
}

function view(value: NotesData, search = "", onOpenNote = vi.fn()) {
  return (
    <NotesDataProvider value={value}>
      <NotesAttachments search={search} scrollRef={{ current: document.createElement("div") }} iconFor={() => undefined} onOpenNote={onOpenNote} />
    </NotesDataProvider>
  );
}

function show(value: NotesData, search = "") {
  const onOpenNote = vi.fn();
  render(view(value, search, onOpenNote));
  return onOpenNote;
}

function listed(): string[] {
  return tauri.listFiles.mock.calls.map(([id]) => id).sort();
}

function row(name: string): HTMLElement {
  const found = screen.getAllByRole("listitem").find((item) => within(item).queryByText(name));
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

function names(): string[] {
  return screen.getAllByRole("listitem").map((item) => item.querySelector("span.truncate")?.textContent ?? "");
}

beforeEach(() => {
  tauri.listFiles.mockReset().mockImplementation(async (id) => FILES[id] ?? []);
  tauri.projectFileSizes.mockReset().mockImplementation(async (_id, paths) => Object.fromEntries(paths.map((path) => [path, 2048])));
  reveal.mockClear();
  clipboard.mockClear();
});

afterEach(() => {
  appQueryClient().clear();
  useToastStore.setState({ toasts: [] });
});

describe("the attachments list", () => {
  it("lists every file with its picture, size and note, and marks the ones no note uses", async () => {
    show(data());
    expect(await screen.findByRole("list", { name: copy.list })).toBeInTheDocument();
    expect(names()).toEqual(["old.pdf", "plot.png", "talk.mp3"]);
    expect(within(row("old.pdf")).getByText(copy.unused)).toBeInTheDocument();
    expect(within(row("plot.png")).queryByText(copy.unused)).toBeNull();
    expect(within(row("plot.png")).getByText("2 KB")).toBeInTheDocument();
    await waitFor(() => expect(row("plot.png").querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA"));
    expect(row("talk.mp3").querySelector("img")).toBeNull();
    expect(within(row("talk.mp3")).getByRole("button", { name: "Open Field trip" })).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
  });

  it("filters by type, by use and by the words in the search box", async () => {
    const user = userEvent.setup();
    show(data());
    await screen.findByRole("list", { name: copy.list });
    await user.click(screen.getByRole("button", { name: `${copy.type.label}: ${copy.type.all}` }));
    await user.click(await screen.findByRole("menuitem", { name: copy.type.audio }));
    await waitFor(() => expect(names()).toEqual(["talk.mp3"]));
    await user.click(screen.getByRole("button", { name: copy.clear }));
    await user.click(screen.getByRole("button", { name: `${copy.use.label}: ${copy.use.all}` }));
    await user.click(await screen.findByRole("menuitem", { name: copy.use.unused }));
    await waitFor(() => expect(names()).toEqual(["old.pdf"]));
    await user.click(screen.getByRole("button", { name: `${copy.type.label}: ${copy.type.all}` }));
    await user.click(await screen.findByRole("menuitem", { name: copy.type.image }));
    expect(await screen.findByText(copy.noMatches)).toBeInTheDocument();
  });

  it("keeps the files whose name or note title has the searched words", async () => {
    show(data(), "field");
    await screen.findByRole("list", { name: copy.list });
    expect(names()).toEqual(["talk.mp3"]);
  });

  it("opens the note at the block that uses the file", async () => {
    const user = userEvent.setup();
    const onOpenNote = show(data());
    await screen.findByRole("list", { name: copy.list });
    await user.click(within(row("plot.png")).getByRole("button", { name: "Open Lab plan" }));
    expect(onOpenNote).toHaveBeenCalledWith("lab");
    await waitFor(() =>
      expect(reveal).toHaveBeenCalledWith("lab", TEXTS.lab, { path: "note.md", line: 7 }, expect.any(AbortSignal), { select: true, focus: true }),
    );
  });

  it("shows the file in its folder and copies a link to it", async () => {
    const user = userEvent.setup();
    const value = data();
    show(value);
    await screen.findByRole("list", { name: copy.list });
    await user.click(within(row("plot.png")).getByRole("button", { name: enCore.export.showInFolder }));
    await waitFor(() => expect(value.revealAsset).toHaveBeenCalledWith("lab", "assets/plot.png"));
    await user.click(within(row("plot.png")).getByRole("button", { name: copy.copyLink }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith("[plot](assets/plot.png)"));
    await waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain('Copied a link to "plot.png".'));
  });

  it("says when the link could not be copied", async () => {
    const user = userEvent.setup();
    clipboard.mockRejectedValueOnce(new Error("denied"));
    show(data());
    await screen.findByRole("list", { name: copy.list });
    await user.click(within(row("plot.png")).getByRole("button", { name: copy.copyLink }));
    await waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain('Couldn\'t copy the link to "plot.png".'));
  });

  it("says when no note has files", async () => {
    tauri.listFiles.mockResolvedValue([{ path: "note.md", is_dir: false }]);
    show(data());
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });

  it("reads again only the notes a save or an index change touched", async () => {
    const { rerender } = render(view(data()));
    await screen.findByRole("list", { name: copy.list });
    expect(listed()).toEqual(["lab", "trip"]);

    tauri.listFiles.mockClear();
    tauri.projectFileSizes.mockClear();
    const loadNote = vi.fn(async (id: string) => ({ text: TEXTS[id], version: TEXTS[id] }));
    const saved = NOTES.map((note) => (note.id === "lab" ? { ...note, updatedAt: 3 } : note));
    rerender(view(data({ notes: saved, revision: 2, loadNote })));
    await waitFor(() => expect(listed()).toEqual(["lab"]));
    await waitFor(() => expect(loadNote).toHaveBeenCalledWith("lab"));
    expect(loadNote).not.toHaveBeenCalledWith("trip");
    expect(tauri.projectFileSizes.mock.calls.map(([id]) => id)).toEqual(["lab"]);

    tauri.listFiles.mockClear();
    rerender(view(data({ notes: saved, revision: 3, changedNotes: ["trip"], loadNote })));
    await waitFor(() => expect(listed()).toEqual(["trip"]));
    expect(names()).toEqual(["old.pdf", "plot.png", "talk.mp3"]);
  });

  it("shows an error when no note's files can be read", async () => {
    tauri.listFiles.mockRejectedValue(new Error("disk"));
    show(data());
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(copy.failed);
  });
});

describe("the Attachments tab on Home", () => {
  it("swaps the notes for the attachments and hides the note layout controls", async () => {
    const user = userEvent.setup();
    render(
      <NotesDataProvider value={data()}>
        <NotesHome iconFor={() => undefined} onOpenNote={vi.fn()} />
      </NotesDataProvider>,
    );
    expect(tauri.listFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: enNotes.home.layout })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: enNotes.home.tabs.attachments }));
    expect(await screen.findByRole("list", { name: copy.list })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: enNotes.home.layout })).toBeNull();
    expect(screen.queryByRole("button", { name: enNotes.home.sort.opened })).toBeNull();
  });
});
