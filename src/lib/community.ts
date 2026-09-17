import { useEffect, useState } from "react";
import { discordCommunityStats, type DiscordCommunityStats } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

export type { DiscordCommunityStats };

/**
 * A redirect we control, so the invite behind it can rotate without an app
 * release. Installed copies keep working for as long as oleafly.com does.
 */
export const DISCORD_URL = "https://oleafly.com/discord";

let communityStatsRequest: Promise<DiscordCommunityStats> | null = null;

/**
 * One request per app session, shared by every surface that shows the count.
 * A failure clears the cache so the next surface to open can try again.
 */
export function discordGetCommunityStats(): Promise<DiscordCommunityStats> {
  if (communityStatsRequest) return communityStatsRequest;

  // Started inside a promise chain so a bridge that throws synchronously (no
  // Tauri runtime, as in the browser preview) rejects instead of escaping.
  const request = Promise.resolve()
    .then(() => discordCommunityStats())
    .catch((error) => {
      communityStatsRequest = null;
      throw error;
    });
  communityStatsRequest = request;
  return request;
}

/**
 * How many community members are online, or null while unknown. Stays null in
 * offline mode, when the request fails, and when nobody is online, so callers
 * can simply hide the count.
 */
export function useDiscordOnlineCount(): number | null {
  const offline = useSettingsStore((state) => state.offline);
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    if (offline) {
      setOnline(null);
      return;
    }
    let active = true;
    discordGetCommunityStats()
      .then((stats) => {
        if (active) setOnline(stats.online > 0 ? stats.online : null);
      })
      .catch(() => {
        /* The join link stays useful without a count. */
      });
    return () => {
      active = false;
    };
  }, [offline]);

  return online;
}

/** Test seam: forget the cached request. */
export function resetDiscordCommunityStatsCache(): void {
  communityStatsRequest = null;
}
