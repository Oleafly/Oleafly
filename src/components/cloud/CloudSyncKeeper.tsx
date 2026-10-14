import { CLOUD_ATTENTION_HINT_ID } from "@/components/cloud/cloud-attention";
import {
  FIRST_ROUND_DELAY_MS,
  SETTINGS_DEBOUNCE_MS,
  nextRoundDelay,
} from "@/components/cloud/cloud-schedule";
import { CloudSettingsChoiceDialog } from "@/components/cloud/CloudSettingsChoiceDialog";
import { loadNamespace } from "@/i18n/lazy-namespaces";
import { useCatalogUpdates } from "@/i18n/use-catalog-updates";
import { logError } from "@/lib/log";
import { watchSettingsSources } from "@/lib/settings-file/transfer";
import { SET_THEME_PREFERENCE_EVENT, TOGGLE_THEME_EVENT } from "@/lib/theme";
import { THEME_CUSTOMIZATION_CHANGED_EVENT } from "@/lib/theme-customization";
import { cloudAttentionReasons, useCloudStore } from "@/store/cloud";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

const SETTINGS_EVENTS = [
  "oleafly:ai-config-changed",
  THEME_CUSTOMIZATION_CHANGED_EVENT,
  SET_THEME_PREFERENCE_EVENT,
  TOGGLE_THEME_EVENT,
];

function attentionKey(): string {
  return cloudAttentionReasons(useCloudStore.getState()).join("\n");
}

function CloudAttentionHint() {
  const { t } = useTranslation(["cloud"]);
  useCatalogUpdates("cloud");
  return (
    <p id={CLOUD_ATTENTION_HINT_ID} hidden>
      {t(($) => $.cloud.attention)}
    </p>
  );
}

function useCloudAttention(): boolean {
  const attention = useCloudStore((s) => cloudAttentionReasons(s).length > 0);

  useEffect(() => {
    if (!attention) return;
    const root = document.documentElement;
    root.dataset.cloudAttention = "true";
    return () => {
      delete root.dataset.cloudAttention;
    };
  }, [attention]);

  useEffect(() => {
    let shown = "";
    return useSettingsStore.subscribe((settings, previous) => {
      if (!settings.settingsOpen || previous.settingsOpen || settings.settingsInitialSection !== "general") return;
      if (useTourStore.getState().activeTourId !== null) return;
      const key = attentionKey();
      if (key === "" || key === shown) return;
      shown = key;
      settings.setSettingsInitialSection("data");
      useCloudStore.getState().requestNav("data-cloud");
    });
  }, []);

  return attention;
}

export default function CloudSyncKeeper() {
  const interval = useCloudStore((s) => s.syncInterval);
  const active = useCloudStore((s) => s.status === "connected" && s.state?.enabled === true);
  const attention = useCloudAttention();
  const mountedAt = useRef(Date.now());
  const lastRoundAt = useRef<number | null>(null);

  useEffect(() => {
    loadNamespace("cloud").catch((error: unknown) => logError("load cloud sync strings", error));
    void useCloudStore.getState().refresh();
  }, []);

  useEffect(() => {
    if (!active || interval === "manual") return;
    let timer: number | undefined;
    let running = false;
    let stopped = false;

    const delay = () => {
      const last = lastRoundAt.current;
      if (last === null) return Math.max(0, mountedAt.current + FIRST_ROUND_DELAY_MS - Date.now());
      const wait = nextRoundDelay(interval, document.hidden, useCloudStore.getState().failureStreak);
      return Math.max(0, last + wait - Date.now());
    };

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(() => void round(), ms);
    };

    const round = async () => {
      if (running || stopped) return;
      running = true;
      try {
        await useCloudStore.getState().syncNow(false);
      } finally {
        running = false;
        lastRoundAt.current = Date.now();
        schedule(delay());
      }
    };

    const stopWatchingRounds = useCloudStore.subscribe((state, previous) => {
      if (!previous.syncing || state.syncing) return;
      lastRoundAt.current = Date.now();
      if (!running) schedule(delay());
    });

    const onVisibility = () => {
      if (!running) schedule(delay());
    };
    const onOnline = () => {
      if (!running) schedule(0);
    };

    schedule(delay());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stopWatchingRounds();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [active, interval]);

  useEffect(() => {
    if (!active || interval === "manual") return;
    let debounce: number | undefined;
    const onChange = () => {
      if (useCloudStore.getState().applyingSettings) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        if (useCloudStore.getState().applyingSettings) return;
        void useCloudStore.getState().syncSettings();
      }, SETTINGS_DEBOUNCE_MS);
    };
    const stopWatching = watchSettingsSources(onChange);
    for (const name of SETTINGS_EVENTS) window.addEventListener(name, onChange);
    return () => {
      window.clearTimeout(debounce);
      stopWatching();
      for (const name of SETTINGS_EVENTS) window.removeEventListener(name, onChange);
    };
  }, [active, interval]);

  return (
    <>
      {attention ? <CloudAttentionHint /> : null}
      <CloudSettingsChoiceDialog />
    </>
  );
}
