import { CLOUD_ATTENTION_HINT_ID } from "@/components/cloud/cloud-attention";
import {
  CHANGE_DELAY_MS,
  FIRST_ROUND_DELAY_MS,
  MIN_ROUND_GAP_MS,
  SETTINGS_DEBOUNCE_MS,
  nextCheckDelay,
  waitRetryDelay,
} from "@/components/cloud/cloud-schedule";
import { CloudSettingsChoiceDialog } from "@/components/cloud/CloudSettingsChoiceDialog";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { loadNamespace } from "@/i18n/lazy-namespaces";
import { useCatalogUpdates } from "@/i18n/use-catalog-updates";
import { CLOUD_PROGRESS_EVENT, cloudWaitForChanges, type CloudProgress } from "@/lib/cloud";
import { logError } from "@/lib/log";
import { watchSettingsSources } from "@/lib/settings-file/transfer";
import { SET_THEME_PREFERENCE_EVENT, TOGGLE_THEME_EVENT } from "@/lib/theme";
import { THEME_CUSTOMIZATION_CHANGED_EVENT } from "@/lib/theme-customization";
import { cloudAttentionReasons, useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { isTauri } from "@tauri-apps/api/core";
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

function savedSomething(
  files: Readonly<Record<string, { dirty: boolean }>>,
  previous: Readonly<Record<string, { dirty: boolean }>>,
): boolean {
  if (files === previous) return false;
  return Object.entries(previous).some(([path, before]) => before.dirty && files[path] !== undefined && !files[path].dirty);
}

export default function CloudSyncKeeper() {
  const auto = useCloudStore((s) => s.autoSync);
  const active = useCloudStore((s) => s.status === "connected" && s.state?.enabled === true);
  const noteProgress = useCloudStore((s) => s.noteProgress);
  const attention = useCloudAttention();
  const mountedAt = useRef(Date.now());
  const lastRoundAt = useRef<number | null>(null);

  useEffect(() => {
    loadNamespace("cloud").catch((error: unknown) => logError("load cloud sync strings", error));
    void useCloudStore.getState().refresh();
  }, []);

  useTauriEvent<CloudProgress>(
    CLOUD_PROGRESS_EVENT,
    (progress) => {
      if (progress) noteProgress(progress);
    },
    isTauri(),
  );

  useEffect(() => {
    if (!active || !auto) return;
    let timer: number | undefined;
    let pause: number | undefined;
    let wake: (() => void) | null = null;
    let running = false;
    let again = false;
    let stopped = false;
    let waiting: Array<() => void> = [];

    const settle = () => {
      const done = waiting;
      waiting = [];
      for (const resolve of done) resolve();
    };

    const delay = () => {
      const last = lastRoundAt.current;
      if (last === null) return Math.max(0, mountedAt.current + FIRST_ROUND_DELAY_MS - Date.now());
      const wait = nextCheckDelay(document.hidden, useCloudStore.getState().failureStreak);
      return Math.max(0, last + wait - Date.now());
    };

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(() => void round(), ms);
    };

    const round = async () => {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        await useCloudStore.getState().syncNow(false);
      } finally {
        running = false;
        lastRoundAt.current = Date.now();
        settle();
        if (again) {
          again = false;
          schedule(MIN_ROUND_GAP_MS);
        } else {
          schedule(delay());
        }
      }
    };

    const soon = () => {
      if (running) {
        again = true;
        return;
      }
      const last = lastRoundAt.current;
      const gap = last === null ? 0 : last + MIN_ROUND_GAP_MS - Date.now();
      schedule(Math.max(CHANGE_DELAY_MS, gap));
    };

    const roundDone = () =>
      new Promise<void>((resolve) => {
        if (stopped) resolve();
        else waiting.push(resolve);
      });

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        wake = resolve;
        pause = window.setTimeout(resolve, ms);
      });

    const checkDropbox = async (failures: number) => {
      try {
        const result = await cloudWaitForChanges();
        if (result.changes && !stopped) {
          soon();
          await roundDone();
        }
        return { failures: 0, wait: result.retryAfterMs ?? 0 };
      } catch (error) {
        if (failures === 0 && !stopped) void logError("cloud wait for changes", error);
        return { failures: failures + 1, wait: waitRetryDelay(failures + 1) };
      }
    };

    const watchDropbox = async (failures: number) => {
      if (stopped) return;
      const next = await checkDropbox(failures);
      if (next.wait > 0 && !stopped) await sleep(next.wait);
      void watchDropbox(next.failures);
    };

    const stopWatchingRounds = useCloudStore.subscribe((state, previous) => {
      if (!previous.syncing || state.syncing) return;
      lastRoundAt.current = Date.now();
      settle();
      if (!running) schedule(delay());
    });

    const stopWatchingSaves = useFilesStore.subscribe((state, previous) => {
      if (savedSomething(state.files, previous.files)) soon();
    });

    const onVisibility = () => {
      if (running) return;
      const last = lastRoundAt.current;
      if (!document.hidden && last !== null && Date.now() - last >= nextCheckDelay(false, 0)) soon();
      else schedule(delay());
    };
    const onOnline = () => soon();

    schedule(delay());
    void watchDropbox(0);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(pause);
      wake?.();
      settle();
      stopWatchingRounds();
      stopWatchingSaves();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [active, auto]);

  useEffect(() => {
    if (!active || !auto) return;
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
  }, [active, auto]);

  return (
    <>
      {attention ? <CloudAttentionHint /> : null}
      <CloudSettingsChoiceDialog />
    </>
  );
}
