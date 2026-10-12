// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { CollabSyncPaused } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  collabSyncDecide: vi.fn(),
  handlers: {} as Record<string, ((payload: unknown) => void) | undefined>,
}));

function listener(name: string) {
  return vi.fn(async (handler: (payload: unknown) => void) => {
    mocks.handlers[name] = handler;
    return () => {
      if (mocks.handlers[name] === handler) mocks.handlers[name] = undefined;
    };
  });
}

vi.mock("@/lib/tauri", () => ({
  collabSyncDecide: mocks.collabSyncDecide,
  onCollabSyncPaused: listener("paused"),
  onCollabSyncResumed: listener("resumed"),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return { useFilesStore: create(() => ({ projectId: "paper" as string | null })) };
});

import { useFilesStore } from "@/store/files";
import { useProjectAvailabilityStore } from "@/store/project-availability";
import { startSyncPause } from "./sync-pause";
import { SyncPauseBanner } from "./SyncPauseBanner";

const labels = enShell.collabSync;

function pause(payload: Partial<CollabSyncPaused> = {}) {
  act(() =>
    mocks.handlers.paused?.({
      projectId: "paper",
      changed: 12,
      total: 40,
      reason: "mass_change",
      ...payload,
    } satisfies CollabSyncPaused),
  );
}

let stop: () => void = () => {};

beforeEach(async () => {
  mocks.collabSyncDecide.mockReset();
  mocks.collabSyncDecide.mockResolvedValue(undefined);
  useFilesStore.setState({ projectId: "paper" });
  useProjectAvailabilityStore.getState().reset("paper");
  stop = startSyncPause();
  await waitFor(() => expect(mocks.handlers.resumed).toBeDefined());
});

afterEach(() => {
  stop();
  useProjectAvailabilityStore.getState().reset(null);
});

describe("sync pause banner", () => {
  it("stays out of the way until outside changes wait for a decision", () => {
    render(<SyncPauseBanner />);
    expect(screen.queryByTestId("collab-sync-pause-banner")).not.toBeInTheDocument();
  });

  it("asks whether to send the outside changes and counts them", () => {
    render(<SyncPauseBanner />);
    pause({ changed: 12 });

    const banner = screen.getByTestId("collab-sync-pause-banner");
    expect(banner).toHaveTextContent(
      "12 files changed outside Oleafly. Send these changes to everyone, or keep them local?",
    );
    expect(screen.getByRole("button", { name: labels.send })).toBeEnabled();
    expect(screen.getByRole("button", { name: labels.keepLocal })).toBeEnabled();
  });

  it("sits on the same opaque surface as the other workspace banners", () => {
    render(<SyncPauseBanner />);
    pause();

    const banner = screen.getByTestId("collab-sync-pause-banner");
    expect(banner.className).toContain("bg-[color-mix(in_srgb,var(--primary)_5%,var(--background))]");
    expect(banner.className).not.toMatch(/(^|\s)bg-[\w-]+\/\d+/);
  });

  it("sends the changes when asked and goes away", async () => {
    render(<SyncPauseBanner />);
    pause();

    fireEvent.click(screen.getByRole("button", { name: labels.send }));

    await waitFor(() => expect(screen.queryByTestId("collab-sync-pause-banner")).not.toBeInTheDocument());
    expect(mocks.collabSyncDecide).toHaveBeenCalledExactlyOnceWith("paper", "send");
  });

  it("keeps the changes local when asked and goes away", async () => {
    render(<SyncPauseBanner />);
    pause();

    fireEvent.click(screen.getByRole("button", { name: labels.keepLocal }));

    await waitFor(() => expect(screen.queryByTestId("collab-sync-pause-banner")).not.toBeInTheDocument());
    expect(mocks.collabSyncDecide).toHaveBeenCalledExactlyOnceWith("paper", "keep_local");
  });

  it("holds both buttons while a decision is on its way", async () => {
    let finish: () => void = () => {};
    mocks.collabSyncDecide.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(<SyncPauseBanner />);
    pause();

    fireEvent.click(screen.getByRole("button", { name: labels.send }));

    const send = screen.getByRole("button", { name: labels.send });
    const keep = screen.getByRole("button", { name: labels.keepLocal });
    expect(send).toBeDisabled();
    expect(keep).toBeDisabled();
    expect(send.querySelector(".animate-spin")).not.toBeNull();
    expect(keep.querySelector(".animate-spin")).toBeNull();
    await act(async () => finish());
  });

  it("asks only about the open project", () => {
    render(<SyncPauseBanner />);
    pause({ projectId: "thesis" });

    expect(screen.queryByTestId("collab-sync-pause-banner")).not.toBeInTheDocument();
  });

  it("says the folder is unavailable without asking anything and clears when it is back", () => {
    render(<SyncPauseBanner />);
    pause();
    pause({ changed: 0, reason: "root_unavailable" });

    const gone = screen.getByTestId("collab-sync-unavailable-banner");
    expect(gone).toHaveTextContent(labels.unavailable);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collab-sync-pause-banner")).not.toBeInTheDocument();

    act(() => mocks.handlers.resumed?.({ projectId: "paper" }));

    expect(screen.queryByTestId("collab-sync-unavailable-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("collab-sync-pause-banner")).toBeInTheDocument();
  });

  it("leaves an unreachable folder to the folder banner that already explains it", () => {
    render(<SyncPauseBanner />);
    act(() => useProjectAvailabilityStore.getState().report("paper", "missing"));
    pause({ changed: 0, reason: "root_unavailable" });

    expect(screen.queryByTestId("collab-sync-unavailable-banner")).not.toBeInTheDocument();
  });
});
