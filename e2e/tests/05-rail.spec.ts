import { test, expect } from "../fixtures";
import { openProject } from "../helpers";

// The rail renders registry-contributed tabs; clicking each one must open its
// panel in the sidebar.

test.beforeEach(async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test("project search tab opens the search panel", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Project search"]');
  await expect(tauriPage.locator('input[placeholder="Find in project…"]')).toBeVisible();
});

test("AI tab opens the chat panel", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Chat / AI Assistant"]');
  // Hermetic runs have no AI provider configured, so the panel shows its
  // connect prompt (with a provider it would show the chat input instead).
  await expect(tauriPage.getByText("Connect an AI provider")).toBeVisible();
});

test("preflight and git tabs are present for a LaTeX project", async ({ tauriPage }) => {
  await expect(tauriPage.locator('[aria-label="Preflight (ATS + accessibility)"]')).toBeVisible();
  await expect(tauriPage.locator('[aria-label="Git"]')).toBeVisible();
});

test("files tab shows the file tree with main.tex", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Source Tree"]');
  await expect(tauriPage.getByText("main.tex")).toBeVisible();
});
