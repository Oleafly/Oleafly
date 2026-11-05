// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.events.set(name, handler);
    return () => mocks.events.delete(name);
  }),
  isTauri: vi.fn(() => true),
  confirmQuitDuringInstall: vi.fn(async () => {}),
  cancelQuitFlush: vi.fn(async () => {}),
  typstToolchainStatus: vi.fn(async () => null as unknown),
  notifyError: vi.fn(),
  cancelTinytexInstall: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@/lib/tauri", () => ({
  confirmQuitDuringInstall: mocks.confirmQuitDuringInstall,
  cancelQuitFlush: mocks.cancelQuitFlush,
  typstToolchainStatus: mocks.typstToolchainStatus,
  cancelTinytexInstall: mocks.cancelTinytexInstall,
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { TinytexGuards } from "./TinytexGuards";
import { useEngineStore } from "@/store/engine";
import { useTypstToolchainStore } from "@/store/typst-toolchain";

beforeEach(() => {
  mocks.events.clear();
  mocks.listen.mockClear();
  mocks.confirmQuitDuringInstall.mockClear();
  mocks.cancelQuitFlush.mockClear();
  mocks.notifyError.mockClear();
  mocks.typstToolchainStatus.mockReset();
  mocks.typstToolchainStatus.mockResolvedValue(null);
  useTypstToolchainStore.setState({ status: null, install: null, loading: false, loadFailed: false });
  useEngineStore.setState({
    installing: true,
    packageOperations: 0,
    installWaitNoticeOpen: false,
    installWaitNoticeShown: false,
    compileQueuedDuringInstall: false,
  });
});

describe("TinytexGuards wait notice", () => {
  it("lets the user stop the install from the notice", async () => {
    mocks.cancelTinytexInstall.mockClear();
    useEngineStore.setState({
      installWaitNoticeOpen: true,
      installPhase: "download",
      cancellingInstall: false,
    });
    render(<TinytexGuards />);
    fireEvent.click(await screen.findByRole("button", { name: enShell.tinytexGuards.wait.stop }));
    await waitFor(() => expect(mocks.cancelTinytexInstall).toHaveBeenCalledOnce());
    useEngineStore.setState({ cancellingInstall: false });
  });

  it("hides the stop button once TinyTeX is already in place", async () => {
    useEngineStore.setState({ installWaitNoticeOpen: true, installPhase: "packages" });
    render(<TinytexGuards />);
    await screen.findByText(enShell.tinytexGuards.wait.title);
    expect(screen.queryByRole("button", { name: enShell.tinytexGuards.wait.stop })).toBeNull();
  });
});

describe("TinytexGuards quit interception", () => {
  it("re-arms the quit flush gate when the install finishes while the dialog is up", async () => {
    render(<TinytexGuards />);
    await waitFor(() => expect(mocks.events.has("tinytex-quit-blocked")).toBe(true));
    act(() => {
      mocks.events.get("tinytex-quit-blocked")?.({ payload: undefined });
    });
    await screen.findByText(/still installing/i);

    act(() => {
      useEngineStore.setState({ installing: false });
    });

    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/still installing/i)).toBeNull();
  });

  it("re-arms the quit flush gate when the user cancels the dialog", async () => {
    render(<TinytexGuards />);
    await waitFor(() => expect(mocks.events.has("tinytex-quit-blocked")).toBe(true));
    act(() => {
      mocks.events.get("tinytex-quit-blocked")?.({ payload: undefined });
    });
    await screen.findByText(/still installing/i);

    const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
  });
});

describe("TinytexGuards quit during a package change", () => {
  it("asks before quitting while TeX packages are being installed", async () => {
    useEngineStore.setState({ installing: false, packageOperations: 1 });
    render(<TinytexGuards />);
    await waitFor(() => expect(mocks.events.has("tinytex-quit-blocked")).toBe(true));
    act(() => {
      mocks.events.get("tinytex-quit-blocked")?.({ payload: undefined });
    });
    await screen.findByText(enShell.tinytexGuards.packageQuit.title);
    expect(mocks.cancelQuitFlush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: enShell.tinytexGuards.quit.confirm }));
    await waitFor(() => expect(mocks.confirmQuitDuringInstall).toHaveBeenCalledOnce());
  });

  it("re-arms the quit gate once the package change ends", async () => {
    useEngineStore.setState({ installing: false, packageOperations: 1 });
    render(<TinytexGuards />);
    await waitFor(() => expect(mocks.events.has("tinytex-quit-blocked")).toBe(true));
    act(() => {
      mocks.events.get("tinytex-quit-blocked")?.({ payload: undefined });
    });
    await screen.findByText(enShell.tinytexGuards.packageQuit.title);

    act(() => {
      useEngineStore.setState({ packageOperations: 0 });
    });

    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(enShell.tinytexGuards.packageQuit.title)).toBeNull();
  });
});

describe("TinytexGuards compile queued during an install", () => {
  it("shows the queued compile notice once per install", async () => {
    render(<TinytexGuards />);
    act(() => {
      useEngineStore.getState().queueCompileAfterInstall();
    });
    await screen.findByText(enShell.tinytexGuards.wait.title);
    fireEvent.click(screen.getByRole("button", { name: /^OK/ }));
    await waitFor(() =>
      expect(screen.queryByText(enShell.tinytexGuards.wait.title)).toBeNull(),
    );
    act(() => {
      for (let attempt = 0; attempt < 5; attempt++) {
        useEngineStore.getState().queueCompileAfterInstall();
      }
    });
    expect(screen.queryByText(enShell.tinytexGuards.wait.title)).toBeNull();
    expect(useEngineStore.getState().compileQueuedDuringInstall).toBe(true);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });
});

describe("TinytexGuards quit failure", () => {
  it("reports a quit that failed after the user confirmed it", async () => {
    const error = new Error("still running");
    mocks.confirmQuitDuringInstall.mockRejectedValueOnce(error);
    render(<TinytexGuards />);
    await waitFor(() => expect(mocks.events.has("tinytex-quit-blocked")).toBe(true));
    act(() => {
      mocks.events.get("tinytex-quit-blocked")?.({ payload: undefined });
    });
    await screen.findByText(/still installing/i);
    fireEvent.click(screen.getByRole("button", { name: enShell.tinytexGuards.quit.confirm }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledExactlyOnceWith("quit during install", error),
    );
  });
});

function typstStatus(installing: string | null) {
  return {
    bundledVersion: "0.15.1",
    defaultVersion: "0.15.1",
    defaultChoice: null,
    system: null,
    installing,
    versions: [],
  };
}

async function blockQuit() {
  render(<TinytexGuards />);
  await waitFor(() => expect(mocks.events.has("tinytex-quit-blocked")).toBe(true));
  act(() => {
    mocks.events.get("tinytex-quit-blocked")?.({ payload: undefined });
  });
}

describe("TinytexGuards during a Typst install", () => {
  beforeEach(() => {
    useEngineStore.setState({ installing: false });
  });

  it("asks before quitting while this window installs a Typst version", async () => {
    useTypstToolchainStore.setState({
      install: { version: "0.13.1", phase: "downloading", receivedBytes: 10, totalBytes: 100 },
    });
    await blockQuit();
    await screen.findByText(enShell.tinytexGuards.typstQuit.title);
    expect(screen.getByText(/Typst 0\.13\.1 is downloading/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enShell.tinytexGuards.quit.confirm }));
    await waitFor(() => expect(mocks.confirmQuitDuringInstall).toHaveBeenCalledTimes(1));
  });

  it("learns about an install started in another window before asking", async () => {
    mocks.typstToolchainStatus.mockResolvedValue(typstStatus("0.14.2"));
    await blockQuit();
    await screen.findByText(enShell.tinytexGuards.typstQuit.title);
    expect(screen.getByText(/Typst 0\.14\.2 is downloading/)).toBeInTheDocument();
    expect(mocks.typstToolchainStatus).toHaveBeenCalledTimes(1);
  });

  it("stops asking and re-arms the quit flush once no install is running", async () => {
    mocks.typstToolchainStatus.mockResolvedValue(typstStatus(null));
    await blockQuit();
    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(enShell.tinytexGuards.typstQuit.title)).toBeNull();
  });

  it("closes the question when the Typst install finishes", async () => {
    useTypstToolchainStore.setState({
      install: { version: "0.13.1", phase: "extracting", receivedBytes: 100, totalBytes: 100 },
    });
    await blockQuit();
    await screen.findByText(enShell.tinytexGuards.typstQuit.title);
    act(() => {
      useTypstToolchainStore.setState({ install: null });
    });
    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(enShell.tinytexGuards.typstQuit.title)).toBeNull();
  });
});
