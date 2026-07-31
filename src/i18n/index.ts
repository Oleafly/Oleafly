import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";
import {
  resolveSystemLocale,
  type LocalePreference,
  type SupportedLocale,
} from "./locale";

export const i18n = createInstance();

function setDocumentLocale(language: SupportedLocale): void {
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
}

export async function initializeI18n(preference: LocalePreference): Promise<SupportedLocale> {
  const language = preference === "system" ? await resolveSystemLocale() : preference;

  try {
    await i18n.use(initReactI18next).init({
      debug: false,
      defaultNS: "common",
      enableSelector: "strict",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      lng: language,
      ns: ["common", "settings", "errors"],
      resources,
      returnNull: false,
      supportedLngs: ["en"],
    });
  } catch {
    if (!i18n.isInitialized) {
      await i18n.use(initReactI18next).init({
        defaultNS: "common",
        enableSelector: "strict",
        fallbackLng: "en",
        interpolation: { escapeValue: false },
        lng: "en",
        ns: ["common", "settings", "errors"],
        resources,
        returnNull: false,
        supportedLngs: ["en"],
      });
    } else {
      await i18n.changeLanguage("en");
    }
    setDocumentLocale("en");
    return "en";
  }

  setDocumentLocale(language);
  return language;
}

export async function changeLocale(preference: LocalePreference): Promise<SupportedLocale> {
  const language = preference === "system" ? await resolveSystemLocale() : preference;
  await i18n.changeLanguage(language);
  setDocumentLocale(language);
  return language;
}
