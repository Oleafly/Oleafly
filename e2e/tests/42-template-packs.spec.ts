import { test, expect } from "../fixtures";
import { openGallery, openSettings, waitLong } from "../helpers";
import { startPackFixtureServer } from "../pack-fixture-server";

// The Rust side fetches the catalog from OLEAFLY_PACKS_BASE_URL, which
// scripts/e2e.sh points at the fixed fixture port before the app starts.
// Pack management now lives in Settings -> Offline & Downloads (moved out of
// the template gallery in the home-shell redesign), which is an "Advanced"
// settings section: its nav entry only renders once Advanced is toggled on.

let server: Awaited<ReturnType<typeof startPackFixtureServer>>;

test.beforeAll(async () => {
  server = await startPackFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});

test("installing a pack adds its templates to the gallery", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await openSettings(tauriPage);
  const downloadsNav = tauriPage.locator('[data-testid="settings-section-downloads"]');
  // The toggle persists via localStorage across the shared e2e data dir, so
  // only click it when advanced sections are actually hidden right now (see
  // the same guard in 07-settings.spec.ts).
  if (!(await downloadsNav.isVisible())) {
    await tauriPage.click('[data-testid="settings-toggle-advanced"]');
  }
  await expect(downloadsNav).toBeVisible({ timeout: 10_000 });
  await tauriPage.click('[data-testid="settings-section-downloads"]');

  await expect(tauriPage.locator('[data-testid="pack-row-fixture-pack"]')).toBeVisible({
    timeout: 30_000,
  });
  await tauriPage.click('[data-testid="pack-install-fixture-pack"]');
  await expect(tauriPage.locator('[data-testid="pack-remove-fixture-pack"]')).toBeVisible({
    timeout: 30_000,
  });
  await tauriPage.click('[aria-label="Close settings"]');

  await openGallery(tauriPage);
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="template-card-fixture-article"]')`,
    20_000,
  );
  await tauriPage.click('[data-testid="template-card-fixture-article"]');
  await tauriPage.fill("#new-project-name", "Pack Doc");
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
});
