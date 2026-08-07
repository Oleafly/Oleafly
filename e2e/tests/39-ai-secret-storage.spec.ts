import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openSettings } from "../helpers";

test("AI credentials persist encrypted and never return to the window", async ({ tauriPage }) => {
  const secret = `oleafly-e2e-secret-${Date.now()}`;
  await openSettings(tauriPage, "ai");
  const card = tauriPage.getByTestId("ai-provider-card-perplexity");
  await tauriPage.click('[data-testid="ai-provider-card-perplexity"] button[aria-expanded]');
  const input = card.locator('input[type="password"]');
  await expect(input).toBeVisible();
  await input.fill(secret);
  await tauriPage.click('[data-testid="ai-provider-save-perplexity"]');
  await expect(tauriPage.getByTestId("ai-provider-delete-perplexity")).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');

  const root = process.env.OLEAFLY_DATA_DIR;
  if (!root) throw new Error("OLEAFLY_DATA_DIR is required");
  const config = readFileSync(join(root, "config.json"), "utf8");
  const encrypted = readFileSync(join(root, "ai-secrets.json"), "utf8");
  expect(config).not.toContain(secret);
  expect(encrypted).not.toContain(secret);

  const fromBackend = await tauriPage.evaluate<string>(`
    (async () => {
      const { getConfig } = await import("/src/lib/tauri.ts");
      return JSON.stringify(await getConfig());
    })()
  `);
  expect(fromBackend).not.toContain(secret);
  expect(fromBackend).toContain("perplexity");

  await openSettings(tauriPage, "ai");
  const restoredCard = tauriPage.getByTestId("ai-provider-card-perplexity");
  await expect(restoredCard.locator('input[type="password"]')).toBeVisible();
  await expect(restoredCard.locator('input[type="password"]')).toHaveValue("");
  await expect(tauriPage.getByTestId("ai-provider-delete-perplexity")).toBeVisible();
  await tauriPage.click('[data-testid="ai-provider-delete-perplexity"]');
  await expect(tauriPage.getByTestId("ai-provider-delete-perplexity")).toBeHidden();
});
