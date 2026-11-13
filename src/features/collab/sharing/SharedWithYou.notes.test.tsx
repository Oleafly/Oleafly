// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNotesViewStore } from "@/store/notes-view";
import { useSettingsStore } from "@/store/settings";
import { useCollabStore } from "../store";
import { fill, libraryProject, projectSummary, sharedWithMe } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabSharedWithMe: vi.fn(),
  collabJoinProject: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabSharedWithMe: mocks.collabSharedWithMe,
  collabJoinProject: mocks.collabJoinProject,
}));

import { SharedWithYou } from "./SharedWithYou";

const copy = enCollab.library.sharedWithYou;

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
  useHomeViewStore.getState().goTo("library");
  useNotesViewStore.setState({ requestedNoteId: null });
  useSettingsStore.setState({ notes: true });
});

describe("joining a shared note", () => {
  it("opens the joined note in Notes", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([
      sharedWithMe({ project: projectSummary({ project_id: "shared-note", title: "Lab notes" }) }),
    ]);
    mocks.collabJoinProject.mockResolvedValue("joined-note");
    const refreshProjects = vi.fn(async () => {
      useFilesStore.setState({ projects: [libraryProject({ id: "joined-note", name: "Lab notes", kind: "note", main_doc: "note.md" })] });
    });
    useFilesStore.setState({ refreshProjects, projects: [] });
    render(<SharedWithYou />);
    await userEvent.click(await screen.findByRole("button", { name: fill(copy.openNamed, { name: "Lab notes" }) }));
    await waitFor(() => expect(useHomeViewStore.getState().page).toBe("notes"));
    expect(mocks.collabJoinProject).toHaveBeenCalledWith(expect.any(String), "shared-note");
    expect(refreshProjects).toHaveBeenCalled();
    expect(useNotesViewStore.getState().requestedNoteId).toBe("joined-note");
    expect(useFilesStore.getState().projectId).toBeNull();
  });
});
