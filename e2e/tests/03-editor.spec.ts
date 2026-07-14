import { test, expect } from "../fixtures";
import { typeInEditorAfter, openProject } from "../helpers";

test("typed text appears in the compiled PDF", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Anchored to the template's prose so it can't land inside a LaTeX command or the preamble.
  await typeInEditorAfter(tauriPage, "here.", " E2EMARKER");
  await expect(tauriPage.locator(".cm-content")).toContainText("E2EMARKER");
  await expect(tauriPage.locator('[aria-label="Recompile"]')).toBeEnabled({ timeout: 120_000 });
  await tauriPage.click('[aria-label="Recompile"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await expect(tauriPage.locator(".textLayer")).toContainText("E2EMARKER", { timeout: 30_000 });
});
