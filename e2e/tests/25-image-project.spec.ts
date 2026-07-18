import { test, expect } from "../fixtures";
import { openGallery } from "../helpers";

test("image project: tailored UI and a real figure compile", async ({ tauriPage }) => {
  await openGallery(tauriPage);
  await expect(tauriPage.getByTestId("template-gallery")).toBeVisible();
  await tauriPage.click('[data-testid="template-card-diagram"]');
  await tauriPage.fill("#new-project-name", "E2E Image");
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Preflight and the diagram composer are document-only features.
  await expect(
    tauriPage.locator('[aria-label="Preflight (ATS + accessibility)"]'),
  ).toBeHidden();
  await expect(tauriPage.locator('[aria-label="Insert diagram"]')).toBeHidden();

  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");

  await expect(tauriPage.locator('[aria-label="Save image to project"]')).toBeVisible();
});
