// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appQueryClient } from "@/lib/query";
import { useFilesStore } from "@/store/files";
import "./tests/setup";

const mocks = vi.hoisted(() => ({
  noteFacts: vi.fn(),
  readFileContent: vi.fn(),
  writeProjectFile: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteFacts: mocks.noteFacts,
  readFileContent: mocks.readFileContent,
}));

const { useLibraryNotesData } = await import("./note-tab-data");

const NOTE = "---\ntitle: Reading list\nkind: note\n---\n\nPapers to read this week.\n";

const MINE: ProjectInfo = {
  id: "mine",
  name: "Reading list",
  main_doc: "note.md",
  kind: "note",
  created_at: 1,
  updated_at: 2,
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
};

const facts = { current: { preview: "Papers to read this week.", knowledge: "k1" } };

beforeEach(() => {
  vi.clearAllMocks();
  appQueryClient().clear();
  facts.current = { preview: "Papers to read this week.", knowledge: "k1" };
  mocks.noteFacts.mockImplementation(async () => [
    { id: "mine", noteId: null, title: "Reading list", icon: null, color: null, agent: null, tags: [], aliases: [], properties: {}, relatedProject: null, updatedAt: 1, ...facts.current },
  ]);
  mocks.readFileContent.mockResolvedValue(NOTE);
  mocks.writeProjectFile.mockResolvedValue(undefined);
  useFilesStore.setState({ projects: [MINE], projectsLoaded: true, writeProjectFile: mocks.writeProjectFile });
});

async function openTab() {
  const tab = renderHook(() => useLibraryNotesData());
  await waitFor(() => expect(tab.result.current.headsLoaded).toBe(true));
  return tab;
}

describe("note tab vault data", () => {
  it("keeps the revision through saves that change no link or tag, and moves it for one that does", async () => {
    const tab = await openTab();
    const data = () => tab.result.current.data;
    const settled = data().revision;
    const save = async (text: string, preview: string, knowledge = "k1") => {
      facts.current = { preview, knowledge };
      const { version } = await data().loadNote("mine");
      await act(async () => {
        await data().saveNote("mine", text, version);
      });
      await waitFor(() => expect(data().notes[0].preview).toBe(preview));
    };
    await save(NOTE.replace("this week", "this month"), "Papers to read this month.");
    expect(data().revision).toBe(settled);
    await save(NOTE.replace("this week", "[Other](oleafly://note/other)"), "Papers to read [Other](oleafly://note/other).", "k2");
    expect(data().revision).not.toBe(settled);
    expect(data().changedNotes).toEqual(["mine"]);
  });

  it("shows every open tab what another tab saved, from one read of the facts", async () => {
    const first = await openTab();
    const second = await openTab();
    expect(mocks.noteFacts).toHaveBeenCalledOnce();
    facts.current = { preview: "Books to read.", knowledge: "k1" };
    const { version } = await first.result.current.data.loadNote("mine");
    await act(async () => {
      await first.result.current.data.saveNote("mine", NOTE.replace("Papers to read this week", "Books to read"), version);
    });
    await waitFor(() => expect(second.result.current.data.notes[0].preview).toBe("Books to read."));
    expect(second.result.current.data.revision).toBe(first.result.current.data.revision);
  });

  it("reads the facts again when the note list changes", async () => {
    const tab = await openTab();
    facts.current = { preview: "Renamed.", knowledge: "k3" };
    act(() => useFilesStore.setState({ projects: [{ ...MINE, name: "Renamed list" }] }));
    await waitFor(() => expect(tab.result.current.data.notes[0]).toMatchObject({ title: "Renamed list", preview: "Renamed." }));
  });
});
