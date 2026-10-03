import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TypstInstallProgress, TypstToolchainStatus } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  typstToolchainStatus: vi.fn(),
  installTypstVersion: vi.fn(),
  removeTypstVersion: vi.fn(),
  setDefaultTypstVersion: vi.fn(),
  errorUnique: vi.fn(),
  logError: vi.fn(),
  files: {
    projectId: "p1" as string | null,
    engine: null as unknown,
    refreshEngine: vi.fn(async () => {}),
  },
}));

vi.mock("@/lib/tauri", () => ({
  typstToolchainStatus: mocks.typstToolchainStatus,
  installTypstVersion: mocks.installTypstVersion,
  removeTypstVersion: mocks.removeTypstVersion,
  setDefaultTypstVersion: mocks.setDefaultTypstVersion,
}));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: mocks.errorUnique } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useSettingsStore } from "@/store/settings";
import {
  TYPST_SETTINGS_TARGET,
  installedTypstVersions,
  openTypstVersionSettings,
  typstInstallLabel,
  useTypstToolchainStore,
} from "./typst-toolchain";

const copy = enSettings.engine.typst;

function status(over: Partial<TypstToolchainStatus> = {}): TypstToolchainStatus {
  return {
    bundledVersion: "0.15.1",
    defaultVersion: "0.15.1",
    defaultChoice: null,
    system: null,
    installing: null,
    versions: [
      { version: "0.15.1", releasedAt: "2026-08-01", inCatalog: true, sources: ["bundled"], downloadBytes: 10_000_000 },
      { version: "0.14.2", releasedAt: "2026-03-01", inCatalog: true, sources: [], downloadBytes: 9_000_000 },
      { version: "0.13.1", releasedAt: "2025-03-07", inCatalog: true, sources: ["downloaded"], downloadBytes: 8_000_000 },
    ],
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function currentInstall() {
  const install = useTypstToolchainStore.getState().install;
  if (!install) throw new Error("no install is running");
  return install;
}

const typstEngine = {
  ...LATEX_ENGINE,
  id: "typst" as const,
  label: "Typst",
  source_format: "typst" as const,
  typst_version: "0.14.2",
  typst_resolved: null,
  typst_missing: "0.14.2",
};

const refreshEngine = mocks.files.refreshEngine;

beforeEach(() => {
  vi.clearAllMocks();
  useTypstToolchainStore.setState({
    status: null,
    loading: false,
    loadFailed: false,
    install: null,
    busy: false,
  });
  mocks.files.projectId = "p1";
  mocks.files.engine = typstEngine;
});

describe("Typst toolchain status", () => {
  it("loads the status once for concurrent callers", async () => {
    const pending = deferred<TypstToolchainStatus>();
    mocks.typstToolchainStatus.mockReturnValue(pending.promise);
    const store = useTypstToolchainStore.getState();
    const first = store.refresh();
    const second = store.ensureLoaded();
    expect(useTypstToolchainStore.getState().loading).toBe(true);
    pending.resolve(status());
    await Promise.all([first, second]);
    expect(mocks.typstToolchainStatus).toHaveBeenCalledOnce();
    expect(useTypstToolchainStore.getState()).toMatchObject({
      status: status(),
      loading: false,
      loadFailed: false,
    });
  });

  it("does not ask again once the status is loaded", async () => {
    useTypstToolchainStore.setState({ status: status() });
    await useTypstToolchainStore.getState().ensureLoaded();
    expect(mocks.typstToolchainStatus).not.toHaveBeenCalled();
  });

  it("marks a failed read without a toast", async () => {
    mocks.typstToolchainStatus.mockRejectedValue(new Error("offline"));
    await useTypstToolchainStore.getState().refresh();
    expect(useTypstToolchainStore.getState()).toMatchObject({ status: null, loadFailed: true, loading: false });
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledOnce();
  });

  it("lists only installed versions, newest first", () => {
    expect(installedTypstVersions(status()).map((entry) => entry.version)).toEqual(["0.15.1", "0.13.1"]);
  });
});

describe("installing a Typst version", () => {
  it("reports progress, applies the new status and refreshes the open Typst project", async () => {
    const pending = deferred<TypstToolchainStatus>();
    let report: (progress: TypstInstallProgress) => void = () => {};
    mocks.installTypstVersion.mockImplementation(
      (_version: string, onProgress: (progress: TypstInstallProgress) => void) => {
        report = onProgress;
        return pending.promise;
      },
    );
    const installing = useTypstToolchainStore.getState().installVersion("0.14.2");
    expect(useTypstToolchainStore.getState().install).toMatchObject({ version: "0.14.2", phase: "starting" });
    report({ version: "0.14.2", phase: "downloading", receivedBytes: 45, totalBytes: 100 });
    expect(useTypstToolchainStore.getState().install).toMatchObject({ phase: "downloading", receivedBytes: 45 });
    expect(typstInstallLabel(currentInstall())).toBe(
      copy.progress.downloading.replace("{{percent}}", "45"),
    );
    report({ version: "0.14.2", phase: "verifying", receivedBytes: 100, totalBytes: 100 });
    expect(typstInstallLabel(currentInstall())).toBe(copy.progress.verifying);
    const installed = status({
      versions: status().versions.map((entry) =>
        entry.version === "0.14.2" ? { ...entry, sources: ["downloaded"] } : entry,
      ),
    });
    pending.resolve(installed);
    await expect(installing).resolves.toBe(true);
    expect(mocks.installTypstVersion).toHaveBeenCalledWith("0.14.2", expect.any(Function));
    expect(useTypstToolchainStore.getState()).toMatchObject({ status: installed, install: null });
    expect(refreshEngine).toHaveBeenCalledOnce();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("runs one install at a time", async () => {
    const pending = deferred<TypstToolchainStatus>();
    mocks.installTypstVersion.mockReturnValue(pending.promise);
    const first = useTypstToolchainStore.getState().installVersion("0.14.2");
    await expect(useTypstToolchainStore.getState().installVersion("0.13.1")).resolves.toBe(false);
    pending.resolve(status());
    await first;
    expect(mocks.installTypstVersion).toHaveBeenCalledOnce();
  });

  it("does not start while the backend reports another install", async () => {
    useTypstToolchainStore.setState({ status: status({ installing: "0.13.1" }) });
    await expect(useTypstToolchainStore.getState().installVersion("0.14.2")).resolves.toBe(false);
    expect(mocks.installTypstVersion).not.toHaveBeenCalled();
  });

  it("reports a failed install once and reads the status again", async () => {
    mocks.installTypstVersion.mockRejectedValue(new Error("checksum mismatch"));
    mocks.typstToolchainStatus.mockResolvedValue(status());
    await expect(useTypstToolchainStore.getState().installVersion("0.14.2")).resolves.toBe(false);
    expect(useTypstToolchainStore.getState().install).toBeNull();
    expect(mocks.errorUnique).toHaveBeenCalledOnce();
    expect(mocks.errorUnique.mock.calls[0][1]).toContain(copy.error.install.replace("{{version}}", "0.14.2"));
    expect(mocks.errorUnique.mock.calls[0][1]).toContain("checksum mismatch");
    await vi.waitFor(() => expect(mocks.typstToolchainStatus).toHaveBeenCalledOnce());
    expect(refreshEngine).not.toHaveBeenCalled();
  });

  it("leaves a LaTeX project's engine alone", async () => {
    mocks.files.engine = LATEX_ENGINE;
    mocks.installTypstVersion.mockResolvedValue(status());
    await useTypstToolchainStore.getState().installVersion("0.14.2");
    expect(refreshEngine).not.toHaveBeenCalled();
  });
});

describe("removing and choosing the default", () => {
  it("applies the status the backend returns after a removal", async () => {
    const removed = status({ versions: status().versions.slice(0, 2) });
    mocks.removeTypstVersion.mockResolvedValue(removed);
    await expect(useTypstToolchainStore.getState().removeVersion("0.13.1")).resolves.toBe(true);
    expect(mocks.removeTypstVersion).toHaveBeenCalledWith("0.13.1");
    expect(useTypstToolchainStore.getState()).toMatchObject({ status: removed, busy: false });
    expect(refreshEngine).toHaveBeenCalledOnce();
  });

  it("reports a refused removal", async () => {
    mocks.removeTypstVersion.mockRejectedValue(new Error("refused"));
    mocks.typstToolchainStatus.mockResolvedValue(status());
    await expect(useTypstToolchainStore.getState().removeVersion("0.13.1")).resolves.toBe(false);
    expect(mocks.errorUnique).toHaveBeenCalledOnce();
    expect(mocks.errorUnique.mock.calls[0][1]).toContain(copy.error.remove.replace("{{version}}", "0.13.1"));
    expect(useTypstToolchainStore.getState().busy).toBe(false);
  });

  it("sets the default version and follows the bundled one with null", async () => {
    mocks.setDefaultTypstVersion.mockResolvedValue(status({ defaultChoice: "0.13.1", defaultVersion: "0.13.1" }));
    await expect(useTypstToolchainStore.getState().setDefaultVersion("0.13.1")).resolves.toBe(true);
    expect(useTypstToolchainStore.getState().status?.defaultVersion).toBe("0.13.1");
    mocks.setDefaultTypstVersion.mockResolvedValue(status());
    await useTypstToolchainStore.getState().setDefaultVersion(null);
    expect(mocks.setDefaultTypstVersion).toHaveBeenLastCalledWith(null);
    expect(useTypstToolchainStore.getState().status?.defaultChoice).toBeNull();
  });

  it("reports a failed default change", async () => {
    mocks.setDefaultTypstVersion.mockRejectedValue(new Error("not installed"));
    mocks.typstToolchainStatus.mockResolvedValue(status());
    await expect(useTypstToolchainStore.getState().setDefaultVersion("0.14.2")).resolves.toBe(false);
    expect(mocks.errorUnique.mock.calls[0][1]).toContain(copy.error.default);
  });
});

describe("opening the Typst settings", () => {
  it("opens Settings on the Engines section with the Typst tab requested", () => {
    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null });
    openTypstVersionSettings();
    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "engine",
      settingsScrollTarget: TYPST_SETTINGS_TARGET,
    });
  });
});
