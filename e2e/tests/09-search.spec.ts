import { test, expect } from "../fixtures";
import { openProject, openRailTab, pressGlobal } from "../helpers";

// Search and indexing: the project search panel and the omnibar's document
// scope must find real text in real files.

test("project search finds text across the project", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Project search");
  await tauriPage.fill('input[placeholder="Find in project…"]', "Introduction");
  // A hit row renders with the file and matched line.
  await expect(tauriPage.getByText("section{Introduction}")).toBeVisible({ timeout: 15_000 });
});

test("omnibar /docs scope searches inside documents", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await tauriPage.fill("[cmdk-input]", "/docs Introduction");
  await expect(tauriPage.getByText("main.tex")).toBeVisible({ timeout: 15_000 });
  await tauriPage.press("[cmdk-input]", "Escape");
});

test("omnibar finds projects by name", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await tauriPage.fill("[cmdk-input]", "/projects E2E");
  await expect(tauriPage.getByText("E2E Doc")).toBeVisible({ timeout: 10_000 });
  await tauriPage.press("[cmdk-input]", "Escape");
});
