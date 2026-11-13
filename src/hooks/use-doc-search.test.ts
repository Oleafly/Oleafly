// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextSearchHit } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({ textSearch: vi.fn() }));

vi.mock("@/lib/tauri", () => ({ textSearch: mocks.textSearch }));

import { DOC_SEARCH_DELAY_MS, useDocSearch } from "./use-doc-search";

function hit(projectId: string, line: number): TextSearchHit {
  return {
    project_id: projectId,
    project_name: projectId,
    path: "main.tex",
    line,
    preview: "text",
    ranges: [],
  };
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

const IDLE = { term: "", hits: [], loading: false, error: null };

beforeEach(() => {
  vi.useFakeTimers();
  mocks.textSearch.mockReset().mockResolvedValue([hit("a", 1), hit("a", 2)]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocSearch", () => {
  it("searches one project with the query split into terms after the delay", async () => {
    const view = renderHook(({ query }) => useDocSearch(query, { projectId: "a" }), {
      initialProps: { query: "" },
    });
    expect(view.result.current).toEqual(IDLE);

    view.rerender({ query: "  needle -hay path:ch1 " });
    expect(view.result.current.loading).toBe(true);
    expect(mocks.textSearch).not.toHaveBeenCalled();

    await settle();
    expect(mocks.textSearch).toHaveBeenCalledExactlyOnceWith("a", {
      mode: "ranked",
      branches: [
        {
          all: [
            { kind: "text", value: "needle" },
            { kind: "path", value: "ch1" },
          ],
          none: [{ kind: "text", value: "hay" }],
        },
      ],
    });
    expect(view.result.current.hits).toEqual([hit("a", 1), hit("a", 2)]);
    expect(view.result.current.loading).toBe(false);
  });

  it("searches every project in the chosen mode, with OR as separate branches", async () => {
    const view = renderHook(() => useDocSearch('"mask (ratio" OR project:thesis', { mode: "regex" }));
    await settle(0);
    expect(mocks.textSearch).toHaveBeenCalledWith(null, {
      mode: "regex",
      branches: [
        { all: [{ kind: "text", value: "mask (ratio" }], none: [] },
        { all: [{ kind: "project", value: "thesis" }], none: [] },
      ],
    });
    expect(view.result.current.hits).toHaveLength(2);
  });

  it("ignores an older search that finishes after a newer one starts", async () => {
    const first = deferred<TextSearchHit[]>();
    mocks.textSearch.mockReturnValueOnce(first.promise).mockResolvedValueOnce([hit("b", 9)]);
    const view = renderHook(({ query }) => useDocSearch(query), {
      initialProps: { query: "one" },
    });
    view.rerender({ query: "two" });
    await settle();
    await act(async () => first.resolve([hit("a", 1)]));
    expect(view.result.current.hits).toEqual([hit("b", 9)]);
  });

  it("clears at once when the query empties and drops a search still in flight", async () => {
    const pending = deferred<TextSearchHit[]>();
    mocks.textSearch.mockReturnValueOnce(pending.promise);
    const view = renderHook(({ query }) => useDocSearch(query), {
      initialProps: { query: "one" },
    });
    view.rerender({ query: "" });
    await act(async () => pending.resolve([hit("a", 1)]));
    expect(view.result.current).toEqual(IDLE);
  });

  it("reports a failed search, such as a bad pattern, and stays idle while disabled", async () => {
    mocks.textSearch.mockRejectedValueOnce(new Error("Not a valid pattern: unclosed group"));
    const view = renderHook(({ enabled }) => useDocSearch("needle", { enabled, mode: "regex" }), {
      initialProps: { enabled: true },
    });
    await settle(0);
    expect(view.result.current).toEqual({ term: "needle", hits: [], loading: false, error: "Not a valid pattern: unclosed group" });

    view.rerender({ enabled: false });
    expect(view.result.current).toEqual(IDLE);
  });

  it("does not search a query that has no usable terms", async () => {
    const view = renderHook(() => useDocSearch("()"));
    await settle(0);
    expect(mocks.textSearch).not.toHaveBeenCalled();
    expect(view.result.current.loading).toBe(false);
  });
});
