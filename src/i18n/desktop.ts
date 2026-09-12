import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { locale as osLocale } from "@tauri-apps/plugin-os";
import {
  isLocalePreference,
  isSupportedLocale,
  resolvePreference,
  type LocalePreference,
} from "@oleafly/i18n-contract";
import {
  applyLocale,
  cachePreference,
  currentLocale,
  initializeI18n,
  LOCALE_CHANGED_EVENT,
  readCachedPreference,
  type MissingKeyMode,
} from "./index";
import { logError } from "@/lib/log";

async function systemLocale(): Promise<string | null> {
  if (isTauri()) {
    try {
      return await osLocale();
    } catch {
      return null;
    }
  }
  return typeof navigator === "undefined" ? null : navigator.language;
}

const missingKeyMode: MissingKeyMode = import.meta.env.DEV ? "warn" : "log";

export async function initializeDesktopI18n(): Promise<void> {
  await initializeI18n({ preference: readCachedPreference(), systemLocale, missingKeyMode });
  await listenForLocaleChanges();
}

export async function listenForLocaleChanges(): Promise<void> {
  if (!isTauri()) return;
  try {
    await listen<{ locale: string; preference?: string }>(LOCALE_CHANGED_EVENT, (event) => {
      const { locale, preference } = event.payload;
      if (isLocalePreference(preference)) cachePreference(preference);
      if (isSupportedLocale(locale) && locale !== currentLocale()) void applyLocale(locale);
    });
  } catch (error) {
    void logError("locale change listener", error);
  }
}

export async function changeLocalePreference(preference: LocalePreference): Promise<void> {
  cachePreference(preference);
  const resolved = resolvePreference(preference, preference === "system" ? await systemLocale() : null);
  if (resolved !== currentLocale()) await applyLocale(resolved);
  if (!isTauri()) return;
  try {
    await invoke<string>("set_ui_locale", { preference });
  } catch (error) {
    void logError("set_ui_locale", error);
  }
}

export async function syncLocaleFromConfig(uiLocale: string | undefined): Promise<void> {
  if (!isLocalePreference(uiLocale) || uiLocale === readCachedPreference()) return;
  cachePreference(uiLocale);
  const resolved = resolvePreference(uiLocale, uiLocale === "system" ? await systemLocale() : null);
  if (resolved !== currentLocale()) await applyLocale(resolved);
}
