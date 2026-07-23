import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect, reloadNativePage } from "../fixtures";
import { openSettings } from "../helpers";

const reload = (page: unknown) => reloadNativePage(page as TauriPage);

// The connector key round-trips through a real connector-secrets.json on disk
// (src-tauri/src/secrets.rs), not a mock, so a reload is the only way to prove
// persistence rather than just in-memory store state.

test("connect, persist across reload, and disconnect an alphaXiv key", async ({ tauriPage }) => {
  await openSettings(tauriPage, "github");
  await expect(tauriPage.getByText("alphaXiv", { exact: true })).toBeVisible();

  const keyInput = tauriPage.locator('[aria-label="alphaXiv API key"]');
  await expect(keyInput).toBeVisible();
  await tauriPage.fill('[aria-label="alphaXiv API key"]', "axv1_e2e_test_key");
  await tauriPage.getByText("Connect", { exact: true }).click();
  await expect(tauriPage.getByText("Disconnect", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(keyInput).toBeHidden();

  await reload(tauriPage);
  await openSettings(tauriPage, "github");
  await expect(tauriPage.getByText("alphaXiv", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Disconnect", { exact: true })).toBeVisible({ timeout: 10_000 });

  await tauriPage.getByText("Disconnect", { exact: true }).click();
  await expect(tauriPage.locator('[aria-label="alphaXiv API key"]')).toBeVisible({ timeout: 10_000 });

  await reload(tauriPage);
  await openSettings(tauriPage, "github");
  await expect(tauriPage.locator('[aria-label="alphaXiv API key"]')).toBeVisible({ timeout: 10_000 });
});

test("Get an API key links point at alphaXiv's own site", async ({ tauriPage }) => {
  await openSettings(tauriPage, "github");
  const hrefs = await tauriPage.evaluate<string[]>(
    `Array.from(document.querySelectorAll('a')).filter(a => (a.textContent || '').includes('API key page') || a.textContent === 'alphaxiv.org').map(a => a.href)`,
  );
  expect(hrefs.some((h) => h.includes("alphaxiv.org/@api-key"))).toBe(true);
  expect(hrefs.some((h) => h === "https://www.alphaxiv.org/")).toBe(true);
});
