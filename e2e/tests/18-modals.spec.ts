import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillCommandPalette,
  openProject,
  openSettings,
  pressGlobal,
} from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  const projectExists = await tauriPage.evaluate<boolean>(
    `document.querySelector(${JSON.stringify('button[aria-label="Open E2E Doc"]')}) !== null`,
  );
  if (projectExists) await openProject(tauriPage, "E2E Doc");
  else await createBlankProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test("settings and template modals close through user interactions and restore focus", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.focus('[data-testid="new-project"]');
  await expect(tauriPage.locator('[data-testid="new-project"]')).toBeFocused();
  await tauriPage.click('[data-testid="new-project"]');
  await expect(tauriPage.getByTestId("template-gallery")).toBeVisible();
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.getByTestId("template-gallery")).not.toBeVisible();
  await expect(tauriPage.locator('[data-testid="new-project"]')).toBeFocused();

  await tauriPage.focus('[aria-label="Settings"]');
  await expect(tauriPage.locator('[aria-label="Settings"]')).toBeFocused();
  await tauriPage.click('[aria-label="Settings"]');
  await expect(tauriPage.locator('[aria-label="Close settings"]')).toBeVisible();
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.locator('[aria-label="Close settings"]')).not.toBeVisible();
  await expect(tauriPage.locator('[aria-label="Settings"]')).toBeFocused();
});

test("project info modal opens from the word-count palette command and closes", async ({
  tauriPage,
}) => {
  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "word"); // cmdk matches single terms
  await tauriPage.press("[cmdk-input]", "Enter");
  const projectInfo = tauriPage.locator(
    '[role="dialog"][aria-labelledby="project-info-title"]',
  );
  await expect(projectInfo).toBeVisible();
  await expect(tauriPage.getByText("Project info", { exact: true })).toBeVisible();
  await tauriPage.getByText("Close", { exact: true }).click();
  await expect(projectInfo).not.toBeVisible();
});

test("history modal opens from the palette", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "history");
  await tauriPage.press("[cmdk-input]", "Enter");
  // The modal heading renders (history may be empty for a fresh repo).
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some(h => h.textContent.trim() === 'Versioning')`,
    10_000,
  );
  await expect(tauriPage.locator("#versioning-title")).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.getByTestId("versioning-tab-git")).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 10_000 },
  );
  await tauriPage.click('[aria-label="Close versioning"]');
});

test("Help and About is available from Settings", async ({ tauriPage }) => {
  await openSettings(tauriPage, "help");
  await expect(tauriPage.getByTestId("about-oleafly-section")).toBeVisible();
  await expect(tauriPage.getByText("Discussions", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Issues", { exact: true })).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');
});

test("shortcuts reference filters as you search", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "/", { meta: true });
  await expect(tauriPage.getByText("Keyboard Shortcuts")).toBeVisible();
  await tauriPage.fill('input[placeholder="Search shortcuts…"]', "recompile");
  await expect(tauriPage.getByText("Recompile")).toBeVisible();
  await tauriPage.fill('input[placeholder="Search shortcuts…"]', "zzzznothing");
  await expect(tauriPage.getByText("No shortcuts found.")).toBeVisible();
});
