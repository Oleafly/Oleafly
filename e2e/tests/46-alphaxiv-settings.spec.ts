import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect, reloadNativePage } from "../fixtures";
import { openSettings, waitLong } from "../helpers";

const reload = (page: unknown) => reloadNativePage(page as TauriPage);

// The connector key round-trips through a real connector-secrets.json on disk
// (src-tauri/src/secrets.rs), not a mock, so a reload is the only way to prove
// persistence rather than just in-memory store state.

test("connect, persist across reload, and disconnect an alphaXiv key", async ({ tauriPage }) => {
  // Scoped to the alphaXiv section throughout: GitHub's own section on this
  // same settings page also has a "Disconnect" button, and when a real
  // E2E_GITHUB_TOKEN is configured (as in CI), both are visible at once, so
  // an unscoped getByText("Disconnect") is ambiguous.
  const section = () => tauriPage.locator('[data-testid="alphaxiv-section"]');

  // Each locator below is created fresh right where it's used rather than
  // hoisted: reload(tauriPage) swaps to an entirely new window handle in this
  // bridge, so a locator captured before a reload goes stale after one.
  await openSettings(tauriPage, "github");
  await expect(section().getByText("alphaXiv", { exact: true })).toBeVisible();

  await expect(tauriPage.locator('[aria-label="alphaXiv API key"]')).toBeVisible();
  await tauriPage.fill('[aria-label="alphaXiv API key"]', "axv1_e2e_test_key");
  await section().getByText("Connect", { exact: true }).click();
  await expect(section().getByText("Disconnect", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator('[aria-label="alphaXiv API key"]')).toBeHidden();

  await reload(tauriPage);
  await openSettings(tauriPage, "github");
  await expect(section().getByText("alphaXiv", { exact: true })).toBeVisible();
  await expect(section().getByText("Disconnect", { exact: true })).toBeVisible({ timeout: 10_000 });

  // Retry the click itself, not just the wait: confirmed via a manual
  // diagnostic that a single click reliably works within ~2s in isolation,
  // but immediately after 12-git.spec.ts's real GitHub network activity the
  // very same click has been observed to not take effect at all (not just
  // slowly) - consistent with the click landing before the section finished
  // re-rendering post-reload, rather than the disconnect itself being slow.
  const keyInputSelector = `[data-testid="alphaxiv-section"] [aria-label="alphaXiv API key"]`;
  let disconnected = false;
  for (let attempt = 0; attempt < 5 && !disconnected; attempt++) {
    await section().getByText("Disconnect", { exact: true }).click();
    try {
      await waitLong(tauriPage, `!!document.querySelector('${keyInputSelector}')`, 5_000);
      disconnected = true;
    } catch {
      disconnected = await tauriPage.evaluate<boolean>(
        `!!document.querySelector('${keyInputSelector}')`,
      );
    }
  }
  expect(disconnected).toBe(true);

  await reload(tauriPage);
  await openSettings(tauriPage, "github");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="alphaxiv-section"] [aria-label="alphaXiv API key"]')`,
    40_000,
  );
});

test("Get an API key links point at alphaXiv's own site", async ({ tauriPage }) => {
  await openSettings(tauriPage, "github");
  const hrefs = await tauriPage.evaluate<string[]>(
    `Array.from(document.querySelectorAll('a')).filter(a => (a.textContent || '').includes('API key page') || a.textContent === 'alphaxiv.org').map(a => a.href)`,
  );
  expect(hrefs.some((h) => h.includes("alphaxiv.org/@api-key"))).toBe(true);
  expect(hrefs.some((h) => h === "https://www.alphaxiv.org/")).toBe(true);
});
