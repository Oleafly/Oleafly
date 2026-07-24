import { test, expect } from "../fixtures";
import { closeDiagramComposer, openDiagramComposer } from "../helpers";

// The Diagram Composer moved from a per-project modal to a standalone home
// page over a hidden "scratch" project (see e2e/tests/45-home-nav.spec.ts for
// the dock entry point itself); there is no more "insert into the current
// document" flow, only compile-and-save/download.
test("diagram composer compiles the starter drawing to a preview", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openDiagramComposer(tauriPage);

  const compile = tauriPage.getByTestId("diagram-compile");
  await expect(compile).toBeEnabled();
  await compile.click();
  await expect(compile).toContainText("Compiling", { timeout: 5_000 });
  await expect(tauriPage.locator('img[alt="Diagram preview"]')).toBeVisible({ timeout: 120_000 });
  await expect(compile).toContainText("Recompile");

  // The Code tab mirrors the drawing as TikZ once compiled.
  await tauriPage.click('[data-testid="diagram-tab-code"]');
  await expect(tauriPage.locator(".cm-content")).toContainText("tikzpicture", { timeout: 5_000 });

  await closeDiagramComposer(tauriPage);
  await expect(
    tauriPage.locator('[role="dialog"][data-tour="diagram-composer"]'),
  ).toBeHidden();
});

test("Save Figure caches the compiled diagram without leaving the composer", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openDiagramComposer(tauriPage);

  const name = `e2ecache${Date.now().toString(36)}`;
  await tauriPage.click('[data-testid="diagram-name-display"]');
  await tauriPage.fill("#diagram-name", name);
  await tauriPage.click('[aria-label="Save name"]');

  await tauriPage.getByTestId("diagram-compile").click();
  await expect(tauriPage.locator('img[alt="Diagram preview"]')).toBeVisible({ timeout: 120_000 });

  await tauriPage.click('[aria-label="Save"]');
  await tauriPage.getByText("Save Figure", { exact: true }).click();
  // The cache key is a content hash of the PNG bytes (src-tauri/src/project.rs
  // save_figure_to_cache), and the starter drawing compiles identically every
  // run, so a repeat run legitimately hits the "already cached" branch.
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('Saved to your figures cache.') || document.body.innerText.includes('Already cached, reusing the existing figure.')`,
    10_000,
  );

  await closeDiagramComposer(tauriPage);
});
