import { test, expect } from "../fixtures";
import { clickCompile, createProjectFromTemplate } from "../helpers";

test("image project: tailored UI and a real figure compile", async ({ tauriPage }) => {
  await createProjectFromTemplate(tauriPage, "diagram", "E2E Image");

  // Preflight and the diagram composer are document-only features.
  await expect(
    tauriPage.locator('[aria-label="Preflight Checks"]'),
  ).toBeHidden();
  await expect(tauriPage.locator('[aria-label="Insert diagram"]')).toBeHidden();

  await tauriPage.click('[data-testid="toolbar-views"] button[aria-label="Split View"]');
  await clickCompile(tauriPage);
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");

  const save = tauriPage.locator('[aria-label="Save image to project"]');
  if (!(await save.isVisible())) {
    await tauriPage.focus('[aria-label="More preview controls"]');
    await tauriPage.press('[aria-label="More preview controls"]', "Enter");
  }
  await expect(save).toBeVisible();
});
