import { test, expect } from "../fixtures";
import { openProject, openRailTab } from "../helpers";

// Conversations need a provider key and are out of automated scope by design.

test("connect-a-provider leads to Settings -> AI", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Chat / AI Assistant");
  await expect(tauriPage.getByText("Connect an AI provider")).toBeVisible();
  await expect(tauriPage.locator('[aria-label="PDF View"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tauriPage.locator(".cm-content")).not.toBeVisible();
  const sidebarBox = await tauriPage.locator('[data-panel-id="sidebar"]').boundingBox();
  const viewportWidth = await tauriPage.evaluate<number>("window.innerWidth");
  expect(sidebarBox).not.toBeNull();
  expect((sidebarBox?.width ?? 0) / viewportWidth).toBeGreaterThan(0.42);
  expect((sidebarBox?.width ?? 0) / viewportWidth).toBeLessThan(0.58);
  await tauriPage.click('[aria-label="Split View"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible();
  await expect(tauriPage.getByText("Connect an AI provider")).toBeVisible();
  await tauriPage.getByText("Connect a provider").click();
  await expect(tauriPage.getByText("Ollama")).toBeVisible({ timeout: 10_000 });
  await tauriPage.click('[aria-label="Close settings"]');
});

test("keyless panel offers the Ollama path into settings", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Chat / AI Assistant");
  // Header chat controls (figure mode, history, send) are provider-gated;
  // keyless users get the two setup paths.
  await expect(tauriPage.getByText("Run a local model with Ollama")).toBeVisible();
  await tauriPage.getByText("Run a local model with Ollama").click();
  await expect(tauriPage.getByText("Ollama")).toBeVisible({ timeout: 10_000 });
  await tauriPage.click('[aria-label="Close settings"]');
});

test("a stale provider preference does not recommend or expand that provider", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  const configured = await tauriPage.evaluate<boolean>(
    `window.__aiConnect?.("zai", "", "glm-4.5") ?? false`,
  );
  expect(configured, "__aiConnect devtools hook must be present").toBe(true);

  await openRailTab(tauriPage, "Chat / AI Assistant");
  await expect(tauriPage.getByText("Connect an AI provider")).toBeVisible();
  await tauriPage.getByText("Connect a provider").click();

  const card = tauriPage.getByTestId("ai-provider-card-zai");
  await expect(card.getByText("Active", { exact: true })).not.toBeVisible();
  await expect(card.getByText("Connected", { exact: true })).not.toBeVisible();
  await expect(card.locator('button[aria-expanded="false"]')).toBeVisible();
  await expect(card.locator('input[type="password"]')).not.toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');
  await expect(tauriPage.getByText("Connect an AI provider")).toBeVisible();
});
