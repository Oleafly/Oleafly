import { initializeI18n } from "/src/i18n";

type LocalePreference = Parameters<typeof initializeI18n>[0]["preference"];

export async function prepareHarnessI18n(preference: LocalePreference = "en"): Promise<void> {
  await initializeI18n({
    preference,
    systemLocale: async () => null,
    missingKeyMode: "throw",
  });
}
