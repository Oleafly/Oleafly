// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});

describe("sync pause slot", () => {
  it("loads the collaboration banners on demand", async () => {
    render(<CollabSyncPauseSlot />);
    expect(await screen.findByText("collaboration banners")).toBeInTheDocument();
    expect(loaded).toHaveBeenCalled();
  });
});
