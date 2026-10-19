// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registry } from "@oleafly/registry";

const attention = vi.hoisted(() => ({
  listen: vi.fn(async () => () => {}),
  load: vi.fn(async () => ({ byProject: { paper: 3, thesis: 1 } })),
}));

vi.mock("@/lib/research-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-tasks")>()),
  listenForResearchAttention: attention.listen,
  loadResearchAttention: attention.load,
}));

import { useFilesStore } from "@/store/files";
import { registerRailTabs } from "./tabs";

function researchBadge(): () => number {
  const tab = registry.railTabs.find((entry) => entry.id === "research");
  if (!tab?.useBadge) throw new Error("The Research tab has no badge.");
  return tab.useBadge;
}

beforeEach(() => {
  registry.railTabs.length = 0;
  registerRailTabs();
});

afterEach(() => {
  registry.railTabs.length = 0;
  useFilesStore.setState({ projectId: null });
});

describe("Research rail tab", () => {
  it("shows how many research tasks of the open project need the user", async () => {
    useFilesStore.setState({ projectId: "paper" });
    const useBadge = researchBadge();

    const { result } = renderHook(() => useBadge());

    await waitFor(() => expect(result.current).toBe(3));
    expect(attention.listen).toHaveBeenCalledTimes(1);
    act(() => useFilesStore.setState({ projectId: "thesis" }));
    expect(result.current).toBe(1);
    act(() => useFilesStore.setState({ projectId: "notes" }));
    expect(result.current).toBe(0);
  });
});
