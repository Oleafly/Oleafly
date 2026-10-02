// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({ searchDocs: vi.fn() }));

vi.mock("@/lib/tauri", () => ({ searchDocs: mocks.searchDocs }));

import { DOC_SEARCH_DELAY_MS, useDocSearch } from "./use-doc-search";

function hit(projectId: string, line: number): SearchHit {
  return {
    project_id: projectId,
    project_name: projectId,
    path: "main.tex",
    line,
    preview: "text",
  } as SearchHit;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function settle(ms = DOC_SEARCH_DELAY_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.searchDocs.mockReset().mockResolvedValue([hit("a", 1), hit("b", 2)]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocSearch", () => {
  it("searches the trimmed query after the delay and filters by project", async () => {
    const view = renderHook(({ query }) => useDocSearch(query, { projectId: "a" }), {
      initialProps: { query: "" },
    });
    expect(view.result.current).toEqual({ term: "", hits: [], loading: false });

    view.rerender({ query: "  needle " });
    expect(view.result.current.loading).toBe(true);
    expect(mocks.searchDocs).not.toHaveBeenCalled();

    await settle();
    expect(mocks.searchDocs).toHaveBeenCalledExactlyOnceWith("needle");
    expect(view.result.current.hits).toEqual([hit("a", 1)]);
    expect(view.result.current.loading).toBe(false);
  });

  it("returns every project's hits without a project filter", async () => {
    const view = renderHook(() => useDocSearch("needle"));
    await settle(0);
    expect(view.result.current.hits).toHaveLength(2);
  });

  it("ignores an older search that finishes after a newer one starts", async () => {
    const first = deferred<SearchHit[]>();
    mocks.searchDocs.mockReturnValueOnce(first.promise).mockResolvedValueOnce([hit("b", 9)]);
    const view = renderHook(({ query }) => useDocSearch(query), {
      initialProps: { query: "one" },
    });
    view.rerender({ query: "two" });
    await settle();
    await act(async () => first.resolve([hit("a", 1)]));
    expect(view.result.current.hits).toEqual([hit("b", 9)]);
  });

  it("clears at once when the query empties and drops a search still in flight", async () => {
    const pending = deferred<SearchHit[]>();
    mocks.searchDocs.mockReturnValueOnce(pending.promise);
    const view = renderHook(({ query }) => useDocSearch(query), {
      initialProps: { query: "one" },
    });
    view.rerender({ query: "" });
    await act(async () => pending.resolve([hit("a", 1)]));
    expect(view.result.current).toEqual({ term: "", hits: [], loading: false });
  });

  it("treats a failed search as no hits and stays idle while disabled", async () => {
    mocks.searchDocs.mockRejectedValueOnce(new Error("offline"));
    const view = renderHook(({ enabled }) => useDocSearch("needle", { enabled }), {
      initialProps: { enabled: true },
    });
    await settle(0);
    expect(view.result.current).toEqual({ term: "needle", hits: [], loading: false });

    view.rerender({ enabled: false });
    expect(view.result.current).toEqual({ term: "", hits: [], loading: false });
  });
});
