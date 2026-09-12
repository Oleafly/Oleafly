import { test, expect } from "../fixtures";
import { chooseAppSelectOption, openSettings } from "../helpers";

const LANGUAGE_SELECT = '[data-testid="settings-language"]';

test.describe("interface language", () => {
  test("boots in Simplified Chinese and switches live without a reload", async ({ tauriPage }) => {
    await openSettings(tauriPage, "general");
    const general = tauriPage.locator('[data-testid="settings-section-general"]');
    await expect(general).toContainText("通用");
    await expect(tauriPage.locator("html")).toHaveAttribute("lang", "zh-Hans");

    await chooseAppSelectOption(tauriPage, LANGUAGE_SELECT, { attribute: "data-label", value: "English" });
    await expect(general).toContainText("General");
    await expect(tauriPage.locator("html")).toHaveAttribute("lang", "en");

    await chooseAppSelectOption(tauriPage, LANGUAGE_SELECT, { attribute: "data-label", value: "简体中文" });
    await expect(general).toContainText("通用");
    await expect(tauriPage.locator("html")).toHaveAttribute("lang", "zh-Hans");
  });
});
