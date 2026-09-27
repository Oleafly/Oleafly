// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  libraryRoot: vi.fn(),
  listProjects: vi.fn(),
  recycleProject: vi.fn(),
  closeProject: vi.fn(),
  refreshProjects: vi.fn(),
  notifyError: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  libraryRoot: mocks.libraryRoot,
  listProjects: mocks.listProjects,
  recycleProject: mocks.recycleProject,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error, info: vi.fn() },
  notifyError: mocks.notifyError,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { DeveloperSettings } from "./DeveloperSettings";

const developer = enCore.developer;
const SANDBOX = "/Users/researcher/.oleafly-dev/projects";

function confirmClearProjects() {
  fireEvent.click(
    screen.getByRole("button", { name: developer.actions.clearProjects.title }),
  );
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: developer.confirm.clearProjects.action,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.libraryRoot.mockResolvedValue(SANDBOX);
  mocks.listProjects.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  mocks.recycleProject.mockResolvedValue(undefined);
  mocks.closeProject.mockResolvedValue(undefined);
  mocks.refreshProjects.mockResolvedValue(undefined);
  useFilesStore.setState({
    projectId: null,
    closeProject: mocks.closeProject,
    refreshProjects: mocks.refreshProjects,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
});

describe("DeveloperSettings project actions", () => {
  it("moves every development project to the Recycle Bin with one notice", async () => {
    render(<DeveloperSettings />);
    await screen.findByText(SANDBOX);
    confirmClearProjects();

    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        i18n.t(($) => $.core.developer.projectsRecycled, { count: 2 }),
      ),
    );
    expect(mocks.recycleProject).toHaveBeenCalledTimes(2);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("leaves folders opened in place out of the development reset", async () => {
    mocks.listProjects.mockResolvedValue([
      { id: "a" },
      {
        id: "linked-0123456789abcdef0123456789abcdef",
        location: { kind: "linked", display_path: "~/thesis", availability: "unknown" },
      },
    ]);
    render(<DeveloperSettings />);
    await screen.findByText(SANDBOX);
    confirmClearProjects();

    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        i18n.t(($) => $.core.developer.projectsRecycled, { count: 1 }),
      ),
    );
    expect(mocks.recycleProject).toHaveBeenCalledTimes(1);
    expect(mocks.recycleProject).toHaveBeenCalledWith("a");
  });

  it("adds no error of its own when the open project could not close", async () => {
    useFilesStore.setState({ projectId: "open-paper" });
    render(<DeveloperSettings />);
    await screen.findByText(SANDBOX);
    confirmClearProjects();

    await waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith(
        "reset development data",
        expect.any(String),
      ),
    );
    expect(mocks.closeProject).toHaveBeenCalledOnce();
    expect(mocks.listProjects).not.toHaveBeenCalled();
    expect(mocks.recycleProject).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: developer.actions.clearProjects.title }),
      ).toBeEnabled(),
    );
  });

  it("stops the first-run replay quietly when the open project could not close", async () => {
    useFilesStore.setState({ projectId: "open-paper" });
    render(<DeveloperSettings />);
    await screen.findByText(SANDBOX);
    const replay = screen.getByRole("button", {
      name: developer.actions.replayFirstRun.title,
    });
    fireEvent.click(replay);

    await waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith("replay first run", expect.any(String)),
    );
    expect(mocks.notifyError).not.toHaveBeenCalled();
    await waitFor(() => expect(replay).toBeEnabled());
  });

  it("reports a recycle failure once after the project closed", async () => {
    const failure = new Error("busy");
    mocks.recycleProject.mockRejectedValue(failure);
    render(<DeveloperSettings />);
    await screen.findByText(SANDBOX);
    confirmClearProjects();

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "reset development data",
        failure,
        developer.resetFailed,
      ),
    );
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
