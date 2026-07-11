import { test, expect } from "../fixtures";
import { openProject } from "../helpers";

// The top toolbar: view modes, inline project rename, the export menu, and
// navigating back to the library.

test("view mode segmented control switches source/split/pdf", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="PDF View"]');
  await expect(tauriPage.locator('[aria-label="PDF View"]')).toHaveAttribute("aria-pressed", "true");
  await tauriPage.click('[aria-label="Source View"]');
  await expect(tauriPage.locator('[aria-label="Source View"]')).toHaveAttribute("aria-pressed", "true");
  await tauriPage.click('[aria-label="Split View"]');
  await expect(tauriPage.locator('[aria-label="Split View"]')).toHaveAttribute("aria-pressed", "true");
});

test("inline project rename commits and reverts", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[data-testid="project-title"]');
  await tauriPage.fill('[aria-label="Project name"]', "E2E Doc Renamed");
  await tauriPage.click('[aria-label="Save name"]');
  await expect(tauriPage.getByText("E2E Doc Renamed")).toBeVisible({ timeout: 10_000 });
  // Rename back so the rest of the suite finds the project.
  await tauriPage.click('[data-testid="project-title"]');
  await tauriPage.fill('[aria-label="Project name"]', "E2E Doc");
  await tauriPage.click('[aria-label="Save name"]');
  await expect(tauriPage.getByText("E2E Doc", { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("export menu lists the document formats", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Export"]');
  await expect(tauriPage.getByText("Export source (.zip)")).toBeVisible();
  await expect(tauriPage.getByText("Export as PDF")).toBeVisible();
  await expect(tauriPage.getByText("Export as Word (.docx)")).toBeVisible();
  await expect(tauriPage.getByText("Export as Markdown (.md)")).toBeVisible();
  // Close via the backdrop; actual exports open native save dialogs (manual).
  await tauriPage.click('[aria-label="Export"]');
});

test("back to library and reopen", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[title="Back to library"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});
