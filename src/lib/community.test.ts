import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  DISCORD_URL,
  discordGetCommunityStats,
  resetDiscordCommunityStatsCache,
} from "./community";

describe("community", () => {
  beforeEach(() => {
    invoke.mockReset();
    resetDiscordCommunityStatsCache();
  });

  it("links to the redirect Oleafly controls, never to a raw invite", () => {
    expect(DISCORD_URL).toBe("https://oleafly.com/discord");
  });

  it("loads the online count through Rust once and shares it between surfaces", async () => {
    invoke.mockResolvedValue({ online: 12 });

    await expect(discordGetCommunityStats()).resolves.toEqual({ online: 12 });
    await expect(discordGetCommunityStats()).resolves.toEqual({ online: 12 });

    expect(invoke).toHaveBeenCalledTimes(1);
    // No argument leaves the webview: the guild is fixed on the Rust side.
    expect(invoke.mock.calls[0]).toEqual(["discord_community_stats"]);
  });

  it("forgets a failed request so the next surface can retry", async () => {
    invoke.mockRejectedValueOnce(new Error("network error"));
    await expect(discordGetCommunityStats()).rejects.toThrow("network error");

    invoke.mockResolvedValue({ online: 3 });
    await expect(discordGetCommunityStats()).resolves.toEqual({ online: 3 });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("turns a bridge that throws synchronously into a rejection", async () => {
    invoke.mockImplementation(() => {
      throw new TypeError("no Tauri runtime");
    });

    await expect(discordGetCommunityStats()).rejects.toThrow("no Tauri runtime");
  });
});
