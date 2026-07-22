import { test, expect } from "../fixtures";
import { openGallery, waitLong } from "../helpers";
import { startPackFixtureServer } from "../pack-fixture-server";

// The Rust side fetches the catalog from OLEAFLY_PACKS_BASE_URL, which
// scripts/e2e.sh points at the fixed fixture port before the app starts.

let server: Awaited<ReturnType<typeof startPackFixtureServer>>;

test.beforeAll(async () => {
  server = await startPackFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});

test("installing a pack adds its templates to the gallery", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await openGallery(tauriPage);
  await expect(tauriPage.locator('[data-testid="pack-section"]')).toBeVisible({
    timeout: 20_000,
  });
  await tauriPage.click('[data-testid="pack-section-toggle"]');
  await expect(tauriPage.locator('[data-testid="pack-install-fixture-pack"]')).toBeVisible({
    timeout: 10_000,
  });
  await tauriPage.click('[data-testid="pack-install-fixture-pack"]');
  await waitLong(
    tauriPage,
    `!document.querySelector('[data-testid="pack-install-fixture-pack"]')`,
    30_000,
  );
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
