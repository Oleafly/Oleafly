import { test, expect } from "../fixtures";
import { openGallery, openProject } from "../helpers";

// The core user journey: pick a template, name the project, create it, hit
// Compile, and watch a real PDF render with zero errors. No mocks anywhere:
// this exercises the gallery, the Rust project store, the Tectonic sidecar,
// the compile pipeline, and the pdf.js viewer.
test("create a project from the Blank template", async ({ tauriPage }) => {
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank"]');
  await tauriPage.fill("#new-project-name", "E2E Doc");
  await tauriPage.click('[data-testid="create-project"]');
  // The editor screen: CodeMirror mounts with the template's main.tex.
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test("compile produces a rendered PDF with zero errors", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Recompile"]');
  // A real page rasterizes in the preview (first compile can take a while).
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  // And the compile status chip reports success, not errors or warnings.
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");
});
