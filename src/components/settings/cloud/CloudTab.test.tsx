// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cloud = {
    status: "disconnected" as string,
    state: null as null | Record<string, unknown>,
    loading: false,
    loadError: null as string | null,
    connectFlow: null as null | { flowId: string; authUrl: string; paste: boolean },
    connectError: null as string | null,
    syncing: false,
    lastReport: null,
    syncError: null as string | null,
    refresh: vi.fn(async () => {}),
    beginConnect: vi.fn(async () => {}),
    submitPasteCode: vi.fn(async () => {}),
    cancelConnect: vi.fn(),
    disconnect: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    setDeviceName: vi.fn(async () => {}),
    syncNow: vi.fn(async () => {}),
    setProjectMode: vi.fn(async () => {}),
    downloadProject: vi.fn(async () => {}),
  };
  const useCloudStore = Object.assign(
    (selector: (state: typeof cloud) => unknown) => selector(cloud),
    { getState: () => cloud },
  );
  const settings = { cloudSync: true };
  const useSettingsStore = Object.assign(
    (selector: (state: typeof settings) => unknown) => selector(settings),
    { getState: () => settings },
  );
  return { cloud, useCloudStore, settings, useSettingsStore };
});

vi.mock("@/store/cloud", () => ({ useCloudStore: mocks.useCloudStore }));
vi.mock("@/store/settings", () => ({ useSettingsStore: mocks.useSettingsStore }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

import { CloudTab } from "./CloudTab";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.cloudSync = true;
  mocks.cloud.status = "disconnected";
  mocks.cloud.state = null;
  mocks.cloud.loadError = null;
  mocks.cloud.connectFlow = null;
  mocks.cloud.connectError = null;
  mocks.cloud.syncing = false;
  mocks.cloud.syncError = null;
});

describe("CloudTab", () => {
  it("keeps the placeholder while the experiment is off", () => {
    mocks.settings.cloudSync = false;
    render(<CloudTab />);
    expect(screen.getByText(/own Dropbox/i)).toBeTruthy();
    expect(mocks.cloud.refresh).not.toHaveBeenCalled();
  });

  it("offers Dropbox connect when disconnected", async () => {
    const user = userEvent.setup();
    render(<CloudTab />);
    await user.click(screen.getByRole("button", { name: /Connect Dropbox/i }));
    expect(mocks.cloud.beginConnect).toHaveBeenCalledWith(false);
  });

  it("shows the account, storage, and projects when connected", async () => {
    mocks.cloud.status = "connected";
    mocks.cloud.state = {
      status: "connected",
      email: "ada@uni.edu",
      displayName: "Ada",
      deviceName: "Desk",
      enabled: true,
      lastEmail: "ada@uni.edu",
      space: { used: 1024, allocated: 2048 },
      projects: [
        { localId: "thesis", cloudId: "c1", name: "Thesis", mode: "sync", lastSyncedMs: 0 },
        { localId: null, cloudId: "c2", name: "Notes", mode: "download", lastSyncedMs: 5 },
      ],
    };
    render(<CloudTab />);
    expect(screen.getByText(/ada@uni\.edu/)).toBeTruthy();
    expect(screen.queryByText("Thesis")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Projects/ }));
    expect(screen.getByText("Thesis")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Download$/ })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Thesis/ })).toBeTruthy();
  });

  it("offers a paste code path while connecting", async () => {
    const user = userEvent.setup();
    mocks.cloud.status = "connecting";
    mocks.cloud.connectFlow = { flowId: "f1", authUrl: "https://www.dropbox.com/oauth2/authorize", paste: true };
    render(<CloudTab />);
    expect(screen.getByText(/Waiting for Dropbox/i)).toBeTruthy();
    await user.click(screen.getByText(/Paste a code instead/i));
    const input = screen.getByLabelText(/Code from Dropbox/i);
    await user.type(input, "code-42");
    await user.click(screen.getByRole("button", { name: /^Connect$/ }));
    expect(mocks.cloud.submitPasteCode).toHaveBeenCalledWith("code-42");
  });
});
