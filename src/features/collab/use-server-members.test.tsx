// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { BOB_ID, SERVER_ID, collabError, deferred, member } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({ collabAdminMembers: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { useServerMembers } from "./use-server-members";

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useServerMembers", () => {
  it("loads the members once and lets a tab change the list", async () => {
    mocks.collabAdminMembers.mockResolvedValue([member()]);
    const { result } = renderHook(() => useServerMembers(SERVER_ID));
    expect(result.current.members).toBeNull();
    await waitFor(() => expect(result.current.members).toHaveLength(1));
    expect(mocks.collabAdminMembers).toHaveBeenCalledWith(SERVER_ID);
    act(() => result.current.update((current) => [...current, member({ account_id: BOB_ID })]));
    expect(result.current.members).toHaveLength(2);
    expect(result.current.loadError).toBeNull();
  });

  it("explains a failure and loads again on retry", async () => {
    mocks.collabAdminMembers.mockRejectedValueOnce(collabError("forbidden")).mockResolvedValueOnce([member()]);
    const { result } = renderHook(() => useServerMembers(SERVER_ID));
    await waitFor(() => expect(result.current.loadError).toBe(enCollab.errors.forbidden));
    act(() => result.current.update((current) => current));
    expect(result.current.members).toBeNull();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.members).toHaveLength(1));
    expect(result.current.loadError).toBeNull();
  });

  it("ignores an answer that arrives after the server changed", async () => {
    const late = deferred<ReturnType<typeof member>[]>();
    mocks.collabAdminMembers.mockReturnValueOnce(late.promise).mockResolvedValueOnce([]);
    const { result, rerender } = renderHook(({ id }) => useServerMembers(id), { initialProps: { id: SERVER_ID } });
    rerender({ id: "other-server" });
    await waitFor(() => expect(result.current.members).toEqual([]));
    await act(async () => late.resolve([member()]));
    expect(result.current.members).toEqual([]);
  });

  it("ignores a failure that arrives after the server changed", async () => {
    const late = deferred<ReturnType<typeof member>[]>();
    mocks.collabAdminMembers.mockReturnValueOnce(late.promise).mockResolvedValueOnce([]);
    const { result, rerender } = renderHook(({ id }) => useServerMembers(id), { initialProps: { id: SERVER_ID } });
    rerender({ id: "other-server" });
    await waitFor(() => expect(result.current.members).toEqual([]));
    await act(async () => late.reject(collabError("forbidden")));
    expect(result.current.loadError).toBeNull();
  });
});
