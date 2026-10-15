// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudProject, CloudState, SyncProjectReport, SyncReport } from "@/lib/cloud";

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
    cloudProjectDismissConflicts: vi.fn(async () => undefined),
    cloudProjectReplaceRemote: vi.fn(),
    cloudProjectRemove: vi.fn(async () => undefined),
    cloudRemoveRemote: vi.fn(async () => undefined),
    cloudDownloadProject: vi.fn(),
    cloudSettingsSync: vi.fn(),
    cloudSettingsDownload: vi.fn(),
    cloudSettingsApplied: vi.fn(async () => undefined),
    cloudSettingsKeepLocal: vi.fn(async () => undefined),
    cloudSettingsDefer: vi.fn(async () => undefined),
  },
  tauri: {
    readFileContent: vi.fn(async (_projectId: string, _path: string) => ""),
    existingProjectFiles: vi.fn(async (_projectId: string, paths: string[]) => paths),
    listFileTree: vi.fn(async (_projectId: string) => ({ entries: [], truncated: false })),
    projectMutationGeneration: vi.fn(async (_projectId: string) => 1),
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
vi.mock("@/lib/tauri", { spy: true });
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => ({ rebuildFromDisk: vi.fn(async () => undefined) }) },
}));

const NETWORK = '@oleafly/error:{"code":"cloud.network","params":{}}';
const QUOTA = '@oleafly/error:{"code":"cloud.quota_full","params":{}}';
const UNREADABLE = '@oleafly/error:{"code":"cloud.remote_unreadable","params":{}}';
const TOO_MANY = '@oleafly/error:{"code":"cloud.too_many_files","params":{}}';
const LOCAL_IO = '@oleafly/error:{"code":"cloud.local_io","params":{}}';
const DISK_FULL = '@oleafly/error:{"code":"cloud.disk_full","params":{}}';

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
    skippedFiles: [],
    conflictCopies: [],
    hold: null,
    recycled: false,
    removedBy: null,
    pendingFiles: null,
    uploadingFrom: null,
    ...overrides,
  };
}

function report(overrides: Partial<SyncReport> = {}): SyncReport {
  return { projects: [], lastSyncedMs: 1, error: null, ...overrides };
}

function projectReport(overrides: Partial<SyncProjectReport> = {}): SyncProjectReport {
  return {
    localId: "thesis",
    uploaded: 0,
    downloaded: 0,
    deletedRemote: 0,
    deletedLocal: 0,
    conflicts: 0,
    skipped: 0,
    held: false,
    error: null,
    changed: [],
    changedTruncated: false,
    ...overrides,
  };
}

async function openFiles(files: Record<string, { content: string; dirty: boolean }>) {
  const { useFilesStore } = await import("@/store/files");
  useFilesStore.setState({
    projectId: "thesis",
    files,
    openTabs: Object.keys(files),
    activePath: Object.keys(files)[0] ?? null,
    tree: Object.keys(files).map((path) => ({ path, is_dir: false })),
  });
  return useFilesStore;
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
  mocks.tauri.existingProjectFiles.mockImplementation(async (_projectId: string, paths: string[]) => paths);
  mocks.tauri.listFileTree.mockResolvedValue({ entries: [], truncated: false });
  mocks.tauri.projectMutationGeneration.mockResolvedValue(1);
  const tauri = await import("@/lib/tauri");
  vi.mocked(tauri.readFileContent).mockImplementation((projectId, path) => mocks.tauri.readFileContent(projectId, path));
  vi.mocked(tauri.existingProjectFiles).mockImplementation(mocks.tauri.existingProjectFiles);
  vi.mocked(tauri.listFileTree).mockImplementation(mocks.tauri.listFileTree);
  vi.mocked(tauri.projectMutationGeneration).mockImplementation(mocks.tauri.projectMutationGeneration);
  const { loadNamespace } = await import("@/i18n");
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

  it("does not retry a full disk sooner, since only freeing space helps", async () => {
    await connected();
    mocks.cloud.cloudSyncNow.mockResolvedValue(report({ error: DISK_FULL }));
    await store.useCloudStore.getState().syncNow(true);
    expect(store.isRetryableCloudError(DISK_FULL)).toBe(false);
    expect(store.useCloudStore.getState().failureStreak).toBe(0);
    expect(mocks.toast.errorUnique).toHaveBeenCalledWith(
      "cloud-sync",
      "This computer is running out of disk space. Free up some space to keep syncing.",
    );
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
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "5", deferred: false });
    await store.useCloudStore.getState().syncSettings();
    expect(store.useCloudStore.getState().settingsChoice).toEqual({ values: { a: 1 }, stamp: "5", deferred: false });
    await store.useCloudStore.getState().syncSettings();
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(1);
    await store.useCloudStore.getState().chooseSettings("local");
    expect(mocks.cloud.cloudSettingsKeepLocal).toHaveBeenCalledWith({ general: { language: "system" } });
    expect(mocks.cloud.cloudSettingsApplied).not.toHaveBeenCalled();
    expect(store.useCloudStore.getState().settingsChoice).toBeNull();
  });

  it("uses the Dropbox settings on request", async () => {
    await connected();
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "77", deferred: false });
    await store.useCloudStore.getState().syncSettings();
    await store.useCloudStore.getState().chooseSettings("cloud");
    expect(mocks.settings.applyCloudSettings).toHaveBeenCalledWith({ a: 1 });
    expect(mocks.cloud.cloudSettingsApplied).toHaveBeenCalledWith("77", { general: { language: "fr" } });
    expect(store.useCloudStore.getState().settingsChoice).toBeNull();
  });

  it("records a put-off settings choice in the engine and keeps it waiting instead of asking again", async () => {
    await connected();
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: {}, stamp: "1", deferred: false });
    await store.useCloudStore.getState().syncSettings();
    expect(store.useCloudStore.getState().settingsChoice?.deferred).toBe(false);
    store.useCloudStore.getState().deferSettingsChoice();
    expect(mocks.cloud.cloudSettingsDefer).toHaveBeenCalledWith("1");
    expect(store.useCloudStore.getState().settingsChoice).toEqual({ values: {}, stamp: "1", deferred: true });
    await store.useCloudStore.getState().syncSettings();
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(2);
    expect(store.useCloudStore.getState().settingsChoice?.deferred).toBe(true);
  });

  it("keeps a choice the engine reports as put off waiting in Settings rather than asking", async () => {
    await connected();
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "8", deferred: true });
    await store.useCloudStore.getState().syncSettings();
    expect(store.useCloudStore.getState().settingsChoice).toEqual({ values: { a: 1 }, stamp: "8", deferred: true });
    await store.useCloudStore.getState().chooseSettings("cloud");
    expect(mocks.settings.applyCloudSettings).toHaveBeenCalledWith({ a: 1 });
    expect(mocks.cloud.cloudSettingsApplied).toHaveBeenCalledWith("8", { general: { language: "fr" } });
    expect(store.useCloudStore.getState().settingsChoice).toBeNull();
  });

  it("drops a waiting choice once the engine no longer needs one", async () => {
    await connected();
    mocks.cloud.cloudSettingsSync.mockResolvedValueOnce({ outcome: "choose", values: {}, stamp: "3", deferred: true });
    await store.useCloudStore.getState().syncSettings();
    mocks.cloud.cloudSettingsSync.mockResolvedValueOnce({ outcome: "current" });
    await store.useCloudStore.getState().syncSettings();
    expect(store.useCloudStore.getState().settingsChoice).toBeNull();
  });

  it("skips applying Dropbox settings when a setting changed here while the request was out", async () => {
    await connected();
    mocks.settings.gatherCloudSettings
      .mockResolvedValueOnce({ general: { language: "system" } })
      .mockResolvedValueOnce({ general: { language: "de" } });
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "apply", values: { general: { language: "fr" } }, stamp: "4" });
    await store.useCloudStore.getState().syncSettings();
    expect(mocks.settings.applyCloudSettings).not.toHaveBeenCalled();
    expect(mocks.cloud.cloudSettingsApplied).not.toHaveBeenCalled();
  });

  it("reports unreadable settings in Dropbox and replaces them with this computer's on request", async () => {
    await connected();
    mocks.cloud.cloudSettingsSync.mockRejectedValueOnce(NETWORK);
    await store.useCloudStore.getState().syncSettings();
    expect(store.useCloudStore.getState().settingsProblem).toBeNull();
    mocks.cloud.cloudSettingsSync.mockRejectedValueOnce(UNREADABLE);
    await store.useCloudStore.getState().syncSettings();
    expect(store.useCloudStore.getState().settingsProblem).toBe(UNREADABLE);
    expect(store.cloudAttentionReasons(store.useCloudStore.getState())).toEqual([
      "settingsProblem:cloud.remote_unreadable",
    ]);
    await store.useCloudStore.getState().chooseSettings("local");
    expect(mocks.cloud.cloudSettingsKeepLocal).toHaveBeenCalledWith({ general: { language: "system" } });
    expect(store.useCloudStore.getState().settingsProblem).toBeNull();
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

  it("marks a resumed project as waiting and clears transfer progress when the round ends", async () => {
    await connected(cloudState({ projects: [project({ mode: "pause" })] }));
    mocks.cloud.cloudProjectSetMode.mockResolvedValueOnce(undefined);
    const round = deferred<SyncReport>();
    mocks.cloud.cloudSyncNow.mockReturnValueOnce(round.promise);
    const before = Date.now();
    await store.useCloudStore.getState().setProjectMode("thesis", "sync");
    expect(store.useCloudStore.getState().resumedAt.thesis).toBeGreaterThanOrEqual(before);
    store.useCloudStore
      .getState()
      .noteProgress({ projectId: "thesis", cloudId: "c-thesis", phase: "uploading", done: 1, total: 4 });
    store.useCloudStore.setState({ downloading: ["c-stats"] });
    store.useCloudStore
      .getState()
      .noteProgress({ projectId: null, cloudId: "c-stats", phase: "downloading", done: 2, total: 9 });
    expect(Object.keys(store.useCloudStore.getState().progress)).toEqual(["thesis", "c-stats"]);
    round.resolve(report());
    await vi.waitFor(() => expect(store.useCloudStore.getState().syncing).toBe(false));
    expect(Object.keys(store.useCloudStore.getState().progress)).toEqual(["c-stats"]);
  });

  it("forgets a download's progress once it finishes", async () => {
    await connected();
    mocks.cloud.cloudDownloadProject.mockImplementationOnce(async () => {
      store.useCloudStore
        .getState()
        .noteProgress({ projectId: null, cloudId: "c1", phase: "fetching", done: 5, total: 10 });
      return { localId: "one", restored: false };
    });
    await store.useCloudStore.getState().downloadProject("c1");
    expect(store.useCloudStore.getState().progress).toEqual({});
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

  it("leaves Recycle Bin projects out of Download all", async () => {
    await connected();
    mocks.cloud.cloudDetails.mockResolvedValue({
      space: null,
      remote: [
        project({ localId: null, cloudId: "c1", name: "One", mode: "download" }),
        project({ localId: null, cloudId: "c-bin", name: "Binned", mode: "download", recycled: true }),
      ],
      error: null,
    });
    await store.useCloudStore.getState().refreshDetails();
    mocks.cloud.cloudDownloadProject.mockResolvedValue({ localId: "one", restored: false });
    await store.useCloudStore.getState().downloadAll();
    expect(mocks.cloud.cloudDownloadProject.mock.calls.map(([id]) => id)).toEqual(["c1"]);
    expect(mocks.toast.successUnique).toHaveBeenCalledWith("cloud-download", "Downloaded 1 project.");
  });

  it("removes a project that is only in Dropbox and reloads the list", async () => {
    await connected();
    mocks.cloud.cloudDetails.mockResolvedValueOnce({
      space: null,
      remote: [project({ localId: null, cloudId: "c-notes", name: "Notes", mode: "download" })],
      error: null,
    });
    await store.useCloudStore.getState().refreshDetails();
    await store.useCloudStore.getState().removeRemote("c-notes");
    expect(mocks.cloud.cloudRemoveRemote).toHaveBeenCalledWith("c-notes");
    expect(mocks.toast.successUnique).toHaveBeenCalledWith("cloud-action", "Notes was removed from your Dropbox.");
    expect(mocks.cloud.cloudDetails).toHaveBeenCalledTimes(2);
    expect(store.useCloudStore.getState().remote).toEqual([]);
    expect(store.useCloudStore.getState().busyProjects).toEqual([]);
  });

  it("clears conflict copies once dismissed", async () => {
    await connected(cloudState({ projects: [project({ conflicts: 1, conflictCopies: ["main (conflict).tex"] })] }));
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ projects: [project()] }));
    await store.useCloudStore.getState().dismissConflicts("thesis");
    expect(mocks.cloud.cloudProjectDismissConflicts).toHaveBeenCalledWith("thesis");
    expect(store.useCloudStore.getState().state?.projects[0].conflictCopies).toEqual([]);
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
  });

  it("replaces an unreadable Dropbox copy with this computer's, passing its unsaved files", async () => {
    await openFiles({ "main.tex": { content: "typing\n", dirty: true } });
    await connected(cloudState({ projects: [project({ error: UNREADABLE })] }));
    mocks.cloud.cloudProjectReplaceRemote.mockResolvedValue(projectReport({ uploaded: 3 }));
    await store.useCloudStore.getState().replaceRemote("thesis");
    expect(mocks.cloud.cloudProjectReplaceRemote).toHaveBeenCalledWith("thesis", [{ localId: "thesis", path: "main.tex" }]);
    expect(mocks.toast.successUnique).toHaveBeenCalledWith(
      "cloud-action",
      "Thesis in your Dropbox now matches this computer.",
    );
  });

  it("passes the project's unsaved files to hold resolution and reloads what it put back", async () => {
    const files = await openFiles({
      "main.tex": { content: "typing\n", dirty: true },
      "refs.bib": { content: "old\n", dirty: false },
    });
    await connected(cloudState({ projects: [project({ mode: "held", hold: { kind: "massDelete", count: 1, total: 2 } })] }));
    mocks.tauri.readFileContent.mockResolvedValue("restored\n");
    mocks.cloud.cloudProjectResolveHold.mockResolvedValue(projectReport({ downloaded: 1, changed: ["refs.bib"] }));
    await store.useCloudStore.getState().resolveHold("thesis", "restore");
    expect(mocks.cloud.cloudProjectResolveHold).toHaveBeenCalledWith("thesis", "restore", [
      { localId: "thesis", path: "main.tex" },
    ]);
    await vi.waitFor(() => expect(files.getState().files["refs.bib"]).toEqual({ content: "restored\n", dirty: false }));
    expect(files.getState().files["main.tex"]).toEqual({ content: "typing\n", dirty: true });
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

describe("open files after a round", () => {
  it("reloads a clean open file that the round changed on this computer", async () => {
    const files = await openFiles({ "main.tex": { content: "old\n", dirty: false } });
    mocks.tauri.readFileContent.mockResolvedValue("from the laptop\n");
    mocks.cloud.cloudSyncNow.mockResolvedValue(
      report({ projects: [projectReport({ downloaded: 1, changed: ["main.tex"] })] }),
    );
    await connected();
    await store.useCloudStore.getState().syncNow(false);
    await vi.waitFor(() =>
      expect(files.getState().files["main.tex"]).toEqual({ content: "from the laptop\n", dirty: false }),
    );
    expect(files.getState().changedOnDisk).toEqual([]);
    expect(mocks.toast.successUnique).not.toHaveBeenCalled();
    expect(mocks.toast.infoUnique).not.toHaveBeenCalled();
  });

  it("keeps unsaved edits and marks the file as changed on disk instead of overwriting it", async () => {
    const files = await openFiles({});
    mocks.tauri.readFileContent.mockResolvedValueOnce("original\n");
    await files.getState().openFile("main.tex");
    files.setState((current) => ({ files: { ...current.files, "main.tex": { content: "my edit\n", dirty: true } } }));
    mocks.tauri.readFileContent.mockResolvedValue("from the laptop\n");
    mocks.cloud.cloudSyncNow.mockResolvedValue(report({ projects: [projectReport({ changed: ["main.tex"] })] }));
    await connected();
    await store.useCloudStore.getState().syncNow(false);
    await vi.waitFor(() => expect(files.getState().changedOnDisk).toEqual(["main.tex"]));
    expect(files.getState().files["main.tex"]).toEqual({ content: "my edit\n", dirty: true });
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
  });

  it("closes a clean open file the round deleted, the way an outside delete does", async () => {
    const files = await openFiles({
      "notes.tex": { content: "gone\n", dirty: false },
      "main.tex": { content: "kept\n", dirty: false },
    });
    mocks.tauri.existingProjectFiles.mockResolvedValue([]);
    mocks.cloud.cloudSyncNow.mockResolvedValue(
      report({ projects: [projectReport({ deletedLocal: 1, changed: ["notes.tex"] })] }),
    );
    await connected();
    await store.useCloudStore.getState().syncNow(false);
    expect(mocks.tauri.existingProjectFiles).toHaveBeenCalledWith("thesis", ["notes.tex"]);
    expect(files.getState().files["notes.tex"]).toBeUndefined();
    expect(files.getState().openTabs).toEqual(["main.tex"]);
    expect(mocks.tauri.readFileContent).not.toHaveBeenCalled();
  });

  it("checks every open file when the round changed too many to list", async () => {
    const files = await openFiles({
      "a.tex": { content: "a\n", dirty: false },
      "b.tex": { content: "b\n", dirty: false },
    });
    mocks.tauri.readFileContent.mockImplementation(async (_projectId: string, path: string) => `new ${path}\n`);
    mocks.cloud.cloudSyncNow.mockResolvedValue(
      report({ projects: [projectReport({ downloaded: 600, changedTruncated: true })] }),
    );
    await connected();
    await store.useCloudStore.getState().syncNow(false);
    await vi.waitFor(() => {
      expect(files.getState().files["a.tex"]?.content).toBe("new a.tex\n");
      expect(files.getState().files["b.tex"]?.content).toBe("new b.tex\n");
    });
    expect(mocks.tauri.listFileTree).toHaveBeenCalled();
  });

  it("leaves open files alone when the round changed another project", async () => {
    await openFiles({ "main.tex": { content: "old\n", dirty: false } });
    mocks.cloud.cloudSyncNow.mockResolvedValue(
      report({ projects: [projectReport({ localId: "draft", changed: ["main.tex"] })] }),
    );
    await connected();
    await store.useCloudStore.getState().syncNow(false);
    expect(mocks.tauri.existingProjectFiles).not.toHaveBeenCalled();
    expect(mocks.tauri.readFileContent).not.toHaveBeenCalled();
  });
});

describe("cloudAttentionReasons", () => {
  it("names each problem that stops sync until someone acts", async () => {
    const { cloudAttentionReasons } = store;
    const base = { status: "connected" as const, settingsChoice: null, settingsProblem: null };
    expect(cloudAttentionReasons({ ...base, state: cloudState({ projects: [project()] }) })).toEqual([]);
    expect(cloudAttentionReasons({ ...base, status: "revoked", state: cloudState({ status: "revoked" }) })).toEqual([
      "revoked",
    ]);
    expect(cloudAttentionReasons({ ...base, state: cloudState({ quotaFull: true, lastError: QUOTA }) })).toEqual([
      "quotaFull",
    ]);
    expect(cloudAttentionReasons({ ...base, state: cloudState({ lastError: DISK_FULL }) })).toEqual([
      "round:cloud.disk_full",
    ]);
    expect(cloudAttentionReasons({ ...base, state: cloudState({ lastError: NETWORK }) })).toEqual([]);
    expect(
      cloudAttentionReasons({
        ...base,
        state: cloudState({
          projects: [
            project({ localId: "held", mode: "held" }),
            project({ localId: "big", error: TOO_MANY }),
            project({ localId: "copies", conflicts: 1, conflictCopies: ["a (conflict).tex"] }),
            project({ localId: "offline", error: NETWORK }),
            project({ localId: "busy", error: LOCAL_IO }),
            project({ localId: "space", error: DISK_FULL }),
          ],
        }),
      }),
    ).toEqual([
      "held:held::0",
      "big:sync:cloud.too_many_files:0",
      "copies:sync::1",
      "space:sync:cloud.disk_full:0",
    ]);
    expect(
      cloudAttentionReasons({ ...base, state: cloudState(), settingsChoice: { values: {}, stamp: "9", deferred: true } }),
    ).toEqual(["settings:9"]);
    expect(
      cloudAttentionReasons({ ...base, state: cloudState(), settingsChoice: { values: {}, stamp: "9", deferred: false } }),
    ).toEqual([]);
    expect(
      cloudAttentionReasons({ ...base, state: cloudState({ enabled: false, quotaFull: true, projects: [project({ mode: "held" })] }) }),
    ).toEqual([]);
  });
});
