// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  logError: vi.fn(async () => {}),
  tauri: true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
  isTauri: () => mocks.tauri,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useSettingsStore } from "@/store/settings";
import { syncLiveCollaborationSwitch } from "./collab-switch";

const SWITCH = "collab_live_collaboration_set";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
  mocks.logError.mockClear();
  mocks.tauri = true;
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("syncLiveCollaborationSwitch", () => {
  it("tells the backend the saved switch as soon as it starts", () => {
    useSettingsStore.setState({ liveCollaboration: true });
    const stop = syncLiveCollaborationSwitch();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith(SWITCH, { enabled: true });
    stop();
  });

  it("sends each change of the switch once and ignores other settings", () => {
    const stop = syncLiveCollaborationSwitch();
    mocks.invoke.mockClear();
    useSettingsStore.getState().setLiveCollaboration(true);
    useSettingsStore.getState().setWebBrowser(true);
    useSettingsStore.getState().setLiveCollaboration(true);
    useSettingsStore.getState().setLiveCollaboration(false);
    expect(mocks.invoke.mock.calls).toEqual([
      [SWITCH, { enabled: true }],
      [SWITCH, { enabled: false }],
    ]);
    stop();
    useSettingsStore.getState().setLiveCollaboration(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("turns the backend off when the Experimentation section is reset", () => {
    useSettingsStore.getState().setLiveCollaboration(true);
    const stop = syncLiveCollaborationSwitch();
    mocks.invoke.mockClear();
    useSettingsStore.getState().resetExperimentationPreferences();
    expect(mocks.invoke).toHaveBeenCalledWith(SWITCH, { enabled: false });
    stop();
  });

  it("logs a failed update instead of throwing", async () => {
    const failure = new Error("backend gone");
    mocks.invoke.mockRejectedValue(failure);
    const stop = syncLiveCollaborationSwitch();
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("live collaboration switch", failure));
    stop();
  });

  it("does nothing outside the desktop app", () => {
    mocks.tauri = false;
    const stop = syncLiveCollaborationSwitch();
    useSettingsStore.getState().setLiveCollaboration(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    stop();
  });
});
