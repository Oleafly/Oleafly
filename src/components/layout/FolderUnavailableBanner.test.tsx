// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  locateProjectFolder: vi.fn(),
  adoptReplacedFolder: vi.fn(),
  saveOpenBuffersCopy: vi.fn(),
  revealInDir: vi.fn(async () => {}),
  recheckProjectAvailability: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
  notifyError: vi.fn(),
  collectOpenBuffersForCopy: vi.fn(() => [{ path: "main.tex", content: "typed\n" }]),
}));

vi.mock("@/lib/tauri", () => ({
  locateProjectFolder: mocks.locateProjectFolder,
  adoptReplacedFolder: mocks.adoptReplacedFolder,
  saveOpenBuffersCopy: mocks.saveOpenBuffersCopy,
  revealInDir: mocks.revealInDir,
}));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { success: mocks.toastSuccess },
}));
vi.mock("./ProjectAvailabilityKeeper", () => ({
  recheckProjectAvailability: mocks.recheckProjectAvailability,
}));
vi.mock("@/store/files", () => ({
  useFilesStore: (selector: (state: unknown) => unknown) =>
    selector({ projectName: "Thesis", files: { "main.tex": { content: "typed\n", dirty: true } } }),
  collectOpenBuffersForCopy: mocks.collectOpenBuffersForCopy,
}));

import { useProjectAvailabilityStore } from "@/store/project-availability";
import { FolderUnavailableBanner } from "./FolderUnavailableBanner";

const labels = enShell.folderUnavailable;

function show(availability: "missing" | "offline" | "replaced" | "permission_denied") {
  act(() => {
    useProjectAvailabilityStore.getState().report("linked-a", availability);
  });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockClear();
  mocks.locateProjectFolder.mockResolvedValue("rebound");
  mocks.adoptReplacedFolder.mockResolvedValue("rebound");
  mocks.saveOpenBuffersCopy.mockResolvedValue({ folder: "/Users/ada/Desktop/Thesis copy", written: 1 });
  useProjectAvailabilityStore.getState().reset("linked-a");
});

afterEach(() => {
  useProjectAvailabilityStore.getState().reset(null);
});

describe("FolderUnavailableBanner", () => {
  it("stays hidden while the folder is available", () => {
    render(<FolderUnavailableBanner />);
    expect(screen.queryByTestId("folder-unavailable-banner")).not.toBeInTheDocument();
  });

  it("offers Locate and Try again for a missing folder, and nothing for a replaced one", async () => {
    render(<FolderUnavailableBanner />);
    show("missing");
    expect(screen.getByText(labels.missing.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: labels.useThisFolder })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: labels.locate }));
    await waitFor(() => expect(mocks.locateProjectFolder).toHaveBeenCalledWith("linked-a"));
    fireEvent.click(screen.getByRole("button", { name: labels.tryAgain }));
    await waitFor(() => expect(mocks.recheckProjectAvailability).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("uses the missing copy for a drive that does not answer", () => {
    render(<FolderUnavailableBanner />);
    show("offline");
    expect(screen.getByText(labels.missing.title)).toBeInTheDocument();
  });

  it("lets the user adopt a replaced folder and does not offer Try again", async () => {
    render(<FolderUnavailableBanner />);
    show("replaced");
    expect(screen.getByText(labels.replaced.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: labels.tryAgain })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: labels.useThisFolder }));
    await waitFor(() => expect(mocks.adoptReplacedFolder).toHaveBeenCalledWith("linked-a"));
  });

  it("does not offer Locate when permission is denied", () => {
    render(<FolderUnavailableBanner />);
    show("permission_denied");
    expect(screen.getByText(labels.permissionDenied.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: labels.locate })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: labels.tryAgain })).toBeInTheDocument();
  });

  it("saves a copy of the open files and offers to show it", async () => {
    render(<FolderUnavailableBanner />);
    show("missing");
    fireEvent.click(screen.getByRole("button", { name: labels.saveCopy }));
    await waitFor(() =>
      expect(mocks.saveOpenBuffersCopy).toHaveBeenCalledWith("linked-a", "Thesis", [
        { path: "main.tex", content: "typed\n" },
      ]),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    const [message, action] = mocks.toastSuccess.mock.calls[0] as [
      string,
      { label: string; onClick: () => void },
    ];
    expect(message).toContain("/Users/ada/Desktop/Thesis copy");
    expect(action.label).toBe(enCore.export.showInFolder);
    action.onClick();
    expect(mocks.revealInDir).toHaveBeenCalledWith("/Users/ada/Desktop/Thesis copy");
  });

  it("stays quiet when the folder picker is cancelled", async () => {
    mocks.saveOpenBuffersCopy.mockResolvedValue(null);
    render(<FolderUnavailableBanner />);
    show("missing");
    fireEvent.click(screen.getByRole("button", { name: labels.saveCopy }));
    await waitFor(() => expect(mocks.saveOpenBuffersCopy).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports a failed action once and shows no success", async () => {
    mocks.locateProjectFolder.mockRejectedValue(new Error("refused"));
    render(<FolderUnavailableBanner />);
    show("missing");
    fireEvent.click(screen.getByRole("button", { name: labels.locate }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: labels.locate })).not.toBeDisabled(),
    );
  });
});
