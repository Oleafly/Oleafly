import { test, expect } from "../fixtures";
import { createProjectFromTemplate } from "../helpers";

test("image project: tailored UI and a real figure compile", async ({ tauriPage }) => {
  await createProjectFromTemplate(tauriPage, "diagram", "E2E Image");

  // Preflight and the diagram composer are document-only features.
  await expect(
    tauriPage.locator('[aria-label="Preflight Checks"]'),
  ).toBeHidden();
  await expect(tauriPage.locator('[aria-label="Insert diagram"]')).toBeHidden();

  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");

  await expect(tauriPage.locator('[aria-label="Save image to project"]')).toBeVisible();
});
