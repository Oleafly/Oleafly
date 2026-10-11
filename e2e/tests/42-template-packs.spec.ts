import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect } from "../fixtures";
import { finishProjectCreation, openGallery, openSettings, waitLong } from "../helpers";
import { startPackFixtureServer } from "../pack-fixture-server";

// The Rust side fetches the catalog from OLEAFLY_PACKS_BASE_URL, which
// scripts/e2e.sh points at the fixed fixture port before the app starts.
// Pack management now lives in Settings -> Downloads (moved out of
// the template gallery in the home-shell redesign), which is an "Advanced"
// settings section: its nav entry only renders once Advanced is toggled on.

let server: Awaited<ReturnType<typeof startPackFixtureServer>>;

test.beforeAll(async () => {
  server = await startPackFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});

async function openTemplatePacks(tauriPage: TauriPage) {
  await openSettings(tauriPage);
  const downloadsNav = tauriPage.locator('[data-testid="settings-section-downloads"]');
  if (!(await downloadsNav.isVisible())) {
    await tauriPage.click('[data-testid="settings-toggle-advanced"]');
  }
  await expect(downloadsNav).toBeVisible({ timeout: 10_000 });
  await openSettings(tauriPage, "downloads");
  const templatesTab = tauriPage.locator('[data-testid="downloads-tab-templates"]');
  await templatesTab.focus();
  await templatesTab.press("Enter");
  await tauriPage.click('[data-testid="packs-refresh"]');
  await expect(tauriPage.locator('[data-testid="pack-row-fixture-pack"]')).toBeVisible({
    timeout: 30_000,
  });
}

test("a pack opens to a preview of each template and installs one on its own", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await openTemplatePacks(tauriPage as TauriPage);

  await tauriPage.click('[data-testid="pack-open-fixture-pack"]');
  await expect(tauriPage.locator('[data-testid="pack-template-fixture-letter"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(tauriPage.locator('[data-testid="pack-template-fixture-article"]')).toBeVisible();
  await tauriPage.click('[data-testid="pack-template-fixture-letter"] button');
  await expect(tauriPage.locator('[data-testid="template-preview"]')).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator('[data-testid="template-preview-get"]')).toBeEnabled();

  await tauriPage.click('[data-testid="template-preview-get"]');
  await expect(tauriPage.locator('[data-testid="template-preview-use"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(tauriPage.locator('[data-testid="pack-view-install-fixture-pack"]')).toBeVisible();

  await tauriPage.click('[data-testid="template-preview-use"]');
  await expect(tauriPage.locator("#new-project-name")).toBeVisible({ timeout: 20_000 });
  await tauriPage.fill("#new-project-name", "Pack Letter");
  await finishProjectCreation(tauriPage);
});

test("installing a pack adds its templates to the gallery", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await openTemplatePacks(tauriPage as TauriPage);

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
  await finishProjectCreation(tauriPage);
});
