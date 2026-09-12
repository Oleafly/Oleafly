// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  libraryRoot: vi.fn(),
  libraryStorageSummary: vi.fn(),
  listRecycledProjects: vi.fn(),
  restoreRecycledProject: vi.fn(),
  permanentlyDeleteRecycledProject: vi.fn(),
  recycleProject: vi.fn(),
  refreshProjects: vi.fn(),
  closeProject: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  notifyError: vi.fn(),
  success: vi.fn(),
  startTour: vi.fn(),
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
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: "dark",
    theme: "dark",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifyError: mocks.notifyError,
  toast: { success: mocks.success, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/tours", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startTour: mocks.startTour,
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { TOUR_IDS, resolveTourText, tourRegistry } from "@/lib/tours/registry";
import { useFilesStore } from "@/store/files";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { SettingsModal } from "./SettingsModal";

const data = enShell.settings.data;
const tours = enShell.settings.tours;

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

const recycled = {
  id: "123-0-paper",
  project_id: "paper",
  name: "Research paper",
  deleted_at: 1_700_000_000,
  size_bytes: 8,
};

const project = {
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
  recovery_pending: false,
};

function openSettings(section: string) {
  useSettingsStore.setState({
    settingsOpen: true,
    settingsInitialSection: section,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  mocks.libraryRoot.mockResolvedValue("/tmp/.oleafly/projects");
  mocks.libraryStorageSummary.mockResolvedValue(storageSummary);
  mocks.listRecycledProjects.mockResolvedValue([recycled]);
  mocks.restoreRecycledProject.mockResolvedValue("paper");
  mocks.permanentlyDeleteRecycledProject.mockResolvedValue(undefined);
  mocks.recycleProject.mockResolvedValue(undefined);
  mocks.refreshProjects.mockResolvedValue(undefined);
  mocks.closeProject.mockResolvedValue(undefined);
  mocks.getConfig.mockResolvedValue({
    checkpoints_enabled: true,
    checkpoint_notifications: true,
  });
  mocks.setConfig.mockResolvedValue(undefined);
  useFilesStore.setState({
    projectId: null,
    projects: [project],
    refreshProjects: mocks.refreshProjects,
    closeProject: mocks.closeProject,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useGithubStore.setState({ status: "disconnected", user: null });
  useTourStore.getState().resetAll();
  useTourStore.setState({ activeTourId: null });
});

describe("Settings recycle bin failures", () => {
  it("reports a restore that failed", async () => {
    mocks.restoreRecycledProject.mockRejectedValue(new Error("locked"));
    openSettings("data");
    render(<SettingsModal />);
    await screen.findByText(recycled.name);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "restore recycled project",
        expect.anything(),
        data.recycleBin.restoreFailed.replace("{{name}}", recycled.name),
      ),
    );
  });

  it("reports a permanent deletion that failed", async () => {
    mocks.permanentlyDeleteRecycledProject.mockRejectedValue(new Error("busy"));
    openSettings("data");
    render(<SettingsModal />);
    await screen.findByText(recycled.name);
    fireEvent.click(
      screen.getByRole("button", {
        name: data.recycleBin.deleteOne.replace("{{name}}", recycled.name),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: data.recycleBin.confirmDeleteAction }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "permanently delete recycled project",
        expect.anything(),
        data.recycleBin.deleteFailed.replace("{{name}}", recycled.name),
      ),
    );
  });

  it("reports a clear that failed before the first deletion", async () => {
    mocks.permanentlyDeleteRecycledProject.mockRejectedValue(new Error("busy"));
    openSettings("data");
    render(<SettingsModal />);
    await screen.findByText(recycled.name);
    fireEvent.click(screen.getByRole("button", { name: data.recycleBin.clearAll }));
    fireEvent.click(
      screen.getByRole("button", { name: data.recycleBin.confirmClearAction }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "clear recycle bin",
        expect.anything(),
        data.recycleBin.clearFailed,
      ),
    );
  });

  it("reports a clear that stopped part way", async () => {
    mocks.listRecycledProjects.mockResolvedValue([
      recycled,
      { ...recycled, id: "124-0-notes", name: "Research notes" },
    ]);
    mocks.permanentlyDeleteRecycledProject
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("busy"));
    openSettings("data");
    render(<SettingsModal />);
    await screen.findByText(recycled.name);
    fireEvent.click(screen.getByRole("button", { name: data.recycleBin.clearAll }));
    fireEvent.click(
      screen.getByRole("button", { name: data.recycleBin.confirmClearAction }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "clear recycle bin",
        expect.anything(),
        data.recycleBin.clearPartial.replace("{{count}}", "1"),
      ),
    );
  });

  it("reports a bulk recycle that failed", async () => {
    mocks.recycleProject.mockRejectedValue(new Error("busy"));
    openSettings("data");
    render(<SettingsModal />);
    await screen.findByRole("heading", { name: data.danger.title });
    fireEvent.click(screen.getByRole("button", { name: data.danger.deleteAllAction }));
    fireEvent.click(
      screen.getByRole("button", { name: data.danger.confirmDeleteAllAction }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "move all projects to recycle bin",
        expect.anything(),
        data.danger.moveFailed,
      ),
    );
  });
});

describe("Settings tour guides", () => {
  it("lists every tour with its status and toggles one off", async () => {
    openSettings("general");
    render(<SettingsModal />);
    fireEvent.click(
      await screen.findByRole("button", { expanded: false, name: new RegExp(tours.enable) }),
    );
    for (const id of TOUR_IDS) {
      const name = resolveTourText(tourRegistry[id].label);
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
      expect(
        screen.getByLabelText(tours.enableOne.replace("{{name}}", name)),
      ).toHaveAttribute("aria-checked", "true");
    }
    const first = resolveTourText(tourRegistry[TOUR_IDS[0]].label);
    fireEvent.click(
      screen.getByLabelText(tours.enableOne.replace("{{name}}", first)),
    );
    await waitFor(() =>
      expect(useTourStore.getState().tours[TOUR_IDS[0]].status).not.toBe(
        "pending",
      ),
    );
  });

  it("summarizes the progress across the tours", async () => {
    openSettings("general");
    render(<SettingsModal />);
    fireEvent.click(
      await screen.findByRole("button", { expanded: false, name: new RegExp(tours.enable) }),
    );
    expect(screen.getByText(tours.progress)).toBeInTheDocument();
    expect(
      screen.getByText(
        tours.progressDetail
          .replace("{{completed}}", "0")
          .replace("{{dismissed}}", "0"),
      ),
    ).toBeInTheDocument();
  });

  it("confirms before turning every tour off", async () => {
    openSettings("general");
    render(<SettingsModal />);
    const toggle = await screen.findByLabelText(tours.enableAll);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(
      await screen.findByRole("button", { name: tours.disableConfirm }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: tours.disableConfirm }));
    await waitFor(() =>
      expect(screen.getByLabelText(tours.enableAll)).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
  });

  it("restarts the tours when they are turned back on", async () => {
    for (const id of TOUR_IDS) {
      useTourStore.getState().setTourEnabled(id, false);
    }
    openSettings("general");
    render(<SettingsModal />);
    const toggle = await screen.findByLabelText(tours.enableAll);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(useSettingsStore.getState().settingsOpen).toBe(false));
  });
});
