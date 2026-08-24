// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  libraryRoot: vi.fn(),
  libraryStorageSummary: vi.fn(),
  listRecycledProjects: vi.fn(),
  restoreRecycledProject: vi.fn(),
  permanentlyDeleteRecycledProject: vi.fn(),
  recycleProject: vi.fn(),
  refreshProjects: vi.fn(),
  closeProject: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: mocks.libraryRoot,
  libraryStorageSummary: mocks.libraryStorageSummary,
  listRecycledProjects: mocks.listRecycledProjects,
  restoreRecycledProject: mocks.restoreRecycledProject,
  permanentlyDeleteRecycledProject: mocks.permanentlyDeleteRecycledProject,
  recycleProject: mocks.recycleProject,
}));
vi.mock("@/components/layout/UpdateChecker", () => ({
  UpdateChecker: () => null,
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

import { SettingsModal } from "./SettingsModal";

const storageSummary = {
  total_bytes: 23,
  projects_bytes: 10,
  source_bytes: 4,
  image_bytes: 1,
  pdf_bytes: 1,
  git_bytes: 2,
  build_bytes: 2,
  recycle_bin_bytes: 8,
  app_data_bytes: 5,
  project_count: 1,
  recycled_project_count: 1,
  file_count: 8,
  directory_count: 4,
  image_count: 1,
  pdf_count: 1,
  unreadable_entries: 0,
};

const recycledProject = {
  id: "123-0-paper",
  project_id: "paper",
  name: "Research paper",
  deleted_at: 1_700_000_000,
  size_bytes: 8,
};

describe("Settings Data Storage recycle bin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    mocks.libraryRoot.mockResolvedValue("/tmp/.oleafly/projects");
    mocks.libraryStorageSummary.mockResolvedValue(storageSummary);
    mocks.listRecycledProjects.mockResolvedValue([recycledProject]);
    mocks.restoreRecycledProject.mockResolvedValue("paper");
    mocks.permanentlyDeleteRecycledProject.mockResolvedValue(undefined);
    mocks.recycleProject.mockResolvedValue(undefined);
    mocks.refreshProjects.mockResolvedValue(undefined);
    mocks.closeProject.mockResolvedValue(undefined);
    useFilesStore.setState({
      projectId: null,
      projects: [
        {
          id: "active-paper",
          name: "Active paper",
          main_doc: "main.tex",
          engine: "tectonic",
          kind: "document",
          created_at: 1,
          updated_at: 1,
          color: "",
          has_preview: false,
          exports: [],
          forked_from: null,
        },
      ],
      refreshProjects: mocks.refreshProjects,
      closeProject: mocks.closeProject,
    });
    useGithubStore.setState({ status: "disconnected", user: null });
    useSettingsStore.setState({
      settingsOpen: true,
      settingsInitialSection: "data",
    });
  });

  it("lists recycled projects and restores them", async () => {
    render(<SettingsModal />);

    expect(
      await screen.findByRole("heading", { name: "Recycle Bin" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Research paper")).toBeInTheDocument();
    expect(screen.getByText(/no automatic cleanup/i)).toBeInTheDocument();
    expect(screen.getByText("Set up GitHub →")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(mocks.restoreRecycledProject).toHaveBeenCalledWith("123-0-paper");
      expect(mocks.refreshProjects).toHaveBeenCalledOnce();
    });
  });

  it("requires confirmation before permanent deletion", async () => {
    render(<SettingsModal />);
    await screen.findByText("Research paper");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Permanently delete Research paper",
      }),
    );
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent(
      "This action cannot be undone.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    await waitFor(() => {
      expect(mocks.permanentlyDeleteRecycledProject).toHaveBeenCalledWith(
        "123-0-paper",
      );
    });
  });

  it("requires confirmation before clearing every recycled project", async () => {
    const secondProject = {
      ...recycledProject,
      id: "124-0-notes",
      project_id: "notes",
      name: "Research notes",
    };
    mocks.listRecycledProjects.mockResolvedValue([recycledProject, secondProject]);

    render(<SettingsModal />);
    await screen.findByText("Research paper");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(mocks.permanentlyDeleteRecycledProject).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "This action cannot be undone.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Recycle Bin" }));

    await waitFor(() => {
      expect(mocks.permanentlyDeleteRecycledProject).toHaveBeenNthCalledWith(
        1,
        "123-0-paper",
      );
      expect(mocks.permanentlyDeleteRecycledProject).toHaveBeenNthCalledWith(
        2,
        "124-0-notes",
      );
    });
  });

  it("hides GitHub setup guidance after GitHub is connected", async () => {
    useGithubStore.setState({
      status: "connected",
      user: {
        login: "researcher",
        name: "Researcher",
        avatar_url: "",
        html_url: "https://github.com/researcher",
      },
    });

    render(<SettingsModal />);
    await screen.findByRole("heading", { name: "Recycle Bin" });

    expect(screen.queryByText("Set up GitHub →")).not.toBeInTheDocument();
  });

  it("confirms before moving every project to the Recycle Bin", async () => {
    render(<SettingsModal />);
    await screen.findByRole("heading", { name: "Danger zone" });

    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "You can restore projects individually afterward.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete all projects" }),
    );

    await waitFor(() => {
      expect(mocks.recycleProject).toHaveBeenCalledWith("active-paper");
    });
  });
});
