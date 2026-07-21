import { test, expect } from "../fixtures";
import { openGallery, openProject } from "../helpers";

async function expectPdfCanvas(tauriPage: Parameters<typeof openProject>[0], timeout: number) {
  try {
    await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout });
  } catch (error) {
    const diagnostic = await tauriPage.evaluate(`
      (() => {
        const renderer = document.querySelector('[data-testid="pdf-renderer"]');
        return JSON.stringify({
          state: renderer?.getAttribute("data-pdf-state") ?? "missing",
          error: renderer?.getAttribute("data-pdf-error") ?? "",
          environment: renderer?.getAttribute("data-pdf-environment") ?? "",
          text: renderer?.textContent?.slice(0, 300) ?? ""
        });
      })()
    `);
    throw new Error(`${String(error)}; PDF renderer ${diagnostic}`);
  }
}

test("create a project from the Blank template", async ({ tauriPage }) => {
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank"]');
  await tauriPage.fill("#new-project-name", "E2E Doc");
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("error-boundary")).not.toBeVisible();
});

test("compile produces a rendered PDF with zero errors", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expectPdfCanvas(tauriPage, 45_000);
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");
});

test("opening a project in split view auto-compiles", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expectPdfCanvas(tauriPage, 45_000);
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
});
