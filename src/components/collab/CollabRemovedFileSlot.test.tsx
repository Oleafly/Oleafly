// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";

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
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("removed file slot", () => {
  it("loads nothing while live collaboration is off", async () => {
    useSettingsStore.setState({ liveCollaboration: false });
    const { container } = render(<CollabRemovedFileSlot />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("loads the notice about files others deleted when live collaboration is on", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    render(<CollabRemovedFileSlot />);
    expect(await screen.findByText("removed file banner")).toBeInTheDocument();
  });
});
