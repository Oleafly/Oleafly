import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NotebookInstallProgress,
  NotebookToolchainStatus,
  NotebookToolStatus,
} from "@/lib/notebook-commands";

const mocks = vi.hoisted(() => ({
  notebookToolchainStatus: vi.fn(),
  installNotebookTool: vi.fn(),
  removeNotebookTool: vi.fn(),
  errorUnique: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/notebook-commands", () => ({
  notebookToolchainStatus: mocks.notebookToolchainStatus,
  installNotebookTool: mocks.installNotebookTool,
  removeNotebookTool: mocks.removeNotebookTool,
}));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: mocks.errorUnique } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { useSettingsStore } from "@/store/settings";
import {
  CALEPIN_SETTINGS_TARGET,
  QUARTO_SETTINGS_TARGET,
  notebookInstallLabel,
  notebookInstallPercent,
  notebookToolBusy,
  notebookToolForSettingsTarget,
  openNotebookToolSettings,
  useNotebookToolchainStore,
} from "./notebook-toolchain";

const copy = enSettings.engine.notebook;

function tool(name: "quarto" | "calepin", over: Partial<NotebookToolStatus> = {}): NotebookToolStatus {
  return {
    tool: name,
    pinnedVersion: name === "quarto" ? "1.10.19" : "0.0.61",
    active: null,
    system: null,
    managed: null,
    offered: true,
    downloadBytes: 120_000_000,
    license: "MIT",
    installing: false,
    ...over,
  };
}

function status(
  quarto: Partial<NotebookToolStatus> = {},
  calepin: Partial<NotebookToolStatus> = {},
): NotebookToolchainStatus {
  return {
    quarto: tool("quarto", quarto),
    calepin: tool("calepin", calepin),
    runtimes: [
      { name: "r", path: "/usr/local/bin/R", version: "4.5.1" },
      { name: "python", path: null, version: null },
      { name: "julia", path: null, version: null },
    ],
  };
}

const managedQuarto = { path: "/Users/ada/.oleafly/tools/quarto/bin/quarto", version: "1.10.19", source: "managed" as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  useNotebookToolchainStore.setState({
    status: null,
    loading: false,
    loadFailed: false,
    installs: {},
    removing: null,
  });
});

describe("notebook toolchain status", () => {
  it("loads the status once for concurrent callers", async () => {
    const pending = deferred<NotebookToolchainStatus>();
    mocks.notebookToolchainStatus.mockReturnValue(pending.promise);
    const store = useNotebookToolchainStore.getState();
    const first = store.refresh();
    const second = store.ensureLoaded();
    expect(useNotebookToolchainStore.getState().loading).toBe(true);
    pending.resolve(status());
    await Promise.all([first, second]);
    expect(mocks.notebookToolchainStatus).toHaveBeenCalledOnce();
    expect(useNotebookToolchainStore.getState()).toMatchObject({ status: status(), loading: false, loadFailed: false });
  });

  it("does not ask again once the status is loaded", async () => {
    useNotebookToolchainStore.setState({ status: status() });
    await useNotebookToolchainStore.getState().ensureLoaded();
    expect(mocks.notebookToolchainStatus).not.toHaveBeenCalled();
  });

  it("marks a failed read without a toast", async () => {
    mocks.notebookToolchainStatus.mockRejectedValue(new Error("probe failed"));
    await expect(useNotebookToolchainStore.getState().refresh()).resolves.toBeNull();
    expect(useNotebookToolchainStore.getState()).toMatchObject({ status: null, loadFailed: true, loading: false });
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledOnce();
  });
});

describe("installing a notebook tool", () => {
  it("reports each phase and applies the status the install returns", async () => {
    const pending = deferred<NotebookToolchainStatus>();
    let report: (progress: NotebookInstallProgress) => void = () => {};
    mocks.installNotebookTool.mockImplementation(
      (_tool: string, onProgress: (progress: NotebookInstallProgress) => void) => {
        report = onProgress;
        return pending.promise;
      },
    );
    const installing = useNotebookToolchainStore.getState().install("quarto");
    const current = () => {
      const install = useNotebookToolchainStore.getState().installs.quarto;
      if (!install) throw new Error("no Quarto install is running");
      return install;
    };
    expect(notebookInstallLabel(current())).toBe(copy.progress.starting);
    report({ tool: "quarto", phase: "downloading", receivedBytes: 30, totalBytes: 120 });
    expect(notebookInstallLabel(current())).toBe(copy.progress.downloading.replace("{{percent}}", "25"));
    report({ tool: "calepin", phase: "extracting", receivedBytes: 1, totalBytes: 1 });
    expect(current().phase).toBe("downloading");
    report({ tool: "quarto", phase: "verifying", receivedBytes: 120, totalBytes: 120 });
    expect(notebookInstallLabel(current())).toBe(copy.progress.verifying);
    report({ tool: "quarto", phase: "extracting", receivedBytes: 120, totalBytes: 120 });
    expect(notebookInstallLabel(current())).toBe(copy.progress.extracting);
    const installed = status({ managed: managedQuarto, active: managedQuarto });
    pending.resolve(installed);
    await expect(installing).resolves.toBe(true);
    expect(mocks.installNotebookTool).toHaveBeenCalledWith("quarto", expect.any(Function));
    expect(useNotebookToolchainStore.getState()).toMatchObject({ status: installed, installs: {} });
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("runs one install per tool and lets the other tool install alongside", async () => {
    const quarto = deferred<NotebookToolchainStatus>();
    const calepin = deferred<NotebookToolchainStatus>();
    mocks.installNotebookTool.mockImplementation((name: string) => (name === "quarto" ? quarto.promise : calepin.promise));
    const first = useNotebookToolchainStore.getState().install("quarto");
    await expect(useNotebookToolchainStore.getState().install("quarto")).resolves.toBe(false);
    const second = useNotebookToolchainStore.getState().install("calepin");
    expect(Object.keys(useNotebookToolchainStore.getState().installs).sort()).toEqual(["calepin", "quarto"]);
    quarto.resolve(status());
    calepin.resolve(status());
    await Promise.all([first, second]);
    expect(mocks.installNotebookTool).toHaveBeenCalledTimes(2);
    expect(useNotebookToolchainStore.getState().installs).toEqual({});
  });

  it("does not start while the backend reports the tool installing", async () => {
    useNotebookToolchainStore.setState({ status: status({ installing: true }) });
    await expect(useNotebookToolchainStore.getState().install("quarto")).resolves.toBe(false);
    expect(mocks.installNotebookTool).not.toHaveBeenCalled();
  });

  it("reports a failed install once with the backend reason and reads the status again", async () => {
    mocks.installNotebookTool.mockRejectedValue(
      `${APP_ERROR_PREFIX}${JSON.stringify({ code: "notebook.install_unverified", params: { tool: "Quarto" }, detail: null })}`,
    );
    mocks.notebookToolchainStatus.mockResolvedValue(status());
    await expect(useNotebookToolchainStore.getState().install("quarto")).resolves.toBe(false);
    expect(useNotebookToolchainStore.getState().installs).toEqual({});
    expect(mocks.errorUnique).toHaveBeenCalledOnce();
    const [key, message] = mocks.errorUnique.mock.calls[0];
    expect(key).toBe("notebook-toolchain:quarto");
    expect(message).toContain(copy.error.install.replace("{{tool}}", "Quarto"));
    expect(message).toContain("integrity check");
    await vi.waitFor(() => expect(mocks.notebookToolchainStatus).toHaveBeenCalledOnce());
  });
});

describe("removing a notebook tool", () => {
  it("removes the managed copy and applies the new status", async () => {
    useNotebookToolchainStore.setState({ status: status({ managed: managedQuarto, active: managedQuarto }) });
    const removed = status();
    mocks.removeNotebookTool.mockResolvedValue(removed);
    await expect(useNotebookToolchainStore.getState().remove("quarto")).resolves.toBe(true);
    expect(mocks.removeNotebookTool).toHaveBeenCalledExactlyOnceWith("quarto");
    expect(useNotebookToolchainStore.getState()).toMatchObject({ status: removed, removing: null });
  });

  it("does not remove a tool while it installs", async () => {
    useNotebookToolchainStore.setState({
      installs: { calepin: { tool: "calepin", phase: "downloading", receivedBytes: 1, totalBytes: 2 } },
    });
    await expect(useNotebookToolchainStore.getState().remove("calepin")).resolves.toBe(false);
    expect(mocks.removeNotebookTool).not.toHaveBeenCalled();
  });

  it("reports a failed removal once and reads the status again", async () => {
    mocks.removeNotebookTool.mockRejectedValue(new Error("file in use"));
    mocks.notebookToolchainStatus.mockResolvedValue(status());
    await expect(useNotebookToolchainStore.getState().remove("calepin")).resolves.toBe(false);
    expect(mocks.errorUnique).toHaveBeenCalledOnce();
    expect(mocks.errorUnique.mock.calls[0][1]).toContain(copy.error.remove.replace("{{tool}}", "Calepin"));
    expect(mocks.errorUnique.mock.calls[0][1]).toContain("file in use");
    expect(useNotebookToolchainStore.getState().removing).toBeNull();
  });
});

describe("notebook toolchain helpers", () => {
  it("turns bytes into a whole percent and has none before the size is known", () => {
    expect(notebookInstallPercent({ receivedBytes: 1, totalBytes: 3 })).toBe(33);
    expect(notebookInstallPercent({ receivedBytes: 5, totalBytes: 4 })).toBe(100);
    expect(notebookInstallPercent({ receivedBytes: 5, totalBytes: 0 })).toBeNull();
  });

  it("counts an install, a removal or a backend install as busy for that tool only", () => {
    const install = { tool: "quarto" as const, phase: "starting" as const, receivedBytes: 0, totalBytes: 0 };
    expect(notebookToolBusy("quarto", { quarto: install }, null)).toBe(true);
    expect(notebookToolBusy("calepin", { quarto: install }, null)).toBe(false);
    expect(notebookToolBusy("calepin", {}, status({}, { installing: true }))).toBe(true);
    expect(notebookToolBusy("quarto", {}, status(), "quarto")).toBe(true);
    expect(notebookToolBusy("quarto", {}, status())).toBe(false);
  });

  it("opens Settings on the tab for each tool", () => {
    useSettingsStore.setState({ settingsOpen: false, settingsScrollTarget: null });
    openNotebookToolSettings("calepin");
    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "engine",
      settingsScrollTarget: CALEPIN_SETTINGS_TARGET,
    });
    expect(notebookToolForSettingsTarget(CALEPIN_SETTINGS_TARGET)).toBe("calepin");
    expect(notebookToolForSettingsTarget(QUARTO_SETTINGS_TARGET)).toBe("quarto");
    expect(notebookToolForSettingsTarget("typst-versions")).toBeNull();
    expect(notebookToolForSettingsTarget(null)).toBeNull();
  });
});
