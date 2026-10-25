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

import { CollabLiveKeeper } from "./CollabLiveKeeper";

beforeEach(() => {
  mocks.startLive.mockReset();
  mocks.stop.mockReset();
  mocks.startLive.mockReturnValue(mocks.stop);
  mocks.tauri = true;
});

afterEach(() => {
  cleanup();
});

describe("CollabLiveKeeper", () => {
  it("starts live collaboration on mount", async () => {
    const view = render(<CollabLiveKeeper />);
    await waitFor(() => expect(mocks.startLive).toHaveBeenCalledOnce());
    expect(mocks.stop).not.toHaveBeenCalled();
    view.unmount();
  });

  it("stops when the app root unmounts", async () => {
    const view = render(<CollabLiveKeeper />);
    await waitFor(() => expect(mocks.startLive).toHaveBeenCalledOnce());
    view.unmount();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("does not start when the app root unmounts before the module loads", async () => {
    const view = render(<CollabLiveKeeper />);
    view.unmount();
    await act(async () => {});
    expect(mocks.startLive).not.toHaveBeenCalled();
  });

  it("stays off outside the desktop app", async () => {
    mocks.tauri = false;
    const view = render(<CollabLiveKeeper />);
    await act(async () => {});
    expect(mocks.startLive).not.toHaveBeenCalled();
    view.unmount();
  });
});
