// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionSummary } from "@/lib/research-tasks";

const listenForResearchAttention = vi.fn(async (_onSummary: (summary: AttentionSummary) => void) => () => {});
const loadResearchAttention = vi.fn(async (): Promise<AttentionSummary> => ({ byProject: { p1: 2, p2: 1 } }));

vi.mock("@/lib/research-tasks", () => ({
  listenForResearchAttention: (onSummary: (summary: AttentionSummary) => void) =>
    listenForResearchAttention(onSummary),
  loadResearchAttention: () => loadResearchAttention(),
}));

// The badge reads only the open project, so a small store stands in for the files store.
const files = await vi.hoisted(async () => {
  const { create } = await import("zustand");
  return create<{ projectId: string | null }>(() => ({ projectId: null }));
});
vi.mock("@/store/files", () => ({ useFilesStore: files }));

import { useFilesStore } from "@/store/files";
import { startResearchAttention, useResearchAttentionBadge, useResearchAttentionStore } from "./research-attention";

describe("research attention badge", () => {
  beforeEach(() => {
    useResearchAttentionStore.setState({ byProject: {} });
  });

  it("counts attention for the open project only", async () => {
    useFilesStore.setState({ projectId: "p1" });
    const { result } = renderHook(() => useResearchAttentionBadge());
    await act(async () => {
      await startResearchAttention();
    });
    expect(result.current).toBe(2);
  });

  it("listens once no matter how many badges mount", async () => {
    renderHook(() => useResearchAttentionBadge());
    renderHook(() => useResearchAttentionBadge());
    await act(async () => {
      await startResearchAttention();
    });
    expect(listenForResearchAttention).toHaveBeenCalledTimes(1);
  });
});

describe("research attention from a fresh start", () => {
  let attention: typeof import("./research-attention");

  beforeEach(async () => {
    vi.resetModules();
    listenForResearchAttention.mockReset();
    loadResearchAttention.mockReset();
    files.setState({ projectId: "p1" });
    attention = await import("./research-attention");
  });

  it("shows no count while no project is open", async () => {
    files.setState({ projectId: null });
    const { result } = renderHook(() => attention.useResearchAttentionBadge());

    await act(async () => {
      await attention.startResearchAttention();
    });

    expect(attention.useResearchAttentionStore.getState().byProject).toEqual({ p1: 2, p2: 1 });
    expect(result.current).toBe(0);
  });

  it("shows no count for a project with nothing waiting", async () => {
    files.setState({ projectId: "p3" });
    const { result } = renderHook(() => attention.useResearchAttentionBadge());

    await act(async () => {
      await attention.startResearchAttention();
    });

    expect(result.current).toBe(0);
  });

  it("follows the summaries the backend sends and the project that is open", async () => {
    const { result } = renderHook(() => attention.useResearchAttentionBadge());
    await act(async () => {
      await attention.startResearchAttention();
    });
    expect(result.current).toBe(2);

    const onSummary = listenForResearchAttention.mock.calls[0][0];
    act(() => onSummary({ byProject: { p1: 5, p2: 3 } }));
    expect(result.current).toBe(5);

    act(() => files.setState({ projectId: "p2" }));
    expect(result.current).toBe(3);
  });

  it("shares one start between every caller", async () => {
    const first = attention.startResearchAttention();

    expect(attention.startResearchAttention()).toBe(first);
    await first;
    expect(listenForResearchAttention).toHaveBeenCalledTimes(1);
    expect(loadResearchAttention).toHaveBeenCalledTimes(1);
  });

  it("tries again after the summary could not load", async () => {
    loadResearchAttention.mockRejectedValueOnce(new Error("Research tasks are still starting. Try again in a moment."));

    await expect(attention.startResearchAttention()).resolves.toBeUndefined();
    expect(attention.useResearchAttentionStore.getState().byProject).toEqual({});

    await attention.startResearchAttention();
    expect(loadResearchAttention).toHaveBeenCalledTimes(2);
    expect(listenForResearchAttention).toHaveBeenCalledTimes(1);
    expect(attention.useResearchAttentionStore.getState().byProject).toEqual({ p1: 2, p2: 1 });
  });

  it("tries again after it could not listen for changes", async () => {
    listenForResearchAttention.mockRejectedValueOnce(new Error("The event system is not ready."));

    await attention.startResearchAttention();
    expect(loadResearchAttention).not.toHaveBeenCalled();

    await attention.startResearchAttention();
    expect(listenForResearchAttention).toHaveBeenCalledTimes(2);
    expect(attention.useResearchAttentionStore.getState().byProject).toEqual({ p1: 2, p2: 1 });
  });
});
