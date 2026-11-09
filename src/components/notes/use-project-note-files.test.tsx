// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
  tauri: true,
  handler: null as null | ((payload: { projectId: string; paths: string[]; rescan: boolean }) => void),
  enabled: false,
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => mocks.tauri,
}));
vi.mock("@/hooks/use-tauri-event", () => ({
  useTauriEvent: (_event: string, handler: typeof mocks.handler, enabled: boolean) => {
    mocks.handler = handler;
    mocks.enabled = enabled;
  },
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readFileContent: mocks.readFileContent,
}));

import { useFilesStore } from "@/store/files";
import {
  PROJECT_NOTE_READ_LIMIT,
  projectNoteFile,
  projectNotePaths,
  touchesNotes,
  useProjectNoteFiles,
} from "./use-project-note-files";

const NOTE = "---\ntitle: Plan\nkind: note\n---\n\nFirst line.\n";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tauri = true;
  mocks.readFileContent.mockResolvedValue(NOTE);
  useFilesStore.setState({
    projectId: "paper",
    tree: [{ path: "notes/Plan.md", is_dir: false }],
    files: {},
  });
});

describe("project note files", () => {
  it("builds a row from a note file and skips other files", () => {
    expect(projectNoteFile("notes/Plan.md", NOTE)).toEqual({ path: "notes/Plan.md", title: "Plan", summary: "First line." });
    expect(projectNoteFile("notes/Plan.md", "# no\n")).toBeNull();
    expect(projectNoteFile("notes/Plan.md", undefined)).toBeNull();
  });

  it("notices folder changes in the notes folder of this project", () => {
    expect(touchesNotes({ projectId: "paper", paths: ["/x/paper/notes/Plan.md"], rescan: false }, "paper")).toBe(true);
    expect(touchesNotes({ projectId: "paper", paths: ["notes\\a.md"], rescan: false }, "paper")).toBe(true);
    expect(touchesNotes({ projectId: "paper", paths: ["main.tex"], rescan: false }, "paper")).toBe(false);
    expect(touchesNotes({ projectId: "paper", paths: [], rescan: true }, "paper")).toBe(true);
    expect(touchesNotes({ projectId: "other", paths: ["notes/a.md"], rescan: true }, "paper")).toBe(false);
  });

  it("re-reads the notes when the notes folder changes on disk", async () => {
    const { result } = renderHook(() => useProjectNoteFiles("paper"));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(mocks.enabled).toBe(true);
    mocks.readFileContent.mockResolvedValue(NOTE.replace("Plan", "Plan B"));
    act(() => mocks.handler?.({ projectId: "paper", paths: ["notes/Plan.md"], rescan: false }));
    await waitFor(() => expect(result.current.notes[0].title).toBe("Plan B"));
    const reads = mocks.readFileContent.mock.calls.length;
    act(() => mocks.handler?.({ projectId: "paper", paths: ["main.tex"], rescan: false }));
    expect(mocks.readFileContent.mock.calls.length).toBe(reads);
  });

  it("reads at most the limit and does not listen outside the app", async () => {
    mocks.tauri = false;
    useFilesStore.setState({
      tree: Array.from({ length: PROJECT_NOTE_READ_LIMIT + 5 }, (_, index) => ({ path: `notes/n${index}.md`, is_dir: false })),
    });
    const { result } = renderHook(() => useProjectNoteFiles("paper"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(mocks.readFileContent).toHaveBeenCalledTimes(PROJECT_NOTE_READ_LIMIT);
    expect(result.current.more).toBe(5);
    expect(mocks.enabled).toBe(false);
  });

  it("re-reads only the notes that changed, and all of them on a rescan", async () => {
    useFilesStore.setState({
      tree: [
        { path: "notes/Plan.md", is_dir: false },
        { path: "Notes/Agenda.md", is_dir: false },
        { path: "notes/Open.md", is_dir: false },
      ],
      files: { "notes/Open.md": { content: NOTE.replace("Plan", "Open"), dirty: false } },
    });
    const { result } = renderHook(() => useProjectNoteFiles("paper"));
    await waitFor(() => expect(result.current.notes).toHaveLength(3));
    expect(mocks.readFileContent.mock.calls.map((call) => call[1]).sort()).toEqual(["Notes/Agenda.md", "notes/Plan.md"]);
    mocks.readFileContent.mockClear();
    mocks.readFileContent.mockResolvedValue(NOTE.replace("Plan", "Agenda B"));
    act(() => mocks.handler?.({ projectId: "paper", paths: ["C:\\x\\paper\\notes\\agenda.md"], rescan: false }));
    await waitFor(() => expect(result.current.notes.map((note) => note.title)).toContain("Agenda B"));
    expect(mocks.readFileContent.mock.calls.map((call) => call[1])).toEqual(["Notes/Agenda.md"]);
    mocks.readFileContent.mockClear();
    act(() => mocks.handler?.({ projectId: "paper", paths: [], rescan: true }));
    await waitFor(() => expect(mocks.readFileContent).toHaveBeenCalledTimes(2));
  });

  it("summarizes a note again only when its text changes", async () => {
    const { result, rerender } = renderHook(() => useProjectNoteFiles("paper"));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    const row = result.current.notes[0];
    act(() => useFilesStore.setState({ tree: [...useFilesStore.getState().tree, { path: "main.tex", is_dir: false }] }));
    rerender();
    expect(result.current.notes[0]).toBe(row);
  });

  it("scans the file tree once per tree, not on every keystroke", async () => {
    const tree = [
      { path: "main.tex", is_dir: false },
      { path: "notes/Plan.md", is_dir: false },
      { path: "notes/assets/fig.md", is_dir: false },
    ];
    const scan = vi.spyOn(tree, "filter");
    useFilesStore.setState({ tree });
    const { result } = renderHook(() => useProjectNoteFiles("paper"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    for (const text of ["a", "ab", "abc"]) {
      act(() => useFilesStore.setState({ files: { "main.tex": { content: text, dirty: true } } }));
    }
    expect(scan).toHaveBeenCalledTimes(1);
    expect(projectNotePaths(tree)).toEqual(["notes/Plan.md"]);
    expect(projectNotePaths(tree)).toBe(projectNotePaths(tree));
  });

  it("lists nothing without an open project or for another project", () => {
    const none = renderHook(() => useProjectNoteFiles(null));
    expect(none.result.current).toEqual({ notes: [], loaded: true, more: 0 });
    const other = renderHook(() => useProjectNoteFiles("thesis"));
    expect(other.result.current.notes).toEqual([]);
    act(() => mocks.handler?.({ projectId: "thesis", paths: ["notes/a.md"], rescan: false }));
    expect(mocks.readFileContent).not.toHaveBeenCalled();
  });

  it("drops a read that a newer read of the same note replaced", async () => {
    let deliverOld: (text: string) => void = () => {};
    mocks.readFileContent.mockImplementationOnce(() => new Promise((resolve) => (deliverOld = resolve)));
    mocks.readFileContent.mockResolvedValueOnce("---\ntitle: Fresh\nkind: note\n---\n");
    const { result } = renderHook(() => useProjectNoteFiles("paper"));
    act(() => mocks.handler?.({ projectId: "paper", paths: ["notes/Plan.md"], rescan: false }));
    await waitFor(() => expect(result.current.notes.map((note) => note.title)).toEqual(["Fresh"]));
    await act(async () => deliverOld(NOTE));
    expect(result.current.notes.map((note) => note.title)).toEqual(["Fresh"]);
  });
});
