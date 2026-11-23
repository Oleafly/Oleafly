import { useEffect, useState } from "react";
import {
  knownProviderConfig,
  loadProviderConfig,
  subscribeProviderConfig,
} from "@/components/ai/provider-config";
import type { AppConfig } from "@/lib/tauri";

export interface ProviderConfigState {
  config: AppConfig | null;
  failed: boolean;
}

export function useProviderConfig(): ProviderConfigState {
  const [state, setState] = useState<ProviderConfigState>(() => ({
    config: knownProviderConfig(),
    failed: false,
  }));
  useEffect(() => {
    let active = true;
    const take = (config: AppConfig) => {
      if (active) setState({ config, failed: false });
    };
    const unsubscribe = subscribeProviderConfig(take);
    loadProviderConfig().then(take, () => {
      if (active) setState((current) => ({ ...current, failed: true }));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state;
}
