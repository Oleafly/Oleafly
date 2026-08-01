import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";
import {
  resolveSystemLocale,
  SUPPORTED_LOCALES,
  type LocalePreference,
  type SupportedLocale,
} from "./locale";

const FALLBACK_LOCALE: SupportedLocale = "en";
const NAMESPACES = Object.keys(resources[FALLBACK_LOCALE]) as Array<
  keyof (typeof resources)[typeof FALLBACK_LOCALE]
>;

export const i18n = createInstance();
i18n.use(initReactI18next);

let initializationError: unknown = null;

/** Non-null when startup fell back to English because init failed for the requested locale. */
export function getInitializationError(): unknown {
  return initializationError;
}

/** The user-facing notice for a failed initialization, safe to call after any successful init. */
export function initializationFailureMessage(): string {
  return i18n.t($ => $.errors.initialization);
}

function setDocumentLocale(language: SupportedLocale): void {
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
}

async function initInstance(language: SupportedLocale): Promise<void> {
  await i18n.init({
    debug: false,
    defaultNS: "common",
    enableSelector: "strict",
    fallbackLng: FALLBACK_LOCALE,
    interpolation: { escapeValue: false },
    lng: language,
    ns: NAMESPACES,
    resources,
    returnNull: false,
    supportedLngs: [...SUPPORTED_LOCALES],
  });
}

export async function initializeI18n(preference: LocalePreference): Promise<SupportedLocale> {
  let language = preference === "system" ? await resolveSystemLocale() : preference;

  try {
    await initInstance(language);
  } catch (error) {
    // Retrying with English only makes sense when the failure could be
    // locale-specific; an identical retry would reproduce the same failure,
    // so let bootstrap surface it instead of blanking the window silently.
    if (language === FALLBACK_LOCALE) throw error;
    initializationError = error;
    language = FALLBACK_LOCALE;
    await initInstance(language);
  }

  setDocumentLocale(language);
  return language;
}

let changeSequence = 0;

export async function changeLocale(preference: LocalePreference): Promise<SupportedLocale> {
  // Resolving "system" awaits an IPC round trip, so rapid successive changes
  // can resolve out of order; only the latest request may apply.
  const sequence = ++changeSequence;
  const language = preference === "system" ? await resolveSystemLocale() : preference;
  if (sequence !== changeSequence) return language;
  await i18n.changeLanguage(language);
  if (sequence !== changeSequence) return language;
  setDocumentLocale(language);
  return language;
}
