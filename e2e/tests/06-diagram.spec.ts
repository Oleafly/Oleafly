import { test, expect } from "../fixtures";
import { openProject } from "../helpers";

test("diagram composer compiles the starter drawing to a preview", async ({ tauriPage }) => {
  test.setTimeout(360_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Wait for this page's auto-compile to finish (the ok chip only renders
  // after a finished compile) so the figure compile below has the compile
  // lock to itself. "Recompile enabled" isn't enough: it's also true before
  // the auto-compile starts.
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 180_000,
  });
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 120_000 });

  await tauriPage.click('[aria-label="Insert diagram"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeVisible();

  await tauriPage.click('[data-testid="diagram-compile"]');
  // Insert actions (vector/PNG) live under the Code tab.
  await tauriPage.click('[data-testid="diagram-tab-code"]');
  await expect(tauriPage.locator('img[alt="Diagram preview"]')).toBeVisible({ timeout: 120_000 });
  await expect(tauriPage.getByTestId("diagram-insert-image")).toBeEnabled({ timeout: 5_000 });

  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Back to project"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeHidden();
});
