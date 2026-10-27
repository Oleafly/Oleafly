// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudProject, CloudState } from "@/lib/cloud";

const mocks = vi.hoisted(() => ({
  cloud: {
    cloudState: vi.fn(),
    cloudDetails: vi.fn(async () => ({ space: null, remote: [], error: null })),
    cloudSyncNow: vi.fn(),
    cloudSettingsSync: vi.fn(),
    cloudSettingsApplied: vi.fn(async () => undefined),
    cloudSettingsKeepLocal: vi.fn(async () => undefined),
    cloudSettingsDefer: vi.fn(async () => undefined),
    cloudConnectCancel: vi.fn(async () => undefined),
    cloudWaitForChanges: vi.fn(),
    CLOUD_PROGRESS_EVENT: "cloud-progress",
  },
  settings: {
    gatherCloudSettings: vi.fn(async () => ({ general: { language: "system" } })),
    applyCloudSettings: vi.fn(async () => ({ general: { language: "system" } })),
  },
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    successUnique: vi.fn(),
    infoUnique: vi.fn(),
    errorUnique: vi.fn(),
  },
}));

vi.mock("@/lib/cloud", () => mocks.cloud);
vi.mock("@/lib/cloud-settings", () => mocks.settings);
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => undefined) }));

import { nextCheckDelay, waitRetryDelay } from "@/components/cloud/cloud-schedule";
import { CloudSyncHost } from "@/components/cloud/CloudSyncHost";
import { loadNamespace } from "@/i18n";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import CloudSyncKeeper from "./CloudSyncKeeper";

const NETWORK = '@oleafly/error:{"code":"cloud.network","params":{}}';
const initialCloud = useCloudStore.getState();

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

function heldProject(overrides: Partial<CloudProject> = {}): CloudProject {
  return {
    localId: "thesis",
    cloudId: "c-thesis",
    name: "Thesis",
    mode: "held",
    lastSyncedMs: 1,
    sizeBytes: 0,
    error: null,
    conflicts: 0,
    skipped: 0,
    skippedFiles: [],
    conflictCopies: [],
    hold: { kind: "massDelete", count: 3, total: 9 },
    recycled: false,
    removedBy: null,
    pendingFiles: null,
    uploadingFrom: null,
    ...overrides,
  };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountKeeper() {
  const view = render(<CloudSyncKeeper />);
  await advance(0);
  return view;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

beforeAll(async () => {
  await loadNamespace("cloud");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  setHidden(false);
  useCloudStore.setState(initialCloud, true);
  useCloudStore.setState({ autoSync: true });
  useFilesStore.setState({ projectId: null, files: {}, refreshProjects: vi.fn(async () => undefined) });
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" });
  useTourStore.setState({ activeTourId: null });
  delete document.documentElement.dataset.cloudAttention;
  mocks.cloud.cloudState.mockResolvedValue(cloudState());
  mocks.cloud.cloudSyncNow.mockResolvedValue({ projects: [], lastSyncedMs: 1, error: null });
  mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "current" });
  mocks.cloud.cloudWaitForChanges.mockImplementation(() => new Promise(() => undefined));
});

function changeInDropbox() {
  let answer: (value: { changes: boolean; retryAfterMs: number | null }) => void = () => undefined;
  mocks.cloud.cloudWaitForChanges.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  return (changes: boolean, retryAfterMs: number | null = null) => answer({ changes, retryAfterMs });
}

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe("cloud schedule", () => {
  it("checks every five minutes, every fifteen while hidden, and retries failures sooner", () => {
    expect(nextCheckDelay(false, 0)).toBe(300_000);
    expect(nextCheckDelay(true, 0)).toBe(900_000);
    expect(nextCheckDelay(false, 1)).toBe(30_000);
    expect(nextCheckDelay(false, 3)).toBe(120_000);
    expect(nextCheckDelay(false, 9)).toBe(300_000);
    expect(nextCheckDelay(true, 9)).toBe(900_000);
  });

  it("waits longer after each failed wait for changes, up to five minutes", () => {
    expect(waitRetryDelay(1)).toBe(30_000);
    expect(waitRetryDelay(2)).toBe(60_000);
    expect(waitRetryDelay(10)).toBe(300_000);
  });
});

describe("CloudSyncKeeper", () => {
  it("waits about 20 seconds before the first round, then checks every five minutes", async () => {
    await mountKeeper();
    expect(mocks.cloud.cloudState).toHaveBeenCalled();
    await advance(19_000);
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
    await advance(1_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(299_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    expect(mocks.toast.successUnique).not.toHaveBeenCalled();
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
  });

  it("runs no automatic rounds when only Sync now should sync", async () => {
    useCloudStore.setState({ autoSync: false });
    await mountKeeper();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("oleafly:ai-config-changed"));
    await advance(30 * 60_000);
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
    expect(mocks.cloud.cloudSettingsSync).not.toHaveBeenCalled();
    expect(mocks.cloud.cloudWaitForChanges).not.toHaveBeenCalled();
  });

  it("syncs a few seconds after a file is saved, once for a burst of saves", async () => {
    useFilesStore.setState({ projectId: "thesis", files: { "main.tex": { content: "a", dirty: true } } });
    await mountKeeper();
    await advance(20_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(10_000);
    act(() => useFilesStore.setState({ files: { "main.tex": { content: "a", dirty: false } } }));
    await advance(1_000);
    act(() => useFilesStore.setState({ files: { "main.tex": { content: "b", dirty: true } } }));
    act(() => useFilesStore.setState({ files: { "main.tex": { content: "b", dirty: false } } }));
    await advance(2_999);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    act(() => useFilesStore.setState({ files: { "main.tex": { content: "c", dirty: false } } }));
    await advance(60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
  });

  it("syncs soon after another computer changes Dropbox and waits for that round before asking again", async () => {
    const answer = changeInDropbox();
    await mountKeeper();
    expect(mocks.cloud.cloudWaitForChanges).toHaveBeenCalledTimes(1);
    await advance(20_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(5_000);
    answer(true);
    await advance(0);
    await advance(4_999);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    expect(mocks.cloud.cloudWaitForChanges).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    await advance(0);
    expect(mocks.cloud.cloudWaitForChanges).toHaveBeenCalledTimes(2);
  });

  it("honours Dropbox's back-off and retries failed waits less often", async () => {
    const quiet = changeInDropbox();
    mocks.cloud.cloudWaitForChanges.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await mountKeeper();
    quiet(false, 60_000);
    await advance(59_999);
    expect(mocks.cloud.cloudWaitForChanges).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.cloud.cloudWaitForChanges).toHaveBeenCalledTimes(2);
    await advance(29_999);
    expect(mocks.cloud.cloudWaitForChanges).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(mocks.cloud.cloudWaitForChanges).toHaveBeenCalledTimes(3);
  });

  it("stays quiet while sync is off on this computer or access ended", async () => {
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ enabled: false }));
    const first = await mountKeeper();
    await advance(10 * 60_000);
    first.unmount();
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ status: "revoked" }));
    await mountKeeper();
    await advance(10 * 60_000);
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
  });

  it("checks every fifteen minutes while hidden and catches up when the window comes back", async () => {
    await mountKeeper();
    await advance(20_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(14 * 60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    await advance(6 * 60_000);
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(3_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(3);
  });

  it("retries network failures sooner and returns to the usual check after a good round", async () => {
    mocks.cloud.cloudSyncNow.mockResolvedValue({ projects: [], lastSyncedMs: 0, error: NETWORK });
    await mountKeeper();
    await advance(20_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(29_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    mocks.cloud.cloudSyncNow.mockResolvedValue({ projects: [], lastSyncedMs: 1, error: null });
    await advance(60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(3);
    await advance(299_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(3);
    await advance(1_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(4);
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
  });

  it("syncs once soon after the connection comes back", async () => {
    await mountKeeper();
    window.dispatchEvent(new Event("online"));
    await advance(3_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
  });

  it("runs a settings-only round three seconds after settings change", async () => {
    await mountKeeper();
    act(() => useSettingsStore.getState().setEditorFontSize(21));
    await advance(1_000);
    window.dispatchEvent(new Event("oleafly:ai-config-changed"));
    await advance(2_999);
    expect(mocks.cloud.cloudSettingsSync).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(1);
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
  });

  it("ignores settings changes made while cloud settings are being applied", async () => {
    await mountKeeper();
    useCloudStore.setState({ applyingSettings: true });
    act(() => useSettingsStore.getState().setEditorFontSize(22));
    await advance(5_000);
    expect(mocks.cloud.cloudSettingsSync).not.toHaveBeenCalled();
  });

  it("shows the first-connect settings choice once and keeps this computer's settings", async () => {
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "12" });
    await mountKeeper();
    await advance(20_000);
    expect(screen.getByTestId("cloud-settings-choice")).toHaveTextContent("Which settings should Oleafly use?");
    await advance(5 * 60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("cloud-settings-choice")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep this computer's settings" }));
    await advance(0);
    expect(mocks.cloud.cloudSettingsKeepLocal).toHaveBeenCalledWith({ general: { language: "system" } });
    expect(screen.queryByTestId("cloud-settings-choice")).toBeNull();
  });

  it("records a closed settings choice and leaves a put-off one closed after the next launch", async () => {
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "12", deferred: false });
    const first = await mountKeeper();
    await advance(20_000);
    fireEvent.keyDown(screen.getByTestId("cloud-settings-keep-local"), { key: "Escape" });
    await advance(0);
    expect(mocks.cloud.cloudSettingsDefer).toHaveBeenCalledWith("12");
    expect(screen.queryByTestId("cloud-settings-choice")).toBeNull();
    first.unmount();
    useCloudStore.setState(initialCloud, true);
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "12", deferred: true });
    await mountKeeper();
    await advance(20_000);
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("cloud-settings-choice")).toBeNull();
    expect(useCloudStore.getState().settingsChoice).toEqual({ values: { a: 1 }, stamp: "12", deferred: true });
    expect(document.documentElement.dataset.cloudAttention).toBe("true");
  });

  it("uses the Dropbox settings when chosen", async () => {
    mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "choose", values: { a: 1 }, stamp: "9007199254740993" });
    await mountKeeper();
    await advance(20_000);
    fireEvent.click(screen.getByRole("button", { name: "Use Dropbox settings" }));
    await advance(0);
    expect(mocks.settings.applyCloudSettings).toHaveBeenCalledWith({ a: 1 });
    expect(mocks.cloud.cloudSettingsApplied).toHaveBeenCalledWith("9007199254740993", {
      general: { language: "system" },
    });
    expect(screen.queryByTestId("cloud-settings-choice")).toBeNull();
  });

  it("marks Settings while a project needs attention and clears the mark once it is fixed", async () => {
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ projects: [heldProject()] }));
    await mountKeeper();
    expect(document.documentElement.dataset.cloudAttention).toBe("true");
    const hint = document.getElementById("cloud-attention");
    expect(hint).toHaveTextContent("Cloud sync needs your attention.");
    expect(hint).not.toBeVisible();
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ projects: [heldProject({ mode: "sync", hold: null })] }));
    await act(async () => {
      await useCloudStore.getState().refresh();
    });
    expect(document.documentElement.dataset.cloudAttention).toBeUndefined();
    expect(document.getElementById("cloud-attention")).toBeNull();
  });

  it("stays unmarked for problems that fix themselves", async () => {
    mocks.cloud.cloudState.mockResolvedValue(
      cloudState({ projects: [heldProject({ mode: "sync", hold: null, error: NETWORK })] }),
    );
    await mountKeeper();
    expect(document.documentElement.dataset.cloudAttention).toBeUndefined();
    expect(document.getElementById("cloud-attention")).toBeNull();
  });

  it("opens Settings on the Cloud tab once for each new problem", async () => {
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ quotaFull: true }));
    await mountKeeper();
    act(() => useSettingsStore.getState().setSettingsOpen(true));
    expect(useSettingsStore.getState().settingsInitialSection).toBe("data");
    expect(useCloudStore.getState().navRequest).toBe("data-cloud");
    act(() => {
      useCloudStore.getState().requestNav(null);
      useSettingsStore.getState().setSettingsOpen(false);
      useSettingsStore.getState().setSettingsInitialSection("general");
    });
    act(() => useSettingsStore.getState().setSettingsOpen(true));
    expect(useCloudStore.getState().navRequest).toBeNull();
    expect(useSettingsStore.getState().settingsInitialSection).toBe("general");
    act(() => useSettingsStore.getState().setSettingsOpen(false));
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ status: "revoked" }));
    await act(async () => {
      await useCloudStore.getState().refresh();
    });
    act(() => {
      useSettingsStore.getState().setSettingsInitialSection("integrations");
      useSettingsStore.getState().setSettingsOpen(true);
    });
    expect(useCloudStore.getState().navRequest).toBeNull();
    act(() => {
      useSettingsStore.getState().setSettingsOpen(false);
      useSettingsStore.getState().setSettingsInitialSection("general");
      useTourStore.setState({ activeTourId: "settings" });
      useSettingsStore.getState().setSettingsOpen(true);
    });
    expect(useCloudStore.getState().navRequest).toBeNull();
    act(() => {
      useSettingsStore.getState().setSettingsOpen(false);
      useTourStore.setState({ activeTourId: null });
      useSettingsStore.getState().setSettingsOpen(true);
    });
    expect(useCloudStore.getState().navRequest).toBe("data-cloud");
  });

  it("opens Settings as usual when nothing needs attention", async () => {
    await mountKeeper();
    act(() => useSettingsStore.getState().setSettingsOpen(true));
    expect(useCloudStore.getState().navRequest).toBeNull();
    expect(useSettingsStore.getState().settingsInitialSection).toBe("general");
  });

  it("clears every timer and listener when it unmounts", async () => {
    const view = await mountKeeper();
    await advance(20_000);
    view.unmount();
    act(() => useSettingsStore.getState().setSettingsOpen(true));
    expect(useCloudStore.getState().navRequest).toBeNull();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("oleafly:ai-config-changed"));
    await advance(60 * 60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("CloudSyncHost", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("loads the keeper at start when this computer has an account, without syncing yet", async () => {
    render(<CloudSyncHost />);
    await waitFor(() => expect(useCloudStore.getState().status).toBe("connected"));
    expect(mocks.cloud.cloudState).toHaveBeenCalledTimes(2);
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
  });

  it("waits for Settings to load the keeper when no account is connected", async () => {
    mocks.cloud.cloudState.mockResolvedValue(cloudState({ status: "disconnected", enabled: false }));
    render(<CloudSyncHost />);
    await waitFor(() => expect(mocks.cloud.cloudState).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(useCloudStore.getState().status).toBe("unknown");

    act(() => useSettingsStore.setState({ settingsOpen: true }));
    await waitFor(() => expect(useCloudStore.getState().status).toBe("disconnected"));
    expect(mocks.cloud.cloudState).toHaveBeenCalledTimes(2);
  });

  it("loads the keeper when the account check fails", async () => {
    mocks.cloud.cloudState.mockRejectedValueOnce(new Error("no backend"));
    render(<CloudSyncHost />);
    await waitFor(() => expect(useCloudStore.getState().status).toBe("connected"));
  });
});
