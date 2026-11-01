// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keeper = vi.hoisted(() => ({ crash: true }));

vi.mock("@/lib/cloud", () => ({
  cloudState: vi.fn(async () => ({ status: "connected" })),
}));

vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn(async () => undefined),
}));

vi.mock("@/components/cloud/CloudSyncKeeper", () => ({
  default: function CrashingKeeper() {
    if (keeper.crash) throw new Error("keeper crashed");
    return <p data-testid="keeper" />;
  },
}));

import { CloudSyncHost } from "@/components/cloud/CloudSyncHost";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

beforeEach(() => {
  keeper.crash = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useFilesStore.setState({ projectId: "thesis" });
  useSettingsStore.setState({ settingsOpen: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  useFilesStore.setState({ projectId: null });
  useSettingsStore.setState({ settingsOpen: false });
});

describe("CloudSyncHost", () => {
  it("starts the keeper again after a crash once another project opens", async () => {
    render(<CloudSyncHost />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByTestId("keeper")).toBeNull();

    keeper.crash = false;
    act(() => useFilesStore.setState({ projectId: "paper" }));

    expect(await screen.findByTestId("keeper")).toBeInTheDocument();
  });
});
