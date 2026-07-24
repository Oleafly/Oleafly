import { test, expect } from "../fixtures";
import { caretIn, clickToolbarControl, openProject, selectWord } from "../helpers";

test("toolbar overflow menu surfaces controls that don't fit the bar", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Force the toolbar's measured container down to a width that fits nothing,
  // so every control deterministically lands in the overflow menu (real
  // ResizeObserver-driven layout, not a mock of the fitCount logic).
  await tauriPage.evaluate(
    `(() => {
      const bold = document.querySelector('[aria-label^="Bold ("]');
      // Bold's direct parent is the Tooltip wrapper <span>, not the toolbar's
      // measured flex container - walk up to the element that actually has
      // the fitCount ResizeObserver attached (it uniquely carries both
      // flex-1 and overflow-hidden in this toolbar).
      const container = bold && bold.closest('.overflow-hidden');
      if (!container) throw new Error('toolbar container not found');
      container.style.width = '20px';
      container.style.flex = 'none';
      return true;
    })()`,
  );
  await tauriPage.waitForFunction(
    `(() => {
      const bar = document.querySelector('[aria-label="More formatting options"]');
      return !!bar && !document.querySelector('[aria-label^="Bold ("]');
    })()`,
    10_000,
  );
  // Click the trigger's own DOM node directly: the bridge's click command is
  // coordinate/occlusion-based (see helpers.ts caretIn notes), which is
  // unreliable against an element whose ancestor was just forced to 20px.
  await tauriPage.evaluate(
    `document.querySelector('[aria-label="More formatting options"]').click()`,
  );
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('Bold') && document.body.innerText.includes('Italic')`,
    10_000,
  );
});

test("forward SyncTeX switches to split view and locates the PDF position", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });

  await tauriPage.click('[aria-label="Source View"]');
  await expect(tauriPage.locator('[aria-label="Source View"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tauriPage.locator(".pdf-canvas")).toBeHidden();

  await caretIn(tauriPage, "here.", 1, "end");
  await clickToolbarControl(tauriPage, '[aria-label="Go to PDF (SyncTeX)"]', "Go to PDF (SyncTeX)");
  await expect(tauriPage.locator('[aria-label="Split View"]')).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 10_000 },
  );
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 20_000 });

  // Leave the view mode as found.
  await tauriPage.click('[aria-label="Split View"]');
});

test("selecting text in the editor reveals the Ask AI action bubble", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Fire-and-forget listener storing the payload on a window global: this
  // bridge's evaluate() does not await returned promises, so a listener that
  // resolves a Promise inside evaluate() would never actually be waited on.
  await tauriPage.evaluate(
    `(() => {
      window.__lastAiSelectionPrompt = null;
      window.addEventListener('oleafly:ai-selection-action', (e) => {
        window.__lastAiSelectionPrompt = e.detail.prompt;
      }, { once: true });
      return true;
    })()`,
  );

  await selectWord(tauriPage, "Write");
  await tauriPage.waitForFunction(`window.getSelection().toString() === 'Write'`, 5_000);
  const bubble = tauriPage.getByText("Ask AI", { exact: true });
  await expect(bubble).toBeVisible({ timeout: 5_000 });

  await bubble.click();
  await expect(tauriPage.getByText("Paraphrase", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Improve Writing", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Fix Grammar & Style", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Expand & Elaborate", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Find References", { exact: true })).toBeVisible();

  await tauriPage.getByText("Improve Writing", { exact: true }).click();
  await tauriPage.waitForFunction(`typeof window.__lastAiSelectionPrompt === 'string'`, 5_000);
  const detail = await tauriPage.evaluate<string>(`window.__lastAiSelectionPrompt`);
  expect(detail).toContain("Write");
});
