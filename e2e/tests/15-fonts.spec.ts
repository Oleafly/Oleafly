import { test, expect } from "../fixtures";
import { openProject, openSettings } from "../helpers";

// On-demand font downloads: install a real font pack into the (hermetic)
// assets dir, verify it flips to installed, then remove it again.
// Requires network; skip with E2E_SKIP_NETWORK=1.

test("a font component downloads, installs, and removes", async ({ tauriPage }) => {
  test.skip(process.env.E2E_SKIP_NETWORK === "1", "network-dependent");
  test.setTimeout(300_000);

  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "downloads");

  // Fresh data dir -> nothing installed yet -> at least one Download button.
  await expect(tauriPage.getByText("Download all")).toBeVisible();
  await expect(tauriPage.getByText("Download", { exact: true })).toBeVisible();

  await tauriPage.getByText("Download", { exact: true }).click();
  // The pack downloads into OPENLEAF_DATA_DIR/assets and flips to removable.
  await expect(tauriPage.getByText("Remove")).toBeVisible({ timeout: 240_000 });

  await tauriPage.getByText("Remove", { exact: true }).click();
  await expect(tauriPage.getByText("Remove")).toBeHidden({ timeout: 30_000 });

  await tauriPage.click('[aria-label="Close settings"]');
});
