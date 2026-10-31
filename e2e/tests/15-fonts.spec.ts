import { test, expect } from "../fixtures";
import { openProject, openSettings } from "../helpers";

test("a font component downloads, installs, and removes", async ({ tauriPage }) => {
  test.skip(process.env.E2E_SKIP_NETWORK === "1", "network-dependent");
  test.setTimeout(300_000);

  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "downloads");

  const packButton = tauriPage.locator('[data-e2e-font-pack="ptserif"] button');
  await expect(packButton).toBeVisible();
  await expect(packButton).toContainText("Download");

  await packButton.click();
  await expect(packButton).toContainText("Remove", { timeout: 240_000 });
  // The row re-renders with Remove before the busy flag clears, and the
  // bridge's click does not wait for actionability like real Playwright.
  await expect(packButton).toBeEnabled({ timeout: 20_000 });

  await packButton.click();
  await expect(packButton).toContainText("Download", { timeout: 30_000 });

  await tauriPage.click('[aria-label="Close settings"]');
});
