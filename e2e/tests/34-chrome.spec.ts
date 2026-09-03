import { test, expect } from "../fixtures";
import { openProject, openRailTab, waitLong } from "../helpers";

test("the rail theme menu sets the real theme", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const isDark = () =>
    tauriPage.evaluate<boolean>(`document.documentElement.classList.contains('dark')`);
  const menu = tauriPage.locator('[data-testid="theme-menu"]');
  const choose = async (value: "system" | "light" | "dark") => {
    await tauriPage.click('[data-testid="theme-menu"]');
    const item = `[data-testid="theme-option-${value}"]`;
    await expect(tauriPage.locator(item)).toBeVisible();
    await tauriPage.click(item);
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  };
  const before = await isDark();
  await choose("light");
  expect(await isDark()).toBe(false);
  await expect(menu).toHaveAttribute("aria-label", "Appearance: Light");
  await choose("dark");
  expect(await isDark()).toBe(true);
  await expect(menu).toHaveAttribute("aria-label", "Appearance: Dark");
  await choose(before ? "dark" : "light");
  expect(await isDark()).toBe(before);
});

test("the sidebar collapses and restores from the rail", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) =>
      useSettingsStore.getState().setViewMode("split"),
    )`,
  );
  await openRailTab(tauriPage, "Source Tree");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="pdf-renderer"]')`,
    60_000,
  );
  const before = await tauriPage.evaluate<{
    lastCompiledAt: number | null;
    outputRevision: number | null;
  }>(
    `import("/src/store/compile.ts").then(({ useCompileStore }) => {
      const renderer = document.querySelector('[data-testid="pdf-renderer"]');
      if (!renderer) throw new Error("PDF renderer is missing");
      renderer.setAttribute("data-e2e-sidebar-renderer", "stable");
      const compile = useCompileStore.getState();
      return {
        lastCompiledAt: compile.lastCompiledAt,
        outputRevision: compile.lastCompileCheckpoint?.outputRevision ?? null,
      };
    })`,
  );
  await tauriPage.click('[aria-label^="Hide sidebar"]');
  await expect(tauriPage.locator('[aria-label^="Show sidebar"]')).toBeVisible();
  await expect(
    tauriPage.locator('[data-testid="pdf-renderer"][data-e2e-sidebar-renderer="stable"]'),
  ).toBeVisible();
  await tauriPage.click('[aria-label^="Show sidebar"]');
  await expect(tauriPage.locator('[aria-label^="Hide sidebar"]')).toBeVisible();
  await expect(
    tauriPage.locator('[data-testid="pdf-renderer"][data-e2e-sidebar-renderer="stable"]'),
  ).toBeVisible();
  // Auto-compile is debounced by 2.5 seconds. Wait beyond that boundary so
  // the assertion also catches a delayed compile request from the layout-only
  // interaction.
  await new Promise((resolve) => setTimeout(resolve, 2_800));
  const after = await tauriPage.evaluate<{
    status: string;
    lastCompiledAt: number | null;
    outputRevision: number | null;
  }>(
    `import("/src/store/compile.ts").then(({ useCompileStore }) => {
      const compile = useCompileStore.getState();
      return {
        status: compile.status,
        lastCompiledAt: compile.lastCompiledAt,
        outputRevision: compile.lastCompileCheckpoint?.outputRevision ?? null,
      };
    })`,
  );
  expect(after.status).not.toBe("compiling");
  expect({
    lastCompiledAt: after.lastCompiledAt,
    outputRevision: after.outputRevision,
  }).toEqual(before);
});

test("the editor/preview split resizes from the separator", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // The h-mid handle only exists in split view; an earlier spec can leave the
  // persisted layout in editor-only or preview-only mode.
  await tauriPage.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) =>
      useSettingsStore.getState().setViewMode("split"),
    )`,
  );
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-panel-resize-handle-id="h-mid"]')`,
    10_000,
  );
  const editorWidth = () =>
    tauriPage.evaluate<number>(
      `Math.round(document.querySelector('.cm-editor')?.getBoundingClientRect().width || 0)`,
    );
  const before = await editorWidth();
  // Keyboard resizing works when the panel handle is focused; h-mid is the
  // editor/preview split (h-tree is the sidebar's).
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
  await expect(tauriPage.locator(".cm-content")).toContainText("documentclass");
});

test("code folding collapses and restores a region", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // The blank template's document environment is foldable. Target the
  // marker's semantic state instead of its visual implementation.
  await tauriPage.waitForFunction(
    `document.querySelector('.cm-foldGutter .cm-fold-marker[data-fold-state="open"]')`,
    10_000,
  );
  await tauriPage.evaluate(
    `(() => {
      const m = document.querySelector('.cm-foldGutter .cm-fold-marker[data-fold-state="open"]');
      const r = m.getBoundingClientRect();
      m.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      return 1;
    })()`,
  );
  await expect(tauriPage.locator(".cm-foldPlaceholder")).toBeVisible({ timeout: 5_000 });
  // Click the placeholder to unfold; the ▸ gutter marker ignores synthetic clicks.
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
