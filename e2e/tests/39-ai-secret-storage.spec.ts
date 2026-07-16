import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openSettings } from "../helpers";

test("AI credentials persist encrypted across a settings remount", async ({ tauriPage }) => {
  const secret = `openleaf-e2e-secret-${Date.now()}`;
  await openSettings(tauriPage, "ai");
  const card = tauriPage.getByTestId("ai-provider-card-openai");
  await tauriPage.click('[data-testid="ai-provider-card-openai"] button[aria-expanded]');
  const input = card.locator('input[type="password"]');
  await expect(input).toBeVisible();
  await input.fill(secret);
  await tauriPage.click('[data-testid="ai-provider-save-openai"]');
  await expect(tauriPage.getByTestId("ai-provider-delete-openai")).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');

  const root = process.env.OPENLEAF_DATA_DIR;
  if (!root) throw new Error("OPENLEAF_DATA_DIR is required");
  const config = readFileSync(join(root, "config.json"), "utf8");
  const encrypted = readFileSync(join(root, "ai-secrets.json"), "utf8");
  expect(config).not.toContain(secret);
  expect(encrypted).not.toContain(secret);

  await openSettings(tauriPage, "ai");
  const restoredCard = tauriPage.getByTestId("ai-provider-card-openai");
  await expect(restoredCard.locator('input[type="password"]')).toBeVisible();
  await expect(restoredCard.locator('input[type="password"]')).toHaveValue(secret);
  await tauriPage.click('[data-testid="ai-provider-delete-openai"]');
  await expect(tauriPage.getByTestId("ai-provider-delete-openai")).toBeHidden();
});
