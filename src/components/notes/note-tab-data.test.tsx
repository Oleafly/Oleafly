// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";

const mocks = vi.hoisted(() => ({
  noteHeads: vi.fn(),
  noteLinks: vi.fn(),
  readFileContent: vi.fn(),
  writeProjectFile: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteHeads: mocks.noteHeads,
  noteLinks: mocks.noteLinks,
  readFileContent: mocks.readFileContent,
}));

const { resetNoteTabHeadsForTest, useLibraryNotesData } = await import("./note-tab-data");
const { vaultLoad } = await import("./vault-loads");

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

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.clearAllMocks();
  resetNoteTabHeadsForTest();
  mocks.noteHeads.mockResolvedValue([{ id: "mine", head: NOTE }]);
  mocks.noteLinks.mockResolvedValue([]);
  mocks.readFileContent.mockResolvedValue(NOTE);
  mocks.writeProjectFile.mockResolvedValue(undefined);
  useFilesStore.setState({ projects: [MINE], projectsLoaded: true, writeProjectFile: mocks.writeProjectFile });
});

async function openTab() {
  const tab = renderHook(() => useLibraryNotesData());
  await waitFor(() => expect(tab.result.current.headsLoaded).toBe(true));
  return tab;
}

describe("note tab vault revision", () => {
  it("keeps the revision through saves that change no link or tag, and moves it for one that does", async () => {
    const tab = await openTab();
    const data = () => tab.result.current.data;
    let version = (await data().loadNote("mine")).version;
    const save = async (text: string) => {
      await act(async () => {
        version = (await data().saveNote("mine", text, version)).version;
      });
    };
    await save(NOTE.replace("this week", "this month"));
    const settled = data().revision;
    await save(NOTE.replace("this week", "this month, slowly"));
    await save(NOTE.replace("this week", "this month, slowly and carefully"));
    expect(data().revision).toBe(settled);
    expect(data().notes[0].preview).toContain("slowly and carefully");
    await save(NOTE.replace("this week", "this month, see [Other](oleafly://note/other)"));
    expect(data().revision).not.toBe(settled);
    expect(mocks.writeProjectFile).toHaveBeenCalledTimes(4);
  });

  it("moves the revision of every open tab when one tab saves a new link", async () => {
    const first = await openTab();
    const second = await openTab();
    const before = second.result.current.data.revision;
    expect(first.result.current.data.revision).toBe(before);
    const version = (await first.result.current.data.loadNote("mine")).version;
    await act(async () => {
      await first.result.current.data.saveNote("mine", NOTE.replace("Papers", "See [Other](oleafly://note/other) papers"), version);
    });
    expect(second.result.current.data.revision).not.toBe(before);
    expect(second.result.current.data.revision).toBe(first.result.current.data.revision);
  });

  it("shows every open tab what another tab saved, from one read of the heads", async () => {
    const first = await openTab();
    const second = await openTab();
    expect(mocks.noteHeads).toHaveBeenCalledOnce();
    const version = (await first.result.current.data.loadNote("mine")).version;
    await act(async () => {
      await first.result.current.data.saveNote("mine", NOTE.replace("Papers to read", "Books to read"), version);
    });
    expect(second.result.current.data.notes[0].preview).toContain("Books to read");
    act(() => second.result.current.data.noteTextChanged?.("mine", NOTE.replace("Papers to read", "Essays to read")));
    expect(first.result.current.data.notes[0].preview).toContain("Essays to read");
  });

  it("starts fresh when a tab opens after every tab closed, and when the note list changes", async () => {
    const first = await openTab();
    const opened = first.result.current.data.revision;
    first.unmount();
    const again = await openTab();
    const reopened = again.result.current.data.revision;
    expect(reopened).not.toBe(opened);
    act(() => useFilesStore.setState({ projects: [{ ...MINE, updated_at: 3 }] }));
    await waitFor(() => expect(again.result.current.data.revision).not.toBe(reopened));
  });

  it("keeps its link loads apart from the Notes page's loads at the same revision", async () => {
    const tab = await openTab();
    const { noteLinks, revision } = tab.result.current.data;
    await vaultLoad(mocks.noteLinks, revision);
    await vaultLoad(noteLinks ?? mocks.noteLinks, revision);
    expect(mocks.noteLinks).toHaveBeenCalledTimes(2);
  });
});
