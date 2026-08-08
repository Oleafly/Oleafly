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

test("saving one provider keeps every other stored credential", async ({ tauriPage }) => {
  const seeded = `oleafly-e2e-seeded-${Date.now()}`;
  const typed = `oleafly-e2e-typed-${Date.now()}`;

  await tauriPage.evaluate(`
    (async () => {
      const { getConfig, setConfig } = await import("/src/lib/tauri.ts");
      const cfg = await getConfig();
      await setConfig({ ...cfg, ai_keys: { ...(cfg.ai_keys ?? {}), openai: ${JSON.stringify(seeded)} } });
    })()
  `);

  await openSettings(tauriPage, "ai");
  await tauriPage.click('[data-testid="ai-provider-card-perplexity"] button[aria-expanded]');
  const input = tauriPage.locator('[data-testid="ai-provider-card-perplexity"] input[type="password"]');
  await expect(input).toBeVisible();
  await input.fill(typed);
  await tauriPage.click('[data-testid="ai-provider-save-perplexity"]');
  await expect(tauriPage.getByTestId("ai-provider-delete-perplexity")).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');

  const stored = await tauriPage.evaluate<string[]>(`
    (async () => {
      const { getConfig } = await import("/src/lib/tauri.ts");
      const cfg = await getConfig();
      return Object.keys(cfg.ai_keys ?? {}).sort();
    })()
  `);
  expect(stored).toContain("openai");
  expect(stored).toContain("perplexity");

  const root = process.env.OLEAFLY_DATA_DIR;
  if (!root) throw new Error("OLEAFLY_DATA_DIR is required");
  const encrypted = readFileSync(join(root, "ai-secrets.json"), "utf8");
  expect(encrypted).not.toContain(seeded);
  expect(encrypted).not.toContain(typed);

  await openSettings(tauriPage, "ai");
  await tauriPage.click('[data-testid="ai-provider-card-openai"] button[aria-expanded]');
  await expect(tauriPage.getByTestId("ai-provider-delete-openai")).toBeVisible();
  await tauriPage.click('[data-testid="ai-provider-delete-openai"]');
  await expect(tauriPage.getByTestId("ai-provider-delete-openai")).toBeHidden();
  await expect(tauriPage.getByTestId("ai-provider-delete-perplexity")).toBeVisible();
  await tauriPage.click('[data-testid="ai-provider-delete-perplexity"]');
  await expect(tauriPage.getByTestId("ai-provider-delete-perplexity")).toBeHidden();
});
