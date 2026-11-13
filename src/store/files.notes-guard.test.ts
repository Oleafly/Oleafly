import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNotesViewStore } from "@/store/notes-view";
import { useSettingsStore } from "@/store/settings";

function project(id: string, kind: string): ProjectInfo {
  return {
    id,
    name: id,
    main_doc: kind === "note" ? "note.md" : "main.tex",
    kind,
    created_at: 1,
    updated_at: 1,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
  };
}

const saved = {
  files: useFilesStore.getState(),
  home: useHomeViewStore.getState(),
  notesView: useNotesViewStore.getState(),
  settings: useSettingsStore.getState(),
};

beforeEach(() => {
  useFilesStore.setState({ projectId: null, projects: [project("paper", "document"), project("idea", "note")] });
  useHomeViewStore.setState({ page: "library" });
  useNotesViewStore.setState({ requestedNoteId: null });
});

afterEach(() => {
  useFilesStore.setState(saved.files, true);
  useHomeViewStore.setState(saved.home, true);
  useNotesViewStore.setState(saved.notesView, true);
  useSettingsStore.setState(saved.settings, true);
});

describe("opening a note project", () => {
  it("opens it in Notes while Notes is on", async () => {
    useSettingsStore.setState({ notes: true });
    const shouldContinue = vi.fn(() => true);
    await useFilesStore.getState().openProject("idea", shouldContinue);
    expect(useHomeViewStore.getState().page).toBe("notes");
    expect(useNotesViewStore.getState().requestedNoteId).toBe("idea");
    expect(useFilesStore.getState().projectId).toBeNull();
    expect(shouldContinue).not.toHaveBeenCalled();
  });

  it("opens it as a project while Notes is off", async () => {
    useSettingsStore.setState({ notes: false });
    const shouldContinue = vi.fn(() => false);
    await useFilesStore.getState().openProject("idea", shouldContinue);
    expect(shouldContinue).toHaveBeenCalled();
    expect(useHomeViewStore.getState().page).toBe("library");
    expect(useNotesViewStore.getState().requestedNoteId).toBeNull();
  });

  it("opens other projects as projects while Notes is on", async () => {
    useSettingsStore.setState({ notes: true });
    const shouldContinue = vi.fn(() => false);
    await useFilesStore.getState().openProject("paper", shouldContinue);
    expect(shouldContinue).toHaveBeenCalled();
    expect(useHomeViewStore.getState().page).toBe("library");
    expect(useNotesViewStore.getState().requestedNoteId).toBeNull();
  });
});
