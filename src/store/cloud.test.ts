// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudProject, CloudState, SyncReport } from "@/lib/cloud";

const mocks = vi.hoisted(() => ({
  cloud: {
    cloudState: vi.fn(),
    cloudDetails: vi.fn(),
    cloudConnectBegin: vi.fn(),
    cloudConnectWait: vi.fn(),
    cloudConnectPaste: vi.fn(),
    cloudConnectCancel: vi.fn(async () => undefined),
    cloudDisconnect: vi.fn(async () => undefined),
    cloudSetEnabled: vi.fn(async () => undefined),
    cloudSetDeviceName: vi.fn(async () => undefined),
    cloudSyncNow: vi.fn(),
    cloudProjectSetMode: vi.fn(async () => undefined),
    cloudProjectResolveHold: vi.fn(),
    cloudProjectRemove: vi.fn(async () => undefined),
    cloudDownloadProject: vi.fn(),
    cloudSettingsSync: vi.fn(),
    cloudSettingsDownload: vi.fn(),
    cloudSettingsApplied: vi.fn(async () => undefined),
    cloudSettingsKeepLocal: vi.fn(async () => undefined),
  },
  settings: {
    gatherCloudSettings: vi.fn(async () => ({ general: { language: "system" } })),
    applyCloudSettings: vi.fn(async () => ({ general: { language: "fr" } })),
  },
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    successUnique: vi.fn(),
    infoUnique: vi.fn(),
    errorUnique: vi.fn(),
  },
  refreshProjects: vi.fn(async () => undefined),
}));

vi.mock("@/lib/cloud", () => mocks.cloud);
vi.mock("@/lib/cloud-settings", () => mocks.settings);
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => undefined) }));

const NETWORK = '@oleafly/error:{"code":"cloud.network","params":{}}';
const QUOTA = '@oleafly/error:{"code":"cloud.quota_full","params":{}}';

type Store = typeof import("@/store/cloud");

function cloudState(overrides: Partial<CloudState> = {}): CloudState {
  return {
    status: "connected",
    email: "ada@uni.edu",
    displayName: null,
    deviceName: "Desk",
    enabled: true,
    lastEmail: "ada@uni.edu",
    lastSyncedMs: 0,
    lastError: null,
    quotaFull: false,
    linkedCount: 0,
    projects: [],
    ...overrides,
  };
}

function project(overrides: Partial<CloudProject> = {}): CloudProject {
  return {
    localId: "thesis",
    cloudId: "c-thesis",
    name: "Thesis",
    mode: "sync",
    lastSyncedMs: 1,
    sizeBytes: 0,
    error: null,
    conflicts: 0,
    skipped: 0,
    hold: null,
    recycled: false,
    removedBy: null,
    ...overrides,
  };
}

function report(overrides: Partial<SyncReport> = {}): SyncReport {
  return { projects: [], lastSyncedMs: 1, error: null, ...overrides };
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

let store: Store;

async function connected(state: CloudState = cloudState()) {
  mocks.cloud.cloudState.mockResolvedValue(state);
  await store.useCloudStore.getState().refresh();
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.cloud.cloudSyncNow.mockResolvedValue(report());
  mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "current" });
  mocks.cloud.cloudDetails.mockResolvedValue({ space: null, remote: [], error: null });
  const { loadNamespace } = await import("@/i18n/lazy-namespaces");
  await loadNamespace("cloud");
  store = await import("@/store/cloud");
  const { useFilesStore } = await import("@/store/files");
  useFilesStore.setState({ projectId: null, files: {}, refreshProjects: mocks.refreshProjects });
});

describe("cloud store", () => {
  it("keeps the newest state when refreshes finish out of order", async () => {
    const first = deferred<CloudState>();
    const second = deferred<CloudState>();
    mocks.cloud.cloudState.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const older = store.useCloudStore.getState().refresh();
    const newer = store.useCloudStore.getState().refresh();
    second.resolve(cloudState({ deviceName: "New" }));
    await newer;
    first.resolve(cloudState({ deviceName: "Old" }));
    await older;
    expect(store.useCloudStore.getState().state?.deviceName).toBe("New");
  });

  it("tells the engine which open files have unsaved changes", async () => {
    const { useFilesStore } = await import("@/store/files");
    useFilesStore.setState({
      projectId: "p1",
      files: {
        "main.tex": { content: "a", dirty: true },
        "chapters\\intro.tex": { content: "b", dirty: true },
        "refs.bib": { content: "c", dirty: false },
      },
    });
    await connected();
    await store.useCloudStore.getState().syncNow();
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledWith([
      { localId: "p1", path: "main.tex" },
      { localId: "p1", path: "chapters/intro.tex" },
    ]);
  });

  it("runs projects first and then settings, and stays silent in the background", async () => {
    await connected();
    mocks.cloud.cloudSyncNow.mockResolvedValue(report({ error: NETWORK }));
    await store.useCloudStore.getState().syncNow(false);
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
    expect(mocks.toast.successUnique).not.toHaveBeenCalled();
    expect(mocks.cloud.cloudSettingsSync).not.toHaveBeenCalled();
    mocks.cloud.cloudSyncNow.mockResolvedValue(report());
    await store.useCloudStore.getState().syncNow(false);
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(1);
    expect(mocks.cloud.cloudSyncNow.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.cloud.cloudSettingsSync.mock.invocationCallOrder[0],
    );
    expect(mocks.toast.successUnique).not.toHaveBeenCalled();
  });

  it("toasts a manual round once, with a readable message", async () => {
    await connected();
    mocks.cloud.cloudSyncNow.mockResolvedValue(report({ error: NETWORK }));
    await store.useCloudStore.getState().syncNow(true);
    expect(mocks.toast.errorUnique).toHaveBeenCalledTimes(1);
    expect(mocks.toast.errorUnique).toHaveBeenCalledWith("cloud-sync", "Couldn't reach Dropbox. Check your connection.");
    mocks.cloud.cloudSyncNow.mockRejectedValue(new Error("engine exploded at offset 42"));
    await store.useCloudStore.getState().syncNow(true);
    expect(mocks.toast.errorUnique).toHaveBeenCalledTimes(2);
    expect(mocks.toast.errorUnique.mock.calls[1][1]).toBe("engine exploded at offset 42");
  });

  it("counts failures that are worth retrying and resets on success", async () => {
    await connected();
    mocks.cloud.cloudSyncNow.mockResolvedValue(report({ error: NETWORK }));
    await store.useCloudStore.getState().syncNow();
    await store.useCloudStore.getState().syncNow();
    expect(store.useCloudStore.getState().failureStreak).toBe(2);
    mocks.cloud.cloudSyncNow.mockResolvedValue(report({ error: QUOTA }));
    await store.useCloudStore.getState().syncNow();
    expect(store.useCloudStore.getState().failureStreak).toBe(0);
    mocks.cloud.cloudSyncNow.mockResolvedValue(report({ error: NETWORK }));
    await store.useCloudStore.getState().syncNow();
    mocks.cloud.cloudSyncNow.mockResolvedValue(report());
    await store.useCloudStore.getState().syncNow();
    expect(store.useCloudStore.getState().failureStreak).toBe(0);
    expect(store.useCloudStore.getState().syncError).toBeNull();
  });

  it("does not sync while sync is off on this computer or access ended", async () => {
    await connected(cloudState({ enabled: false }));
    await store.useCloudStore.getState().syncNow(true);
    await connected(cloudState({ status: "revoked" }));
    await store.useCloudStore.getState().syncNow(true);
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
  });

  it("applies settings from Dropbox and records the stamp as a string", async () => {
    await connected();
    let applyingDuringApply: boolean | null = null;
    mocks.settings.applyCloudSettings.mockImplementationOnce(async () => {
      applyingDuringApply = store.useCloudStore.getState().applyingSettings;
      return { general: { language: "fr" } };
    });
    mocks.cloud.cloudSettingsSync.mockResolvedValue({
      outcome: "apply",
      values: { general: { language: "fr" } },
      stamp: "18446744073709551615",
    });
    await store.useCloudStore.getState().syncSettings();
    expect(mocks.settings.applyCloudSettings).toHaveBeenCalledWith({ general: { language: "fr" } });
    expect(applyingDuringApply).toBe(true);
    expect(mocks.cloud.cloudSettingsApplied).toHaveBeenCalledWith("18446744073709551615", {
      general: { language: "fr" },
    });
    expect(store.useCloudStore.getState().applyingSettings).toBe(false);
  });

  it("asks once which settings to keep, and keeps this computer's on request", async () => {
    await connected();
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "5" });
    await store.useCloudStore.getState().syncSettings();
    expect(store.useCloudStore.getState().settingsChoice).toEqual({ values: { a: 1 }, stamp: "5" });
    await store.useCloudStore.getState().syncSettings();
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(1);
    await store.useCloudStore.getState().chooseSettings("local");
    expect(mocks.cloud.cloudSettingsKeepLocal).toHaveBeenCalledWith({ general: { language: "system" } });
    expect(mocks.cloud.cloudSettingsApplied).not.toHaveBeenCalled();
    expect(store.useCloudStore.getState().settingsChoice).toBeNull();
  });

  it("uses the Dropbox settings on request", async () => {
    await connected();
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "77" });
    await store.useCloudStore.getState().syncSettings();
    await store.useCloudStore.getState().chooseSettings("cloud");
    expect(mocks.settings.applyCloudSettings).toHaveBeenCalledWith({ a: 1 });
    expect(mocks.cloud.cloudSettingsApplied).toHaveBeenCalledWith("77", { general: { language: "fr" } });
    expect(store.useCloudStore.getState().settingsChoice).toBeNull();
  });

  it("stops asking for the rest of the session once the choice is put off", async () => {
    await connected();
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: {}, stamp: "1" });
    await store.useCloudStore.getState().syncSettings();
    store.useCloudStore.getState().deferSettingsChoice();
    await store.useCloudStore.getState().syncSettings();
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(1);
    expect(store.useCloudStore.getState().settingsChoice).toBeNull();
  });

  it("switches sync on this computer at once and rolls back when the engine refuses", async () => {
    await connected();
    const write = deferred<undefined>();
    mocks.cloud.cloudSetEnabled.mockReturnValueOnce(write.promise);
    const pending = store.useCloudStore.getState().setEnabled(false);
    expect(store.useCloudStore.getState().state?.enabled).toBe(false);
    write.reject('@oleafly/error:{"code":"cloud.not_connected","params":{}}');
    await pending;
    expect(store.useCloudStore.getState().state?.enabled).toBe(true);
    expect(mocks.toast.errorUnique).toHaveBeenCalledWith("cloud-action", "Dropbox isn't connected.");
  });

  it("rolls back a project switch the engine refuses", async () => {
    await connected(cloudState({ projects: [project()] }));
    mocks.cloud.cloudProjectSetMode.mockRejectedValueOnce("nope");
    await store.useCloudStore.getState().setProjectMode("thesis", "pause");
    expect(store.useCloudStore.getState().state?.projects[0].mode).toBe("sync");
    expect(store.useCloudStore.getState().busyProjects).toEqual([]);
  });

  it("returns the rename problem and keeps the old name", async () => {
    await connected();
    mocks.cloud.cloudSetDeviceName.mockRejectedValueOnce('@oleafly/error:{"code":"cloud.device_name_empty","params":{}}');
    const problem = await store.useCloudStore.getState().setDeviceName("   ");
    expect(problem).toContain("device_name_empty");
    expect(store.useCloudStore.getState().state?.deviceName).toBe("Desk");
  });

  it("ignores a round that finishes after disconnecting", async () => {
    await connected();
    const round = deferred<SyncReport>();
    mocks.cloud.cloudSyncNow.mockReturnValueOnce(round.promise);
    const syncing = store.useCloudStore.getState().syncNow(true);
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ status: "disconnected" }));
    await store.useCloudStore.getState().disconnect();
    round.resolve(report({ error: NETWORK }));
    await syncing;
    expect(store.useCloudStore.getState().lastReport).toBeNull();
    expect(store.useCloudStore.getState().syncError).toBeNull();
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
    expect(store.useCloudStore.getState().syncing).toBe(false);
  });

  it("downloads every Dropbox-only project and sums up once", async () => {
    await connected();
    mocks.cloud.cloudDetails.mockResolvedValue({
      space: null,
      remote: [
        project({ localId: null, cloudId: "c1", name: "One", mode: "download" }),
        project({ localId: null, cloudId: "c2", name: "Two", mode: "download" }),
        project({ localId: null, cloudId: "c3", name: "Three", mode: "download" }),
      ],
      error: null,
    });
    await store.useCloudStore.getState().refreshDetails();
    mocks.cloud.cloudDownloadProject
      .mockResolvedValueOnce({ localId: "one", restored: false })
      .mockRejectedValueOnce("gone")
      .mockResolvedValueOnce({ localId: "three", restored: true });
    await store.useCloudStore.getState().downloadAll();
    expect(mocks.cloud.cloudDownloadProject.mock.calls.map(([id]) => id)).toEqual(["c1", "c2", "c3"]);
    expect(mocks.toast.errorUnique).toHaveBeenCalledTimes(1);
    expect(mocks.toast.errorUnique).toHaveBeenCalledWith("cloud-download", "1 of 3 projects couldn't be downloaded.");
    expect(mocks.toast.successUnique).not.toHaveBeenCalled();
    expect(store.useCloudStore.getState().downloadProgress).toBeNull();
    expect(mocks.refreshProjects).toHaveBeenCalled();
  });

  it("guards a pasted code against double submits and clears the connect error on success", async () => {
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ status: "disconnected" }));
    await store.useCloudStore.getState().refresh();
    mocks.cloud.cloudConnectBegin.mockResolvedValue({ flowId: "f1", authUrl: "https://a", paste: true });
    await store.useCloudStore.getState().beginConnect(true);
    store.useCloudStore.setState({ connectError: "old" });
    const paste = deferred<{ email: string }>();
    mocks.cloud.cloudConnectPaste.mockReturnValueOnce(paste.promise);
    const first = store.useCloudStore.getState().submitPasteCode(" code ");
    await store.useCloudStore.getState().submitPasteCode("code");
    expect(mocks.cloud.cloudConnectPaste).toHaveBeenCalledTimes(1);
    expect(mocks.cloud.cloudConnectPaste).toHaveBeenCalledWith("f1", "code");
    mocks.cloud.cloudState.mockResolvedValue(cloudState());
    paste.resolve({ email: "ada@uni.edu" });
    await first;
    expect(store.useCloudStore.getState().status).toBe("connected");
    expect(store.useCloudStore.getState().connectError).toBeNull();
    expect(store.useCloudStore.getState().connectFlow).toBeNull();
  });

  it("resumes a waiting settings import only when the connect flow succeeds", async () => {
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ status: "disconnected" }));
    await store.useCloudStore.getState().refresh();
    store.useCloudStore.getState().requestSettingsImport();
    mocks.cloud.cloudConnectBegin.mockResolvedValueOnce({ flowId: "f1", authUrl: "https://a", paste: false });
    mocks.cloud.cloudConnectWait.mockRejectedValueOnce('@oleafly/error:{"code":"cloud.sign_in_cancelled","params":{}}');
    await store.useCloudStore.getState().beginConnect(false);
    expect(store.useCloudStore.getState().settingsImport).toBeNull();
    store.useCloudStore.getState().requestSettingsImport();
    mocks.cloud.cloudConnectBegin.mockResolvedValueOnce({ flowId: "f2", authUrl: "https://a", paste: false });
    mocks.cloud.cloudConnectWait.mockResolvedValueOnce({ email: "ada@uni.edu" });
    mocks.cloud.cloudState.mockResolvedValue(cloudState());
    await store.useCloudStore.getState().beginConnect(false);
    expect(store.useCloudStore.getState().settingsImport).toBe("resume");
    await vi.waitFor(() => expect(mocks.cloud.cloudSyncNow).toHaveBeenCalled());
    await vi.waitFor(() => expect(store.useCloudStore.getState().syncing).toBe(false));
    expect(mocks.cloud.cloudSettingsSync).not.toHaveBeenCalled();
  });
});
