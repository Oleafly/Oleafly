import { test, expect } from "../fixtures";
import { typeInEditorAfter, openProject } from "../helpers";

// Prove the edit -> save -> compile -> render loop end to end: text typed into
// the real editor must come out the other side as selectable text in the real
// compiled PDF (via pdf.js's text layer).
test("typed text appears in the compiled PDF", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Insert the marker into the document body, anchored to the template's
  // prose so it can never land inside a LaTeX command or the preamble.
  await typeInEditorAfter(tauriPage, "here.", " E2EMARKER");
  await expect(tauriPage.locator(".cm-content")).toContainText("E2EMARKER");
  await expect(tauriPage.locator('[aria-label="Recompile"]')).toBeEnabled({ timeout: 120_000 });
  await tauriPage.click('[aria-label="Recompile"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await expect(tauriPage.locator(".textLayer")).toContainText("E2EMARKER", { timeout: 30_000 });
});
