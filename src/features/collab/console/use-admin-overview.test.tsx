// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_ID, collabError, deferred } from "../tests/fixtures";
import { overview } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({ collabAdminOverview: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

import { useAdminOverview } from "./use-admin-overview";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAdminOverview", () => {
  it("keeps showing the last overview while it reloads", async () => {
    const next = deferred<ReturnType<typeof overview>>();
    mocks.collabAdminOverview.mockResolvedValueOnce(overview()).mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useAdminOverview(SERVER_ID));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => result.current.reload());
    expect(result.current.state.status).toBe("ready");
    await act(async () => next.resolve(overview({ version: "0.2.0" })));
    expect(result.current.state).toEqual({ status: "ready", overview: overview({ version: "0.2.0" }) });
  });

  it("ignores answers for a server it no longer shows", async () => {
    const stale = deferred<ReturnType<typeof overview>>();
    const failing = deferred<ReturnType<typeof overview>>();
    mocks.collabAdminOverview
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce(overview({ server_name: "Other lab" }));
    const { result, rerender } = renderHook(({ id }) => useAdminOverview(id), { initialProps: { id: SERVER_ID } });
    rerender({ id: "second" });
    rerender({ id: "third" });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(async () => {
      stale.resolve(overview());
      failing.reject(collabError("forbidden"));
    });
    expect(result.current.state).toEqual({ status: "ready", overview: overview({ server_name: "Other lab" }) });
  });
});
