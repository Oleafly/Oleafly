import { test, expect } from "../fixtures";
import { openProject, openRailTab } from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test("project search tab opens the search panel", async ({ tauriPage }) => {
  await openRailTab(tauriPage, "Search Project");
  await expect(tauriPage.locator('input[placeholder="Find in project…"]')).toBeVisible();
});

test("AI tab opens the chat panel", async ({ tauriPage }) => {
  await openRailTab(tauriPage, "Research Assistant");
  // Hermetic runs have no AI provider configured, so the connect prompt shows
  // instead of the chat input.
  await expect(tauriPage.getByText("Connect an AI provider")).toBeVisible();
});

test("preflight and git tabs are present for a LaTeX project", async ({ tauriPage }) => {
  // The view switchers live in the sidebar bar, which renders while the sidebar
  // is open; open it first, then assert the switchers are present.
  await openRailTab(tauriPage, "Source Tree");
  await expect(tauriPage.locator('[aria-label="Preflight Checks"]')).toBeVisible();
  await expect(tauriPage.locator('[aria-label="Source Control"]')).toBeVisible();
});

test("files tab shows the file tree with main.tex", async ({ tauriPage }) => {
  await openRailTab(tauriPage, "Source Tree");
  await expect(tauriPage.getByText("main.tex")).toBeVisible();
});
