import { test, expect } from "../fixtures";
import { openProject, openSettings } from "../helpers";

// Requires network; skip with E2E_SKIP_NETWORK=1.

test("a font component downloads, installs, and removes", async ({ tauriPage }) => {
  test.skip(process.env.E2E_SKIP_NETWORK === "1", "network-dependent");
  test.setTimeout(300_000);

  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "downloads");

  // Earlier specs in the shard can install other packs into the shared data
  // dir (creating a modern-resume project downloads its font pack), so this
  // spec must drive exactly one pack row. The bridge's chained
  // locator.getByText resolves against the whole page, not the parent
  // locator, so the scoping has to live in a single CSS selector: each row
  // renders one button that flips between Download and Remove. No built-in
  // template installs ptserif, but the scoping holds regardless.
  const packButton = tauriPage.locator('[data-e2e-font-pack="ptserif"] button');
  await expect(packButton).toBeVisible();
  await expect(packButton).toContainText("Download");

  await packButton.click();
  // Downloads into OLEAFLY_DATA_DIR/assets (hermetic test data dir).
  await expect(packButton).toContainText("Remove", { timeout: 240_000 });
  // The row re-renders with Remove before the busy flag clears, and the
  // bridge's click does not wait for actionability like real Playwright.
  await expect(packButton).toBeEnabled({ timeout: 20_000 });

  await packButton.click();
  await expect(packButton).toContainText("Download", { timeout: 30_000 });

  await tauriPage.click('[aria-label="Close settings"]');
});
