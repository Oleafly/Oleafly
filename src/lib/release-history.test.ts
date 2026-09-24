// @vitest-environment jsdom
import { createElement, useEffect } from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  releaseEntriesFrom,
  stableVersionOf,
  useReleaseHistory,
  type ReleaseEntry,
  type ReleasePageFetcher,
} from "./release-history";

function entry(version: string): ReleaseEntry {
  return {
    version,
    publishedAt: "2026-09-01T00:00:00Z",
    body: `## What's new in ${version}`,
    url: `https://github.com/Oleafly/Oleafly/releases/tag/v${version}`,
  };
}

function pagedFetcher(pages: ReleaseEntry[][]): ReleasePageFetcher & { calls: number[] } {
  const calls: number[] = [];
  const fetcher = (async (page: number) => {
    calls.push(page);
    const entries = pages[page - 1] ?? [];
    return { entries, more: page <= pages.length };
  }) as ReleasePageFetcher & { calls: number[] };
  fetcher.calls = calls;
  return fetcher;
}

describe("release tags and versions", () => {
  it("accepts only stable desktop tags", () => {
    expect(stableVersionOf("v0.4.2")).toBe("0.4.2");
    expect(stableVersionOf("v0.4.3-rc.1")).toBeNull();
    expect(stableVersionOf("cli-v0.1.0")).toBeNull();
    expect(stableVersionOf("0.4.2")).toBeNull();
  });

  it("orders versions numerically, not as text", () => {
    expect(compareVersions("0.3.10", "0.3.9")).toBe(1);
    expect(compareVersions("0.4.0", "0.3.13")).toBe(1);
    expect(compareVersions("v0.4.2", "0.4.2")).toBe(0);
    expect(compareVersions("0.4.1", "0.4.2")).toBe(-1);
  });

  it("drops drafts, prereleases, CLI tags and malformed items from a GitHub page", () => {
    const entries = releaseEntriesFrom([
      { tag_name: "v0.4.2", body: "notes", published_at: "2026-09-21T07:47:46Z", html_url: "https://github.com/x" },
      { tag_name: "v0.4.3", draft: true },
      { tag_name: "v0.4.3-rc.1", prerelease: true },
      { tag_name: "cli-v0.1.0" },
      { tag_name: 42 },
      null,
      { tag_name: "v0.4.1", body: null },
    ]);
    expect(entries.map((item) => item.version)).toEqual(["0.4.2", "0.4.1"]);
    expect(entries[1].body).toBe("");
    expect(entries[1].url).toBe("https://github.com/Oleafly/Oleafly/releases/tag/v0.4.1");
    expect(releaseEntriesFrom({ message: "rate limited" })).toEqual([]);
  });
});

describe("useReleaseHistory", () => {
  it("reveals one release per request, newest first, between the installed and the new version", async () => {
    const fetchPage = pagedFetcher([
      [entry("0.4.3"), entry("0.4.2"), entry("0.4.1")],
      [entry("0.4.0"), entry("0.3.13"), entry("0.3.12")],
    ]);
    const { result } = renderHook(() =>
      useReleaseHistory({ newerThan: "0.3.13", olderThan: "0.4.3", fetchPage, enabled: true }),
    );
    expect(result.current.status).toBe("idle");

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries.map((item) => item.version)).toEqual(["0.4.2"]));
    expect(result.current.status).toBe("idle");

    act(() => result.current.loadMore());
    expect(result.current.entries.map((item) => item.version)).toEqual(["0.4.2", "0.4.1"]);
    expect(fetchPage.calls).toEqual([1]);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries.map((item) => item.version)).toEqual(["0.4.2", "0.4.1", "0.4.0"]));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(fetchPage.calls).toEqual([1, 2]);
  });

  it("keeps paging when a page holds nothing newer than the installed version but more pages exist", async () => {
    const fetchPage = pagedFetcher([[entry("0.5.0")], [entry("0.4.2")], [entry("0.4.1")]]);
    const { result } = renderHook(() =>
      useReleaseHistory({ newerThan: "0.4.1", olderThan: "0.4.3", fetchPage, enabled: true }),
    );
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries.map((item) => item.version)).toEqual(["0.4.2"]));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(fetchPage.calls).toEqual([1, 2, 3]);
  });

  it("finishes at once when nothing sits between the installed and the new version", async () => {
    const fetchPage = pagedFetcher([[entry("0.4.3"), entry("0.4.2")]]);
    const { result } = renderHook(() =>
      useReleaseHistory({ newerThan: "0.4.2", olderThan: "0.4.3", fetchPage, enabled: true }),
    );
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.entries).toEqual([]);
  });

  it("reports a failed page and loads it again on retry", async () => {
    let fail = true;
    const fetchPage: ReleasePageFetcher = vi.fn(async () => {
      if (fail) throw new Error("status 403");
      return { entries: [entry("0.4.2")], more: true };
    });
    const { result } = renderHook(() =>
      useReleaseHistory({ newerThan: "0.4.0", olderThan: "0.4.3", fetchPage, enabled: true }),
    );
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.status).toBe("error"));
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.entries.map((item) => item.version)).toEqual(["0.4.2"]));
  });

  it("keeps a request a child starts in its mount effect, which runs before the hook's own effects", async () => {
    const fetchPage = pagedFetcher([[entry("0.4.2"), entry("0.4.1")]]);
    function Child({ onMount, versions }: { onMount: () => void; versions: string }) {
      useEffect(() => onMount(), [onMount]);
      return createElement("output", null, versions);
    }
    function Parent() {
      const history = useReleaseHistory({ newerThan: "0.4.0", olderThan: "0.4.3", fetchPage, enabled: true });
      return createElement(Child, {
        onMount: history.loadMore,
        versions: history.entries.map((item) => item.version).join(","),
      });
    }
    render(createElement(Parent));
    expect(await screen.findByText("0.4.2")).toBeTruthy();
  });

  it("starts over when the versions change and ignores the old request", async () => {
    let resolveFirst!: (value: { entries: ReleaseEntry[]; more: boolean }) => void;
    const fetchPage: ReleasePageFetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue({ entries: [entry("0.5.1")], more: true });
    const { result, rerender } = renderHook(
      ({ latest }) => useReleaseHistory({ newerThan: "0.4.0", olderThan: latest, fetchPage, enabled: true }),
      { initialProps: { latest: "0.4.3" } },
    );
    act(() => result.current.loadMore());
    rerender({ latest: "0.5.2" });
    await act(async () => resolveFirst({ entries: [entry("0.4.2")], more: true }));
    expect(result.current.entries).toEqual([]);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries.map((item) => item.version)).toEqual(["0.5.1"]));
  });

  it("stays finished and fetches nothing while disabled", () => {
    const fetchPage = pagedFetcher([[entry("0.4.2")]]);
    const { result } = renderHook(() =>
      useReleaseHistory({ newerThan: "0.4.0", olderThan: "0.4.3", fetchPage, enabled: false }),
    );
    act(() => result.current.loadMore());
    expect(result.current.status).toBe("done");
    expect(fetchPage.calls).toEqual([]);
  });

  it("lists every release down to the oldest when unbounded, for the changelog", async () => {
    const fetchPage = pagedFetcher([[entry("0.4.3"), entry("0.4.2")], [entry("0.1.0")]]);
    const { result } = renderHook(() => useReleaseHistory({ fetchPage, enabled: true }));
    for (const expected of [["0.4.3"], ["0.4.3", "0.4.2"], ["0.4.3", "0.4.2", "0.1.0"]]) {
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.entries.map((item) => item.version)).toEqual(expected));
    }
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(fetchPage.calls).toEqual([1, 2, 3]);
  });
});
