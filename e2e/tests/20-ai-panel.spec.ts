import { test, expect } from "../fixtures";
import { openProject, openRailTab } from "../helpers";

// The AI panel without a configured key: the onboarding state, the path into
// settings, and the header controls that work keyless. (Conversations need a
// key and are out of automated scope by design.)

test("connect-a-provider leads to Settings -> AI", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Chat / AI Assistant");
  await expect(tauriPage.getByText("Connect an AI provider")).toBeVisible();
  await tauriPage.getByText("Connect a provider").click();
  // Settings opens on the AI section with the provider catalog.
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
