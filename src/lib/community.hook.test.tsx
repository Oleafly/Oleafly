// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({ discordCommunityStats: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  discordCommunityStats: mocks.discordCommunityStats,
}));

import { resetDiscordCommunityStatsCache, useDiscordOnlineCount } from "./community";

describe("useDiscordOnlineCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDiscordCommunityStatsCache();
    useSettingsStore.setState({ offline: false });
  });

  it("reports how many members are online", async () => {
    mocks.discordCommunityStats.mockResolvedValue({ online: 12 });
    const { result } = renderHook(() => useDiscordOnlineCount());

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(12));
  });

  it("stays null when nobody is online or the request fails, so callers hide the count", async () => {
    mocks.discordCommunityStats.mockResolvedValueOnce({ online: 0 });
    const empty = renderHook(() => useDiscordOnlineCount());
    await waitFor(() => expect(mocks.discordCommunityStats).toHaveBeenCalledTimes(1));
    expect(empty.result.current).toBeNull();
    empty.unmount();

    resetDiscordCommunityStatsCache();
    mocks.discordCommunityStats.mockRejectedValueOnce(new Error("network error"));
    const failed = renderHook(() => useDiscordOnlineCount());
    await waitFor(() => expect(mocks.discordCommunityStats).toHaveBeenCalledTimes(2));
    expect(failed.result.current).toBeNull();
  });

  it("makes no request in offline mode", () => {
    useSettingsStore.setState({ offline: true });
    const { result } = renderHook(() => useDiscordOnlineCount());

    expect(result.current).toBeNull();
    expect(mocks.discordCommunityStats).not.toHaveBeenCalled();
  });
});
