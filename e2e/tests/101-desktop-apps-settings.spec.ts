import { test, expect } from "../fixtures";
import { openSettings, waitLong } from "../helpers";

async function openDesktopAppsTab(page: import("../helpers").Page) {
  const tab = page.locator('[data-testid="integrations-tab-desktop-apps"]');
  await tab.focus();
  await tab.press("Enter");
}

test("without Cua Driver the tab shows the install line and keeps the switch off", async ({ tauriPage }) => {
  const section = '[data-testid="desktop-apps-section"]';
  const install = '[data-testid="desktop-apps-install"]';

  await openSettings(tauriPage, "integrations");
  await openDesktopAppsTab(tauriPage);
  await waitLong(tauriPage, `!!document.querySelector(${JSON.stringify(install)})`, 30_000);

  const line = await tauriPage.evaluate<string>(
    `document.querySelector(${JSON.stringify(`${install} pre`)})?.textContent ?? ""`,
  );
  if (process.platform === "win32") {
    expect(line).toContain("irm https://cua.ai/driver/install.ps1 | iex");
  } else {
    expect(line).toContain("https://cua.ai/driver/install.sh");
  }

  expect(
    await tauriPage.evaluate<string | null>(
      `document.querySelector(${JSON.stringify(`${section} [data-testid="desktop-apps-enable"]`)})?.getAttribute("aria-disabled") ?? null`,
    ),
  ).toBe("true");

  expect(
    await tauriPage.evaluate<boolean>(
      `Array.from(document.querySelectorAll(${JSON.stringify(`${install} button`)})).some((button) => button.disabled)`,
    ),
  ).toBe(true);
});
