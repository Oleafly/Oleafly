// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => vi.fn());

vi.mock("@/features/collab/live/RemovedFileBanner", () => ({
  RemovedFileBanner: () => {
    loaded();
    return <span>{"removed file banner"}</span>;
  },
}));

import { CollabRemovedFileSlot } from "./CollabSlots";

afterEach(() => {
  loaded.mockClear();
});

describe("removed file slot", () => {
  it("loads the notice about files others deleted on demand", async () => {
    render(<CollabRemovedFileSlot />);
    expect(await screen.findByText("removed file banner")).toBeInTheDocument();
    expect(loaded).toHaveBeenCalled();
  });
});
