import { test, expect } from "../fixtures";
import { openProject, openRailTab } from "../helpers";

// App chrome: the rail's theme toggle and sidebar collapse, panel resizing,
// editor tab closing, and code folding - the ergonomics around the editor.

test("the rail theme button flips the real theme", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const isDark = () =>
    tauriPage.evaluate<boolean>(`document.documentElement.classList.contains('dark')`);
  const before = await isDark();
  await tauriPage.click('[aria-label="Toggle theme"]');
  expect(await isDark()).toBe(!before);
  await tauriPage.click('[aria-label="Toggle theme"]');
  expect(await isDark()).toBe(before);
});

test("the sidebar collapses and restores from the rail", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Tree");
  await tauriPage.click('[aria-label="Hide sidebar"]');
  await expect(tauriPage.locator('[aria-label="Show sidebar"]')).toBeVisible();
  await tauriPage.click('[aria-label="Show sidebar"]');
  await expect(tauriPage.locator('[aria-label="Hide sidebar"]')).toBeVisible();
});

test("the editor/preview split resizes from the separator", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const editorWidth = () =>
    tauriPage.evaluate<number>(
      `Math.round(document.querySelector('.cm-editor')?.getBoundingClientRect().width || 0)`,
    );
  const before = await editorWidth();
  // react-resizable-panels handles support keyboard resizing when focused;
  // h-mid is the editor/preview split (h-tree is the sidebar's).
  await tauriPage.evaluate(
    `(() => {
      const h = document.querySelector('[data-panel-resize-handle-id="h-mid"]');
      if (!h) throw new Error('no resize handle');
      h.focus();
      for (let i = 0; i < 5; i++) {
        h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      }
      return 1;
    })()`,
  );
  await tauriPage.waitForFunction(
    `Math.round(document.querySelector('.cm-editor')?.getBoundingClientRect().width || 0) !== ${JSON.stringify(before)}`,
    5_000,
  );
  const after = await editorWidth();
  expect(after).not.toBe(before);
  // Restore roughly where it was.
  await tauriPage.evaluate(
    `(() => {
      const h = document.querySelector('[data-panel-resize-handle-id="h-mid"]');
      h.focus();
      for (let i = 0; i < 5; i++) {
        h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      }
      return 1;
    })()`,
  );
});

test("editor tabs close from their x button", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Tree");
  // Create a second file if a previous run hasn't already.
  const exists = await tauriPage.evaluate<boolean>(
    `document.body.innerText.includes('tabtest.tex')`,
  );
  if (!exists) {
    await tauriPage.click('[title="New file (in the selected folder)"]');
    await tauriPage.fill('input[placeholder="New file name"]', "tabtest.tex");
    await tauriPage.press('input[placeholder="New file name"]', "Enter");
  }
  await tauriPage.getByText("tabtest.tex", { exact: true }).click();
  await expect(tauriPage.locator('[aria-label="Close tabtest.tex"]')).toBeVisible({
    timeout: 5_000,
  });
  await tauriPage.click('[aria-label="Close tabtest.tex"]');
  await tauriPage.waitForFunction(
    `!document.querySelector('[aria-label="Close tabtest.tex"]')`,
    5_000,
  );
  // main.tex remains the active file.
  await expect(tauriPage.locator(".cm-content")).toContainText("documentclass");
});

test("code folding collapses and restores a region", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // The blank template's document environment is foldable; the gutter shows ▾.
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.cm-foldGutter span')).some(s => s.textContent === '▾')`,
    10_000,
  );
  await tauriPage.evaluate(
    `(() => {
      const m = Array.from(document.querySelectorAll('.cm-foldGutter span')).find(s => s.textContent === '▾');
      const r = m.getBoundingClientRect();
      m.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      return 1;
    })()`,
  );
  await expect(tauriPage.locator(".cm-foldPlaceholder")).toBeVisible({ timeout: 5_000 });
  // Unfold by clicking the placeholder itself (CodeMirror's standard
  // affordance; the ▸ gutter marker ignores synthetic clicks).
  await tauriPage.evaluate(
    `(() => {
      const p = document.querySelector('.cm-foldPlaceholder');
      const r = p.getBoundingClientRect();
      for (const type of ['mousedown', 'mouseup', 'click']) {
        p.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      }
      return 1;
    })()`,
  );
  await tauriPage.waitForFunction(`!document.querySelector('.cm-foldPlaceholder')`, 5_000);
});
