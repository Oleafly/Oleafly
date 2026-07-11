import { test, expect } from "../fixtures";
import { openProject } from "../helpers";

// The diagram composer: open it, compile the starter drawing through the real
// isolated-compile pipeline, and see the rendered preview.

test("diagram composer compiles the starter drawing to a preview", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await tauriPage.click('[aria-label="Insert diagram"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeVisible();

  await tauriPage.click('[data-testid="diagram-compile"]');
  // Compile runs Tectonic on the generated TikZ; the Insert-as-image button
  // enables only once a rendered PNG exists.
  await expect(tauriPage.getByTestId("diagram-insert-image")).toBeEnabled({ timeout: 90_000 });

  // The Code tab shows the rendered preview and the generated TikZ.
  await tauriPage.click('[data-testid="diagram-tab-code"]');
  await expect(tauriPage.locator('img[alt="Diagram preview"]')).toBeVisible();

  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Close"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeHidden();
});
