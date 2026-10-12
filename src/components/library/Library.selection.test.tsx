// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const recycleProject = vi.fn(async (_id: string) => {});
const removeLinkedProject = vi.fn(async (_id: string) => {});
const toastSuccess = vi.fn();
const notifyError = vi.fn();

vi.mock("@/components/library/HomeDock", () => ({
  HomeDock: () => null,
  HOME_DOCK_GLASS_SURFACE: "",
}));
vi.mock("@/components/layout/WindowControls", () => ({
  WindowControls: () => null,
}));
vi.mock("@/components/layout/LeafLogo", () => ({ LeafLogo: () => null }));
vi.mock("@/components/library/ProjectImportMenu", () => ({
  ProjectImportMenu: ({ trigger }: { trigger: (busy: boolean) => ReactNode }) => trigger(false),
}));
vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn(async () => {}),
  recycleProject: (id: string) => recycleProject(id),
  removeLinkedProject: (id: string) => removeLinkedProject(id),
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { Library } from "@/components/library/Library";
import { isMac } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useLibrarySelectionStore } from "@/store/library-selection";
import { useSettingsStore } from "@/store/settings";

const openProject = vi.fn(async () => {});
const refreshProjects = vi.fn(async () => {});
const MODIFIER = isMac ? { metaKey: true } : { ctrlKey: true };

function project(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    main_doc: "main.tex",
    engine: "tectonic",
    kind: "document",
    color: "#287fd1",
    created_at: 1,
    updated_at: 1,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    location: { kind: "library" },
    ...extra,
  };
}

const PAPER = project("paper", "Research paper");
const NOTES = project("notes", "Lecture notes");
const THESIS = project("thesis", "Thesis", {
  location: { kind: "linked", display_path: "~/Desktop/thesis", availability: "available" },
});

function seed(projects: unknown[]) {
  useFilesStore.setState({ projectsLoaded: true, projects: projects as never, refreshProjects, openProject });
}

function openButton(name: string) {
  return screen.getByRole("button", { name: new RegExp(`^${enLibrary.projects.open.replace("{{name}}", name)}`) });
}

function selectedIds() {
  return [...useLibrarySelectionStore.getState().ids].sort();
}

beforeEach(() => {
  localStorage.clear();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  recycleProject.mockReset();
  removeLinkedProject.mockReset();
  toastSuccess.mockReset();
  notifyError.mockReset();
  openProject.mockReset();
  refreshProjects.mockReset();
  useLibrarySelectionStore.getState().clear();
  useHomeViewStore.setState({ page: "library" });
  useSettingsStore.setState({ bgPattern: "none", hoverPreview: false, homeProjectLayout: "grid", newProjectOpen: false });
  seed([PAPER, NOTES]);
});

describe("library multi-select", () => {
  it("selects with the modifier click instead of opening, and opens on a plain click", () => {
    render(<Library />);
    fireEvent.click(openButton("Research paper"), MODIFIER);
    expect(openProject).not.toHaveBeenCalled();
    expect(selectedIds()).toEqual(["paper"]);
    const card = document.querySelector('[data-library-item="paper"]');
    expect(card).toHaveAttribute("data-selected", "true");
    expect(card?.querySelector('[data-slot="check-badge"]')).not.toBeNull();

    fireEvent.click(openButton("Lecture notes"), MODIFIER);
    expect(selectedIds()).toEqual(["notes", "paper"]);
    fireEvent.click(openButton("Research paper"), MODIFIER);
    expect(selectedIds()).toEqual(["notes"]);

    fireEvent.click(openButton("Research paper"));
    expect(openProject).toHaveBeenCalledWith("paper");
  });

  it("selects rows in the list view too", () => {
    useSettingsStore.setState({ homeProjectLayout: "list" });
    render(<Library />);
    fireEvent.click(openButton("Lecture notes"), MODIFIER);
    expect(selectedIds()).toEqual(["notes"]);
    const row = document.querySelector('[data-library-item="notes"]');
    expect(row).toHaveClass("bg-primary/10");
    expect(row?.querySelector('[data-slot="check-badge"]')).not.toBeNull();
  });

  it("shows the delete button only with a selection and clears it on Escape", async () => {
    render(<Library />);
    expect(screen.queryByTestId("bulk-delete-button")).not.toBeInTheDocument();
    act(() => useLibrarySelectionStore.getState().replace(new Set(["paper", "notes"])));
    expect(await screen.findByTestId("bulk-delete-button")).toHaveAccessibleName("Delete 2 selected projects");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId("bulk-delete-button")).not.toBeInTheDocument();
  });

  it("moves the selection to the Recycle Bin after confirming", async () => {
    render(<Library />);
    act(() => useLibrarySelectionStore.getState().replace(new Set(["paper", "notes"])));
    fireEvent.click(await screen.findByTestId("bulk-delete-button"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Move 2 projects to the Recycle Bin?");
    expect(dialog).not.toHaveTextContent(enLibrary.projects.bulkDelete.folderNote);
    const refreshesBefore = refreshProjects.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(enLibrary.projects.deleteDialog.confirm) }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Removed 2 projects from your library."));
    expect(recycleProject.mock.calls.map(([id]) => id).sort()).toEqual(["notes", "paper"]);
    expect(refreshProjects.mock.calls).toHaveLength(refreshesBefore + 1);
    expect(selectedIds()).toEqual([]);
  });

  it("removes opened folders instead of recycling them and keeps failures selected", async () => {
    seed([PAPER, NOTES, THESIS]);
    recycleProject.mockImplementation(async (id: string) => {
      if (id === "notes") throw new Error("locked");
    });
    render(<Library />);
    act(() => useLibrarySelectionStore.getState().replace(new Set(["paper", "notes", "thesis"])));
    fireEvent.click(await screen.findByTestId("bulk-delete-button"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(enLibrary.projects.bulkDelete.folderNote);
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(enLibrary.projects.deleteDialog.confirm) }));
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(removeLinkedProject).toHaveBeenCalledWith("thesis");
    expect(recycleProject).not.toHaveBeenCalledWith("thesis");
    expect(notifyError.mock.calls[0]?.[2]).toBe("Couldn't delete 1 project.");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(selectedIds()).toEqual(["notes"]);
  });

  it("asks about a single project by name", async () => {
    render(<Library />);
    act(() => useLibrarySelectionStore.getState().replace(new Set(["paper"])));
    fireEvent.click(await screen.findByTestId("bulk-delete-button"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Move “Research paper” to the Recycle Bin?");
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/ }));
    expect(recycleProject).not.toHaveBeenCalled();
    expect(selectedIds()).toEqual(["paper"]);
  });

  it("drops selections that leave the visible list or the page", () => {
    const view = render(<Library />);
    act(() => useLibrarySelectionStore.getState().replace(new Set(["paper", "notes"])));
    act(() => seed([PAPER]));
    view.rerender(<Library />);
    expect(selectedIds()).toEqual(["paper"]);
    act(() => useHomeViewStore.setState({ page: "settings" as never }));
    expect(selectedIds()).toEqual([]);
  });
});
