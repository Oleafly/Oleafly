// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";

const loaded = vi.hoisted(() => vi.fn());

vi.mock("@/features/collab/live/SyncPauseBanner", () => ({
  CollabBanners: () => {
    loaded();
    return <span>{"collaboration banners"}</span>;
  },
}));

import { CollabSyncPauseSlot } from "./CollabSlots";

afterEach(() => {
  loaded.mockClear();
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("sync pause slot", () => {
  it("loads nothing while live collaboration is off", async () => {
    useSettingsStore.setState({ liveCollaboration: false });
    const { container } = render(<CollabSyncPauseSlot />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("loads the collaboration banners on demand when live collaboration is on", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    render(<CollabSyncPauseSlot />);
    expect(await screen.findByText("collaboration banners")).toBeInTheDocument();
  });
});
