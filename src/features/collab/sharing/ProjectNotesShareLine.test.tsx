// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listFiles: mocks.listFiles,
  readFileContent: mocks.readFileContent,
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));

import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { hasProjectNotes, ProjectNotesShareLine, SHARED_NOTE_BATCH } from "./ProjectNotesShareLine";

const NOTE = "---\nkind: note\n---\n";
const PAPER: ProjectInfo = {
  id: "paper",
  name: "Paper",
  main_doc: "main.tex",
  kind: "document",
  created_at: 1,
  updated_at: 2,
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
};

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ notes: true });
  mocks.readFileContent.mockImplementation(async (_projectId: string, path: string) => {
    if (path === "notes/broken.md") throw new Error("gone");
    return path === "notes/plain.md" ? "# plain\n" : NOTE;
  });
  mocks.listFiles.mockResolvedValue([
    { path: "notes/a.md", is_dir: false },
    { path: "notes/plain.md", is_dir: false },
    { path: "notes/broken.md", is_dir: false },
    { path: "notes/assets/x.md", is_dir: false },
  ]);
  useFilesStore.setState({
    projectId: "paper",
    projects: [PAPER, { ...PAPER, id: "note", kind: "note" }],
    tree: [
      { path: "notes", is_dir: true },
      { path: "notes/a.md", is_dir: false },
      { path: "notes/b.md", is_dir: false },
    ],
    files: { "notes/b.md": { content: NOTE, dirty: true } },
  });
});

describe("project notes in the Share dialog", () => {
  it("finds a note in the open project from its open files without reading any", async () => {
    await expect(hasProjectNotes("paper")).resolves.toBe(true);
    expect(mocks.readFileContent).not.toHaveBeenCalled();
    expect(mocks.listFiles).not.toHaveBeenCalled();
  });

  it("finds a note of a project that is not open from its file list", async () => {
    await expect(hasProjectNotes("thesis")).resolves.toBe(true);
    expect(mocks.listFiles).toHaveBeenCalledWith("thesis");
  });

  it("stops reading at the first batch that holds a note", async () => {
    const paths = Array.from({ length: SHARED_NOTE_BATCH * 3 }, (_, index) => `notes/${index}.md`);
    mocks.listFiles.mockResolvedValue(paths.map((path) => ({ path, is_dir: false })));
    mocks.readFileContent.mockImplementation(async (_projectId: string, path: string) =>
      path === "notes/1.md" ? NOTE : "# plain\n",
    );
    await expect(hasProjectNotes("thesis")).resolves.toBe(true);
    expect(mocks.readFileContent).toHaveBeenCalledTimes(SHARED_NOTE_BATCH);
    mocks.readFileContent.mockResolvedValue("# plain\n");
    await expect(hasProjectNotes("thesis")).resolves.toBe(false);
  });

  it("says the project's notes are shared when it has some", async () => {
    render(<ProjectNotesShareLine projectId="paper" />);
    expect(await screen.findByTestId("collab-share-project-notes")).toHaveTextContent(
      enCollab.share.projectNotesShared,
    );
  });

  it("says personal notes stay private when the project has none", async () => {
    useFilesStore.setState({ tree: [], files: {} });
    render(<ProjectNotesShareLine projectId="paper" />);
    expect(await screen.findByTestId("collab-share-project-notes")).toHaveTextContent(
      enCollab.share.personalNotesPrivate,
    );
  });

  it("stays out of the way for notes and when Notes is off", () => {
    const { unmount } = render(<ProjectNotesShareLine projectId="note" />);
    expect(screen.queryByTestId("collab-share-project-notes")).toBeNull();
    unmount();
    useSettingsStore.setState({ notes: false });
    render(<ProjectNotesShareLine projectId="paper" />);
    expect(screen.queryByTestId("collab-share-project-notes")).toBeNull();
    expect(mocks.listFiles).not.toHaveBeenCalled();
  });

  it("falls back to the privacy line when it cannot list the files", async () => {
    const failure = new Error("offline");
    mocks.listFiles.mockRejectedValueOnce(failure);
    render(<ProjectNotesShareLine projectId="thesis" />);
    expect(await screen.findByTestId("collab-share-project-notes")).toHaveTextContent(
      enCollab.share.personalNotesPrivate,
    );
    expect(mocks.logError).toHaveBeenCalledWith("count the project notes for sharing", failure);
  });

  it("keeps the line of the project it now shows when an older count arrives late", async () => {
    let deliver: (value: unknown[]) => void = () => {};
    mocks.listFiles.mockImplementationOnce(() => new Promise((resolve) => (deliver = resolve)));
    const { rerender } = render(<ProjectNotesShareLine projectId="thesis" />);
    rerender(<ProjectNotesShareLine projectId="paper" />);
    const line = await screen.findByTestId("collab-share-project-notes");
    expect(line).toHaveTextContent(enCollab.share.projectNotesShared);
    await act(async () => deliver([]));
    expect(screen.getByTestId("collab-share-project-notes")).toHaveTextContent(enCollab.share.projectNotesShared);
  });

  it("keeps the line of the project it now shows when an older count fails late", async () => {
    let fail: (error: Error) => void = () => {};
    mocks.listFiles.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    const { rerender } = render(<ProjectNotesShareLine projectId="thesis" />);
    rerender(<ProjectNotesShareLine projectId="paper" />);
    expect(await screen.findByTestId("collab-share-project-notes")).toHaveTextContent(enCollab.share.projectNotesShared);
    const late = new Error("late");
    await act(async () => fail(late));
    expect(screen.getByTestId("collab-share-project-notes")).toHaveTextContent(enCollab.share.projectNotesShared);
    expect(mocks.logError).toHaveBeenCalledWith("count the project notes for sharing", late);
  });
});
