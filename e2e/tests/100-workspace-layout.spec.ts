import { test, expect, reloadNativePage } from "../fixtures";
import { createBlankProject, waitLong } from "../helpers";

test("workspace controls fit at the minimum window width with larger interface text", async ({ tauriPage: page }) => {
  await page.evaluate(`import("/src/lib/e2e-probe.ts").then(w => w.resizeCurrentWindow(900, 700))`);
  await createBlankProject(page, "Layout geometry");
  await page.evaluate(`import("/src/store/settings.ts").then(({ useSettingsStore }) => {
    useSettingsStore.getState().setAppFontSize(22);
    useSettingsStore.getState().setWebBrowser(true);
  })`);
  await expect.poll(async () => page.evaluate(`(() => {
    const toolbar = document.querySelector('[data-tour="project-toolbar"]');
    const buttons = [...toolbar.querySelectorAll('button')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !el.closest('[inert]');
    });
    return buttons.filter(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.left < 0 || r.right > innerWidth || !el.contains(hit);
    }).map(el => el.getAttribute('aria-label') || el.textContent || 'unlabelled action');
  })()`)).toEqual([]);
});

test("wide toolbars restore direct actions and center the view group after resizing", async ({ tauriPage: page }) => {
  await reloadNativePage(page);
  await createBlankProject(page, "Responsive toolbar with a long project name");
  for (const [width, fontSize, layout] of [
    [1440, 16, "expanded"],
    [900, 16, "compact"],
    [1440, 22, "compact"],
    [1440, 16, "expanded"],
  ] as const) {
    await page.evaluate(`Promise.all([import("/src/lib/e2e-probe.ts"), import("/src/store/settings.ts")]).then(async ([w, s]) => {
      s.useSettingsStore.getState().setAppFontSize(${fontSize});
      s.useSettingsStore.getState().setWebBrowser(true);
      await w.resizeCurrentWindow(${width}, 800);
    })`);
    await expect.poll(async () => page.evaluate(`document.querySelector('[data-tour="project-toolbar"]')?.dataset.toolbarLayout`)).toBe(layout);
    await expect.poll(async () => page.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('[data-tour="project-toolbar"] button')].filter(el => !el.closest('[inert]'));
      return buttons.filter(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.left < 0 || r.right > innerWidth || !el.contains(hit);
      }).map(el => el.getAttribute('aria-label') || el.textContent);
    })()`)).toEqual([]);
    if (layout === "expanded") {
      await expect(page.locator('button[aria-label="Fork project"]')).toBeVisible();
      await expect(page.locator('button[aria-label="Versioning"]')).toBeVisible();
      await expect(page.locator('button[aria-label="Layout"]')).toBeVisible();
      await expect.poll(async () => page.evaluate(`document.querySelectorAll('[data-tour="project-toolbar"] button[aria-label="Layout"]').length`)).toBe(1);
      await expect(page.locator('[data-testid="open-settings"]')).toBeVisible();
      await expect.poll(async () => page.evaluate(`(() => {
        const r = document.querySelector('[data-testid="toolbar-views"]').getBoundingClientRect();
        return Math.abs((r.left + r.right) / 2 - innerWidth / 2);
      })()`)).toBeLessThan(1);
      await expect.poll(async () => page.evaluate(`document.querySelectorAll('[data-testid="toolbar-views"] button').length`)).toBe(3);
    } else {
      await expect(page.locator('[data-testid="workspace-menu"]')).toBeVisible();
    }
  }
  await page.evaluate(`import("/src/lib/e2e-probe.ts").then(w => w.resizeCurrentWindow(900, 700))`);
});

test("reopening a project restores its workspace choices", async ({ tauriPage: page }) => {
  await createBlankProject(page, "Saved layout");
  const projectId = await page.evaluate<string>(`import("/src/store/files.ts").then(({useFilesStore})=>useFilesStore.getState().projectId)`);
  await page.evaluate(`import("/src/store/settings.ts").then(({useSettingsStore})=>{
    const s=useSettingsStore.getState();s.setViewMode('editor');s.setShowTree(false);s.setAssistantOpen(true);
  })`);
  await page.evaluate(`import("/src/store/files.ts").then(({useFilesStore})=>useFilesStore.getState().closeProject())`);
  await waitLong(page, `!!document.querySelector('[data-testid="library"]')`, 15_000);
  await reloadNativePage(page);
  await page.evaluate(`import("/src/store/files.ts").then(({useFilesStore})=>useFilesStore.getState().openProject(${JSON.stringify(projectId)}))`);
  await expect.poll(async () => page.evaluate(`import("/src/store/settings.ts").then(({useSettingsStore})=>{
    const {viewMode,showTree,assistantOpen}=useSettingsStore.getState();return {viewMode,showTree,assistantOpen};
  })`)).toEqual({viewMode:"editor",showTree:false,assistantOpen:true});
});

test("detached preview owns compile and logs and returns them when closed", async ({ tauriPage: page }) => {
  const { setEditorContent } = await import("../helpers");
  await createBlankProject(page, "Detached layout");
  await expect.poll(async () => page.evaluate(`import("/src/store/compile.ts").then(m=>m.useCompileStore.getState().status)`), { timeout: 30_000 }).toBe('success');
  const compileStyle = await page.evaluate(`['compile-button', 'compile-options-button'].map(id => document.querySelector('[data-testid="'+id+'"]').className)`);
  await page.evaluate(`Promise.all([import("/src/lib/preview-window.ts"),import("/src/store/files.ts"),import("/src/store/compile.ts")]).then(([p,f,c])=>{
    const files=f.useFilesStore.getState(), compile=c.useCompileStore.getState();
    return p.openPreviewWindow(files.projectId, files.projectName, {identity:compile.lastAttemptIdentity,status:'success',checkpoint:compile.lastCompileCheckpoint});
  })`);
  const preview = await page.waitForWindow(window => window.label === 'preview', { timeout: 20_000 });
  await expect.poll(async () => page.evaluate(`!!document.querySelector('[data-testid="compile-button"]')`)).toBe(false);
  await expect.poll(async () => preview.evaluate(`document.querySelector('[data-testid="compile-button"]')?.disabled`), { timeout: 20_000 }).toBe(false);
  await expect.poll(async () => preview.evaluate(`['compile-button', 'compile-options-button'].map(id => document.querySelector('[data-testid="'+id+'"]').className)`)).toEqual(compileStyle);
  await preview.evaluate(`(() => {
    const trigger = document.querySelector('[data-testid="compile-options-button"]');
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await expect.poll(async () => preview.evaluate(`document.querySelector('[role="menu"]')?.textContent ?? ''`)).toContain('Recompile from scratch');
  await preview.evaluate(`document.querySelector('[role="menu"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  const before = await page.evaluate<number>(`import("/src/store/compile.ts").then(m=>m.useCompileStore.getState().lastAttemptIdentity.requestGeneration)`);
  await setEditorContent(page, '\\documentclass{article}\n\\begin{document}\nDetached edits reach the compiler.\n\\end{document}\n');
  await preview.click('[data-testid="compile-button"]');
  await expect.poll(async () => page.evaluate(`import("/src/store/compile.ts").then(m=>{const s=m.useCompileStore.getState();return s.status==='success' && s.lastAttemptIdentity.requestGeneration > ${before};})`), { timeout: 30_000 }).toBe(true);
  await preview.click('[data-tour="project-compile-logs"] button');
  await expect.poll(async () => preview.evaluate(`document.querySelector('[data-testid="detached-compile-log"]')?.textContent.length ?? 0`)).toBeGreaterThan(0);
  await expect.poll(async () => preview.evaluate(`document.querySelectorAll('[data-page]').length`), { timeout: 20_000 }).toBeGreaterThan(0);
  const projectId = await page.evaluate<string>(`import("/src/store/files.ts").then(m=>m.useFilesStore.getState().projectId)`);
  const geometry = await preview.evaluate(`({ width: innerWidth, height: innerHeight })`);
  await page.evaluate(`import("/src/store/files.ts").then(m=>m.useFilesStore.getState().closeProject())`);
  await waitLong(page, `!!document.querySelector('[data-testid="library"]')`, 15_000);
  await expect.poll(async () => (await page.listWindows()).some(w => w.label === 'preview')).toBe(false);
  await reloadNativePage(page);
  await page.evaluate(`import("/src/store/files.ts").then(m=>m.useFilesStore.getState().openProject(${JSON.stringify(projectId)}))`);
  const restoredPreview = await page.waitForWindow(w => w.label === 'preview', { timeout: 20_000 });
  await expect.poll(async () => restoredPreview.evaluate(`({ width: innerWidth, height: innerHeight })`)).toEqual(geometry);
  await expect.poll(async () => restoredPreview.evaluate(`!!document.querySelector('[data-testid="preview-reattach"]')`)).toBe(true);
  await restoredPreview.click('[data-testid="preview-reattach"]');
  await expect.poll(async () => page.evaluate(`!!document.querySelector('[data-testid="compile-button"]')`), { timeout: 15_000 }).toBe(true);
});


test("sidebar width and document split survive a new session", async ({ tauriPage: page }) => {
  await createBlankProject(page, "Pane sizes");
  await page.evaluate(`import("/src/store/settings.ts").then(({useSettingsStore})=>{ const s=useSettingsStore.getState(); s.setViewMode('split'); s.setShowTree(true); })`);
  await waitLong(page, `!!document.querySelector('[data-panel-resize-handle-id="h-mid"]') && !!document.querySelector('[data-panel-resize-handle-id="h-tree"]')`, 15_000);
  await page.evaluate(`(() => {
    for (const id of ['h-tree','h-mid']) {
      const handle = document.querySelector('[data-panel-resize-handle-id="'+id+'"]');
      handle.focus();
      for(let i=0;i<3;i++) handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    }
  })()`);
  const sizes = await page.evaluate<number[]>(`['sidebar','editor'].map(id=>Number(document.querySelector('[data-panel-id="'+id+'"]').getAttribute('data-panel-size')))`);
  const projectId = await page.evaluate<string>(`import("/src/store/files.ts").then(m=>m.useFilesStore.getState().projectId)`);
  await expect.poll(async () => page.evaluate(`!!localStorage.getItem('react-resizable-panels:oleafly.workspace.${projectId}.document')`)).toBe(true);
  await page.evaluate(`import("/src/store/files.ts").then(m=>m.useFilesStore.getState().closeProject())`);
  await waitLong(page, `!!document.querySelector('[data-testid="library"]')`, 15_000);
  await reloadNativePage(page);
  await page.evaluate(`import("/src/store/files.ts").then(m=>m.useFilesStore.getState().openProject(${JSON.stringify(projectId)}))`);
  await expect.poll(async () => page.evaluate(`['sidebar','editor'].map(id=>Number(document.querySelector('[data-panel-id="'+id+'"]')?.getAttribute('data-panel-size') ?? -1))`)).toEqual(sizes);
});

test("grouped layouts open the assistant and its sidebar button hides it", async ({ tauriPage: page }) => {
  await page.evaluate(`import("/src/lib/e2e-probe.ts").then(w => w.resizeCurrentWindow(900, 700))`);
  await createBlankProject(page, 'Grouped actions');
  await page.click('[data-testid="workspace-menu"]');
  await page.getByText('Layout', { exact: true }).click();
  await page.getByText('AI Only', { exact: true }).click();
  await expect.poll(async () => page.evaluate(`import("/src/store/settings.ts").then(m=>({open:m.useSettingsStore.getState().assistantOpen,hidden:m.useSettingsStore.getState().workspaceHidden}))`)).toEqual({open:true,hidden:true});
  await expect(page.locator('[data-testid="assistant-hide"]')).toBeVisible({ timeout: 20_000 });
  await page.click('[data-testid="assistant-hide"]');
  await expect.poll(async () => page.evaluate(`import("/src/store/settings.ts").then(m=>({open:m.useSettingsStore.getState().assistantOpen,hidden:m.useSettingsStore.getState().workspaceHidden}))`)).toEqual({open:false,hidden:false});
});

test("the shared detached PDF controls save a copy into the current project", async ({ tauriPage: page }) => {
  await createBlankProject(page, "Detached save controls");
  await expect.poll(async () => page.evaluate(`import("/src/store/compile.ts").then(m => m.useCompileStore.getState().status)`), { timeout: 30_000 }).toBe("success");
  await page.evaluate(`Promise.all([import("/src/lib/preview-window.ts"), import("/src/store/files.ts"), import("/src/store/compile.ts")]).then(([p, f, c]) => {
    const files = f.useFilesStore.getState(), compile = c.useCompileStore.getState();
    return p.openPreviewWindow(files.projectId, files.projectName, { identity: compile.lastAttemptIdentity, status: 'success', checkpoint: compile.lastCompileCheckpoint });
  })`);
  const preview = await page.waitForWindow(window => window.label === "preview", { timeout: 20_000 });
  await expect.poll(async () => preview.evaluate(`document.querySelectorAll('[data-page]').length`), { timeout: 20_000 }).toBeGreaterThan(0);
  const saveButton = 'button[aria-label="Save PDF to project"]';
  if (await preview.evaluate(`!!document.querySelector(${JSON.stringify(saveButton)})`)) {
    await preview.click(saveButton);
  } else {
    await preview.click('button[aria-label="More preview controls"]');
    await preview.getByText("Save PDF to project", { exact: true }).click();
  }
  await preview.fill('input[aria-label="Project save name"]', 'detached-copy.pdf');
  await preview.getByText("Save", { exact: true }).click();
  await expect.poll(async () => page.evaluate(`import("/src/store/files.ts").then(m => JSON.stringify(m.useFilesStore.getState().tree).includes('detached-copy.pdf'))`), { timeout: 15_000 }).toBe(true);
  await preview.click('[data-testid="preview-reattach"]');
});
