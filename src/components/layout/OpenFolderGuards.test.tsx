// @vitest-environment jsdom
import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
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

  it("names what will stop and resolves the prompt with the choice", async () => {
    const user = userEvent.setup();
    render(<OpenFolderStopDialog />);
    let choice: Promise<boolean> | undefined;
    act(() => {
      choice = useOpenFolderFlowStore
        .getState()
        .ask({ name: "notes", project: "Thesis", compile: true, assistant: false });
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Stop and open notes?");
    expect(dialog).toHaveTextContent(
      "Thesis is still compiling. Opening notes stops the compile. Your changes are saved first.",
    );
    await user.click(screen.getByRole("button", { name: new RegExp(`^${enShell.openFolder.confirmAction}`) }));
    await expect(choice).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("explains an assistant reply, or both, and backs out on cancel", async () => {
    const user = userEvent.setup();
    render(<OpenFolderStopDialog />);
    let choice: Promise<boolean> | undefined;
    act(() => {
      choice = useOpenFolderFlowStore
        .getState()
        .ask({ name: "notes", project: "Thesis", compile: false, assistant: true });
    });
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "The assistant is still working in Thesis. Opening notes stops its reply.",
    );
    act(() => {
      useOpenFolderFlowStore.setState({
        prompt: { name: "notes", project: "Thesis", compile: true, assistant: true },
      });
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Thesis is still compiling and the assistant is still working. Opening notes stops both.",
    );
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Cancel/ }));
    await expect(choice).resolves.toBe(false);
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
