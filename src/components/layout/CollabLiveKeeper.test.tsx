// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startLive: vi.fn(),
  stop: vi.fn(),
  tauri: true,
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.tauri, invoke: vi.fn() }));
vi.mock("@/features/collab/live", () => ({ startLive: mocks.startLive }));

import { useSettingsStore } from "@/store/settings";
import { CollabLiveKeeper } from "./CollabLiveKeeper";

beforeEach(() => {
  mocks.startLive.mockReset();
  mocks.stop.mockReset();
  mocks.startLive.mockReturnValue(mocks.stop);
  mocks.tauri = true;
  useSettingsStore.setState({ liveCollaboration: false });
});

afterEach(() => {
  cleanup();
});

describe("CollabLiveKeeper", () => {
  it("loads nothing while live collaboration is off", async () => {
    const view = render(<CollabLiveKeeper />);
    await act(async () => {});
    expect(mocks.startLive).not.toHaveBeenCalled();
    view.unmount();
  });

  it("starts live collaboration when the flag turns on and stops it when it turns off", async () => {
    const view = render(<CollabLiveKeeper />);
    act(() => useSettingsStore.setState({ liveCollaboration: true }));
    await waitFor(() => expect(mocks.startLive).toHaveBeenCalledOnce());
    act(() => useSettingsStore.setState({ liveCollaboration: false }));
    expect(mocks.stop).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("stops when the app root unmounts", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    const view = render(<CollabLiveKeeper />);
    await waitFor(() => expect(mocks.startLive).toHaveBeenCalledOnce());
    view.unmount();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("does not start when the flag turns off before the module loads", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    const view = render(<CollabLiveKeeper />);
    view.unmount();
    await act(async () => {});
    expect(mocks.startLive).not.toHaveBeenCalled();
  });

  it("stays off outside the desktop app", async () => {
    mocks.tauri = false;
    useSettingsStore.setState({ liveCollaboration: true });
    const view = render(<CollabLiveKeeper />);
    await act(async () => {});
    expect(mocks.startLive).not.toHaveBeenCalled();
    view.unmount();
  });
});
