import { test, expect } from "../fixtures";
import { openGallery } from "../helpers";

// Image (standalone figure) projects behave differently from documents: no
// preflight tab, image-flavored save/export. Create one from the Diagram
// template and verify the tailored UI plus a real compile.

test("image project: tailored UI and a real figure compile", async ({ tauriPage }) => {
  await openGallery(tauriPage);
  await expect(tauriPage.getByTestId("template-gallery")).toBeVisible();
  await tauriPage.click('[data-testid="template-card-diagram"]');
  await tauriPage.fill("#new-project-name", "E2E Image");
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Preflight targets documents; the rail must not offer it here. The
  // diagram-composer toolbar button is also document-only.
  await expect(
    tauriPage.locator('[aria-label="Preflight (ATS + accessibility)"]'),
  ).toBeHidden();
  await expect(tauriPage.locator('[aria-label="Insert diagram"]')).toBeHidden();

  // The bundled figure compiles for real.
  await tauriPage.click('[aria-label="Recompile"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");

  // Image projects save an image, not a PDF.
  await expect(tauriPage.locator('[aria-label="Save image to project"]')).toBeVisible();
});
