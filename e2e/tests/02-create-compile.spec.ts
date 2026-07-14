import { test, expect } from "../fixtures";
import { openGallery, openProject, expectPdfRendered } from "../helpers";

test("create a project from the Blank template", async ({ tauriPage }) => {
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank"]');
  await tauriPage.fill("#new-project-name", "E2E Doc");
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test("compile produces a rendered PDF with zero errors", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Recompile"]');
  // First compile can take a while.
  await expectPdfRendered(tauriPage, 90_000);
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");
});

test("opening a project in split view auto-compiles", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expectPdfRendered(tauriPage, 120_000);
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
});
