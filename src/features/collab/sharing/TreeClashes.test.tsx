// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useTreeClashes } from "@/components/collab/tree-clashes";
import type { CollabTreeClash } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { collabError, fill, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabTreeClashes: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabTreeClashes: mocks.collabTreeClashes,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

import { TreeClashes } from "./TreeClashes";

const PLOT: CollabTreeClash = { path: "figs/plot (from Bob Smith).png", name: "plot.png", other: "figs/plot.png" };
const MAIN: CollabTreeClash = { path: "main (a1b2c3).tex", name: "main.tex", other: "Main.tex" };

const label = (clash: CollabTreeClash) => fill(enCollab.tree.clash, { other: clash.other, name: clash.name });
const labels = () => useTreeClashes.getState().labels;

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.collabTreeClashes.mockResolvedValue([PLOT]);
  useTreeClashes.setState({ labels: new Map() });
  useCollabLiveStore.setState({ projectId: "grant", share: shareInfo(), status: { state: "online" } });
});

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, share: null, status: null });
});

describe("TreeClashes", () => {
  it("labels every renamed file with its original name and the other file", async () => {
    mocks.collabTreeClashes.mockResolvedValue([PLOT, MAIN]);
    render(<TreeClashes />);
    await waitFor(() => expect(labels().size).toBe(2));
    expect(mocks.collabTreeClashes).toHaveBeenCalledWith("grant");
    expect(labels().get(PLOT.path)).toBe(label(PLOT));
    expect(labels().get(MAIN.path)).toBe(label(MAIN));
  });

  it("reads the names again after a structural change in this project only", async () => {
    render(<TreeClashes />);
    await waitFor(() => expect(labels().size).toBe(1));
    act(() => mocks.listeners.get("project-folder-changed")?.({ payload: { projectId: "thesis", paths: [], rescan: false, structural: true } }));
    expect(mocks.collabTreeClashes).toHaveBeenCalledTimes(1);
    mocks.collabTreeClashes.mockResolvedValue([]);
    act(() => mocks.listeners.get("project-folder-changed")?.({ payload: { projectId: "grant", paths: [], rescan: false, structural: true } }));
    await waitFor(() => expect(labels().size).toBe(0));
    expect(mocks.collabTreeClashes).toHaveBeenCalledTimes(2);
  });

  it("asks nothing and marks nothing until the project is live", async () => {
    useCollabLiveStore.setState({ status: null });
    useTreeClashes.setState({ labels: new Map([["stale.png", "stale"]]) });
    render(<TreeClashes />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.collabTreeClashes).not.toHaveBeenCalled();
    expect(labels().size).toBe(0);
  });

  it("keeps the marks it had when reading fails and clears them when it goes away", async () => {
    const view = render(<TreeClashes />);
    await waitFor(() => expect(labels().size).toBe(1));
    mocks.collabTreeClashes.mockRejectedValue(collabError("internal"));
    act(() => mocks.listeners.get("project-folder-changed")?.({ payload: { projectId: "grant", paths: [], rescan: true, structural: true } }));
    await waitFor(() => expect(mocks.collabTreeClashes).toHaveBeenCalledTimes(2));
    expect(labels().get(PLOT.path)).toBe(label(PLOT));
    view.unmount();
    expect(labels().size).toBe(0);
  });

  it("drops an answer for a project that is no longer open", async () => {
    let answer: (clashes: CollabTreeClash[]) => void = () => undefined;
    mocks.collabTreeClashes.mockImplementationOnce(() => new Promise<CollabTreeClash[]>((resolve) => (answer = resolve)));
    mocks.collabTreeClashes.mockResolvedValue([]);
    render(<TreeClashes />);
    act(() => useCollabLiveStore.setState({ projectId: "thesis" }));
    await waitFor(() => expect(mocks.collabTreeClashes).toHaveBeenCalledWith("thesis"));
    await act(async () => answer([PLOT]));
    expect(labels().size).toBe(0);
  });
});
