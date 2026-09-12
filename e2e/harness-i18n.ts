import { initializeI18n } from "/src/i18n";

export async function prepareHarnessI18n(): Promise<void> {
  await initializeI18n({
    preference: "en",
    systemLocale: async () => null,
    missingKeyMode: "throw",
  });
}
