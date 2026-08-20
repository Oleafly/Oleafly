import { test, expect } from "../fixtures";
import { openProject, openSettings } from "../helpers";

// Requires network; skip with E2E_SKIP_NETWORK=1.

test("a font component downloads, installs, and removes", async ({ tauriPage }) => {
  test.skip(process.env.E2E_SKIP_NETWORK === "1", "network-dependent");
  test.setTimeout(300_000);

  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "downloads");

  // Scope to one pack row: earlier specs in the shard can install other packs
  // into the shared data dir (creating a modern-resume project downloads its
  // font pack), so unscoped Download/Remove text matches are ambiguous. No
  // built-in template requires ptserif, but the row-scoped assertions hold
  // regardless of what else is installed.
  const pack = tauriPage.locator('[data-e2e-font-pack="ptserif"]');
  await expect(pack.getByText("Download", { exact: true })).toBeVisible();

  await pack.getByText("Download", { exact: true }).click();
  // Downloads into OLEAFLY_DATA_DIR/assets (hermetic test data dir).
  await expect(pack.getByText("Remove")).toBeVisible({ timeout: 240_000 });

  await pack.getByText("Remove", { exact: true }).click();
  await expect(pack.getByText("Remove")).toBeHidden({ timeout: 30_000 });
  await expect(pack.getByText("Download", { exact: true })).toBeVisible({ timeout: 10_000 });

  await tauriPage.click('[aria-label="Close settings"]');
});
