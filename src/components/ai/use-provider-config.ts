import { useEffect, useState } from "react";
import {
  knownProviderConfig,
  loadProviderConfig,
  subscribeProviderConfig,
} from "@/components/ai/provider-config";
import type { AppConfig } from "@/lib/tauri";

export function useProviderConfig(enabled = true): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(() => knownProviderConfig());
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const unsubscribe = subscribeProviderConfig((next) => {
      if (active) setConfig(next);
    });
    void loadProviderConfig()
      .then((next) => {
        if (active) setConfig(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled]);
  return config;
}
