// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudState } from "@/lib/cloud";

const mocks = vi.hoisted(() => ({
  cloud: {
    cloudState: vi.fn(),
    cloudDetails: vi.fn(async () => ({ space: null, remote: [], error: null })),
    cloudSyncNow: vi.fn(),
    cloudSettingsSync: vi.fn(),
    cloudSettingsApplied: vi.fn(async () => undefined),
    cloudSettingsKeepLocal: vi.fn(async () => undefined),
    cloudConnectCancel: vi.fn(async () => undefined),
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

import { nextRoundDelay } from "@/components/cloud/cloud-schedule";
import { CloudSyncHost } from "@/components/cloud/CloudSyncHost";
import { loadNamespace } from "@/i18n/lazy-namespaces";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
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
  useSettingsStore.setState({ cloudSync: true });
  useCloudStore.setState({ syncInterval: "1m" });
  useFilesStore.setState({ projectId: null, files: {}, refreshProjects: vi.fn(async () => undefined) });
  mocks.cloud.cloudState.mockResolvedValue(cloudState());
  mocks.cloud.cloudSyncNow.mockResolvedValue({ projects: [], lastSyncedMs: 1, error: null });
  mocks.cloud.cloudSettingsSync.mockResolvedValue({ outcome: "current" });
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe("nextRoundDelay", () => {
  it("stretches the interval while hidden and backs off after failures up to 30 minutes", () => {
    expect(nextRoundDelay("1m", false, 0)).toBe(60_000);
    expect(nextRoundDelay("1m", true, 0)).toBe(300_000);
    expect(nextRoundDelay("60m", true, 0)).toBe(3_600_000);
    expect(nextRoundDelay("1m", false, 1)).toBe(120_000);
    expect(nextRoundDelay("1m", false, 3)).toBe(480_000);
    expect(nextRoundDelay("1m", false, 12)).toBe(1_800_000);
    expect(nextRoundDelay("60m", false, 4)).toBe(3_600_000);
  });
});

describe("CloudSyncKeeper", () => {
  it("waits about 20 seconds before the first round, then follows the interval", async () => {
    await mountKeeper();
    expect(mocks.cloud.cloudState).toHaveBeenCalled();
    await advance(19_000);
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
    await advance(1_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(59_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    expect(mocks.toast.successUnique).not.toHaveBeenCalled();
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
  });

  it("runs no automatic rounds when only Sync now should sync", async () => {
    useCloudStore.setState({ syncInterval: "manual" });
    await mountKeeper();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("oleafly:ai-config-changed"));
    await advance(30 * 60_000);
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
    expect(mocks.cloud.cloudSettingsSync).not.toHaveBeenCalled();
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

  it("waits at least five minutes between rounds while the window is hidden", async () => {
    await mountKeeper();
    await advance(20_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(4 * 60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
  });

  it("backs off after network failures and resets after a good round", async () => {
    mocks.cloud.cloudSyncNow.mockResolvedValue({ projects: [], lastSyncedMs: 0, error: NETWORK });
    await mountKeeper();
    await advance(20_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(119_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    mocks.cloud.cloudSyncNow.mockResolvedValue({ projects: [], lastSyncedMs: 1, error: null });
    await advance(240_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(3);
    await advance(60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(4);
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
  });

  it("syncs once when the connection comes back", async () => {
    await mountKeeper();
    window.dispatchEvent(new Event("online"));
    await advance(0);
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
    await advance(60_000);
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledTimes(2);
    expect(mocks.cloud.cloudSettingsSync).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("cloud-settings-choice")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep this computer's settings" }));
    await advance(0);
    expect(mocks.cloud.cloudSettingsKeepLocal).toHaveBeenCalledWith({ general: { language: "system" } });
    expect(screen.queryByTestId("cloud-settings-choice")).toBeNull();
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

  it("clears every timer and listener when it unmounts", async () => {
    const view = await mountKeeper();
    await advance(20_000);
    view.unmount();
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

  it("does not load the keeper while the experiment is off", async () => {
    useSettingsStore.setState({ cloudSync: false });
    render(<CloudSyncHost />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.cloud.cloudState).not.toHaveBeenCalled();
  });

  it("loads the keeper when the experiment is on", async () => {
    render(<CloudSyncHost />);
    await waitFor(() => expect(mocks.cloud.cloudState).toHaveBeenCalled());
    expect(mocks.cloud.cloudSyncNow).not.toHaveBeenCalled();
  });
});
