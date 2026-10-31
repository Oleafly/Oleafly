import { useEffect, useState } from "react";
import { discordCommunityStats, type DiscordCommunityStats } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

export type { DiscordCommunityStats };

export const DISCORD_URL = "https://oleafly.com/discord";

let communityStatsRequest: Promise<DiscordCommunityStats> | null = null;

export function discordGetCommunityStats(): Promise<DiscordCommunityStats> {
  if (communityStatsRequest) return communityStatsRequest;

  const request = Promise.resolve()
    .then(() => discordCommunityStats())
    .catch((error) => {
      communityStatsRequest = null;
      throw error;
    });
  communityStatsRequest = request;
  return request;
}

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

export function resetDiscordCommunityStatsCache(): void {
  communityStatsRequest = null;
}
