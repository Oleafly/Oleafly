// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";
import { useTourStore } from "@/store/tours";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  startOpenRequestIntake: vi.fn(),
  startRecentProjectsMenuSync: vi.fn(),
  openFolderWithPicker: vi.fn(),
  stopIntake: vi.fn(),
  stopRecent: vi.fn(),
  releaseBootSplash: vi.fn(),
  usesNativeDockMenu: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: mocks.isTauri,
}));
vi.mock("@/features/open-folder", () => ({
  startOpenRequestIntake: mocks.startOpenRequestIntake,
  startRecentProjectsMenuSync: mocks.startRecentProjectsMenuSync,
  openFolderWithPicker: mocks.openFolderWithPicker,
}));
vi.mock("@/lib/boot-telemetry", () => ({ releaseBootSplash: mocks.releaseBootSplash }));
vi.mock("@/lib/native-dock-shortcuts", () => ({ usesNativeDockMenu: mocks.usesNativeDockMenu }));

import { OpenFolderStopDialog, useOpenFolderIntake } from "./OpenFolderGuards";

const apple = /Mac|iPhone|iPad/.test(navigator.platform);

function pressOpenFolder() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "O",
      shiftKey: true,
      metaKey: apple,
      ctrlKey: !apple,
      bubbles: true,
      cancelable: true,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.usesNativeDockMenu.mockReturnValue(false);
  mocks.startOpenRequestIntake.mockResolvedValue(mocks.stopIntake);
  mocks.startRecentProjectsMenuSync.mockReturnValue(mocks.stopRecent);
  mocks.openFolderWithPicker.mockResolvedValue("cancelled");
  useTourStore.setState({ activeTourId: null });
});

afterEach(() => {
  useOpenFolderFlowStore.setState({ prompt: null, refusal: null, opening: false });
});

describe("OpenFolderStopDialog", () => {
  it("stays hidden while nothing needs stopping", () => {
    render(<OpenFolderStopDialog />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("useOpenFolderIntake", () => {
  it("listens for folders, keeps Open Recent current and stops both on unmount", async () => {
    const { unmount } = renderHook(() => useOpenFolderIntake());
    await act(async () => {});
    expect(mocks.startOpenRequestIntake).toHaveBeenCalledTimes(1);
    expect(mocks.startRecentProjectsMenuSync).toHaveBeenCalledTimes(1);
    unmount();
    expect(mocks.stopIntake).toHaveBeenCalledTimes(1);
    expect(mocks.stopRecent).toHaveBeenCalledTimes(1);
  });

  it("lets the splash go outside the desktop app", () => {
    mocks.isTauri.mockReturnValue(false);
    renderHook(() => useOpenFolderIntake());
    expect(mocks.startOpenRequestIntake).not.toHaveBeenCalled();
    expect(mocks.releaseBootSplash).toHaveBeenCalledTimes(1);
  });

  it("opens the folder picker from the keyboard shortcut unless a tour is running", async () => {
    renderHook(() => useOpenFolderIntake());
    await act(async () => {});
    pressOpenFolder();
    expect(mocks.openFolderWithPicker).toHaveBeenCalledTimes(1);
    useTourStore.setState({ activeTourId: "home" });
    pressOpenFolder();
    expect(mocks.openFolderWithPicker).toHaveBeenCalledTimes(1);
  });

  it("leaves the shortcut to the File menu where the app has a native menu", async () => {
    mocks.usesNativeDockMenu.mockReturnValue(true);
    renderHook(() => useOpenFolderIntake());
    await act(async () => {});
    pressOpenFolder();
    expect(mocks.openFolderWithPicker).not.toHaveBeenCalled();
  });
});
