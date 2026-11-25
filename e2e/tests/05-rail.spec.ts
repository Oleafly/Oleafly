import { test, expect } from "../fixtures";
import { closeAssistant, openProject, openRailTab } from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test.afterEach(async ({ tauriPage }) => {
  await closeAssistant(tauriPage);
});

test("project search tab opens the search panel", async ({ tauriPage }) => {
  await openRailTab(tauriPage, "Search Project");
  await expect(tauriPage.locator('input[placeholder="Find in project…"]')).toBeVisible();
});

test("preflight and git tabs are present for a LaTeX project", async ({ tauriPage }) => {
  await openRailTab(tauriPage, "Explorer");
  await expect(tauriPage.locator('[aria-label="Preflight Checks"]')).toBeVisible();
  await expect(tauriPage.locator('[aria-label="Source Control"]')).toBeVisible();
});

test("files tab shows the file tree with main.tex", async ({ tauriPage }) => {
  await openRailTab(tauriPage, "Explorer");
  await expect(tauriPage.getByText("main.tex")).toBeVisible();
});
