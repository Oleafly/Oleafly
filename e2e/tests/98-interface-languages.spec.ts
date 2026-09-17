import { readFileSync } from "node:fs";
import { test, expect } from "../fixtures";
import { chooseAppSelectOption, openSettings } from "../helpers";
import { LOCALE_INFO, SUPPORTED_LOCALES } from "../../packages/i18n-contract/src/locale";

const LANGUAGE_SELECT = '[data-testid="settings-language"]';

function generalSectionTitle(locale: string): string {
  const shell = JSON.parse(
    readFileSync(new URL(`../../src/i18n/locales/${locale}/shell.json`, import.meta.url), "utf8"),
  ) as { settings: { nav: { general: string } } };
  return shell.settings.nav.general;
}

test.describe("interface languages", () => {
  test.describe.configure({ timeout: 240_000 });

  test("every shipped language switches live and renders its own settings copy", async ({ tauriPage }) => {
    await openSettings(tauriPage, "general");
    const general = tauriPage.locator('[data-testid="settings-section-general"]');
    await expect(tauriPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(general).toContainText(generalSectionTitle("en"));

    for (const locale of SUPPORTED_LOCALES.filter((tag) => tag !== "en")) {
      await chooseAppSelectOption(tauriPage, LANGUAGE_SELECT, {
        attribute: "data-label",
        value: LOCALE_INFO[locale].nativeName,
      });
      await expect(tauriPage.locator("html")).toHaveAttribute("lang", locale);
      await expect(general).toContainText(generalSectionTitle(locale));
    }

    await chooseAppSelectOption(tauriPage, LANGUAGE_SELECT, { attribute: "data-label", value: "English" });
    await expect(tauriPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(general).toContainText(generalSectionTitle("en"));
  });
});
