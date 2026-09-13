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
  await openRailTab(tauriPage, "Explorer");
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

test("Explorer sections collapse, resize, and restore as one stack", async ({ tauriPage }) => {
  const storageKey = "react-resizable-panels:sidebar-explorer-sections-v3";
  const previousLayout = await tauriPage.evaluate<string | null>(
    `localStorage.getItem(${JSON.stringify(storageKey)})`,
  );
  const sectionIds = ["source-tree", "document-outline", "project-structure"] as const;
  const panelIds = [
    "source-tree-v",
    "document-outline-v",
    "project-structure-v",
    "explorer-filler-v",
  ] as const;
  const panelSizes = () =>
    tauriPage.evaluate<number[]>(`(() => {
      const ids = ${JSON.stringify(panelIds)};
      return ids.map((id) => Number(document.querySelector('[data-panel-id="' + id + '"]')?.getAttribute('data-panel-size') ?? -1));
    })()`);
  const waitForFillerReclaimed = async () => {
    await tauriPage.waitForFunction(
      `Number(document.querySelector('[data-panel-id="explorer-filler-v"]')?.getAttribute('data-panel-size') ?? -1) < 0.2`,
      5_000,
    );
  };
  const waitForStructureCollapsedAtBottom = async () => {
    await tauriPage.waitForFunction(
      `(() => {
        const stack = document.querySelector('[data-testid="explorer-stack"]')?.getBoundingClientRect();
        const structure = document.querySelector('[data-panel-id="project-structure-v"]')?.getBoundingClientRect();
        const toggle = document.querySelector('[data-testid="project-structure"] button[aria-controls="project-structure-content"]');
        const fillerSize = Number(document.querySelector('[data-panel-id="explorer-filler-v"]')?.getAttribute('data-panel-size') ?? -1);
        return toggle?.getAttribute('aria-expanded') === 'false'
          && fillerSize < 0.2
          && !!stack
          && !!structure
          && Math.abs(stack.bottom - structure.bottom) < 1;
      })()`,
      5_000,
    );
  };
  const sectionToggle = (id: (typeof sectionIds)[number]) =>
    tauriPage
      .getByTestId(id)
      .locator(`button[aria-controls="${id}-content"]`);
  const setSectionOpen = async (
    id: (typeof sectionIds)[number],
    open: boolean,
  ) => {
    const toggle = sectionToggle(id);
    if ((await toggle.getAttribute("aria-expanded")) !== String(open)) {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", String(open));
  };

  try {
    await openProject(tauriPage, "E2E Doc");
    await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

    // Start from the declared defaults instead of inheriting another test run's
    // saved split, then remount the Explorer so the panel group reads them.
    await openRailTab(tauriPage, "Search Project");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await tauriPage.evaluate(`localStorage.removeItem(${JSON.stringify(storageKey)})`);
    await openRailTab(tauriPage, "Explorer");

    await expect(sectionToggle("source-tree")).toContainText("Explorer");
    await expect(
      tauriPage.getByRole("heading", { name: "Explorer", level: 2 }),
    ).toHaveCount(0);
    await expect(sectionToggle("source-tree")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(sectionToggle("document-outline")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(sectionToggle("project-structure")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await waitForFillerReclaimed();
    const initialStructureGeometry = await tauriPage.evaluate<{
      bottomGap: number;
      height: number;
    }>(`(() => {
      const stack = document.querySelector('[data-testid="explorer-stack"]')?.getBoundingClientRect();
      const structure = document.querySelector('[data-panel-id="project-structure-v"]')?.getBoundingClientRect();
      if (!stack || !structure) throw new Error("Explorer structure geometry is missing");
      return { bottomGap: Math.abs(stack.bottom - structure.bottom), height: structure.height };
    })()`);
    expect(initialStructureGeometry.bottomGap).toBeLessThan(1);
    // WebView device-pixel rounding can report the 32px collapsed header just
    // below 31 CSS px; keep the guard focused on actual clipping.
    expect(initialStructureGeometry.height).toBeGreaterThanOrEqual(30.5);
    expect(initialStructureGeometry.height).toBeLessThanOrEqual(33);

    const sectionActions = [
      ["source-tree", "Expand all folders", "Collapse all folders"],
      ["document-outline", "Expand all headings", "Collapse all headings"],
      [
        "project-structure",
        "Expand all structure items",
        "Collapse all structure items",
      ],
    ] as const;
    for (const [id, expandLabel, collapseLabel] of sectionActions) {
      const section = tauriPage.getByTestId(id);
      await expect(section).toBeVisible();
      await expect(sectionToggle(id)).toHaveCount(1);
      await setSectionOpen(id, true);
      // The native Tauri driver does not map implicit HTML button roles and
      // drops ancestor scope for nested role queries. Match the semantic
      // button directly so each action stays scoped to its own section.
      const expandAll = section.locator(
        `button[aria-label="${expandLabel}"]`,
      );
      const collapseAll = section.locator(
        `button[aria-label="${collapseLabel}"]`,
      );
      await expect
        .poll(async () => (await expandAll.count()) + (await collapseAll.count()))
        .toBe(1);
      const showsCollapse = (await collapseAll.count()) === 1;
      const bulkToggle = showsCollapse ? collapseAll : expandAll;
      const bulkOpacity = () =>
        tauriPage.evaluate<string>(`(() => {
          const actions = document.querySelector(${JSON.stringify(
            `[data-testid="${id}-actions"]`,
          )});
          if (!actions) throw new Error("Explorer section actions are missing");
          return getComputedStyle(actions).opacity;
        })()`);
      const sectionClasses = (await section.getAttribute("class")) ?? "";
      const actionClasses =
        (await section.locator(`[data-testid="${id}-actions"]`).getAttribute("class")) ??
        "";
      expect(sectionClasses.split(/\s+/)).toContain("group/section");
      expect(actionClasses.split(/\s+/)).toEqual(
        expect.arrayContaining([
          "opacity-0",
          "group-hover/section:opacity-100",
          "group-focus-within/section:opacity-100",
        ]),
      );
      await expect(
        bulkToggle.locator(
          showsCollapse ? "svg.lucide-copy-minus" : "svg.lucide-copy-plus",
        ),
      ).toHaveCount(1);

      // The native driver dispatches synthetic mouse events, which cannot set
      // the browser's CSS :hover state. The class contract above covers hover;
      // exercise the equivalent focus-within reveal with a real DOM focus.
      await tauriPage.locator(".cm-content").focus();
      await expect.poll(bulkOpacity).toBe("0");
      await sectionToggle(id).focus();
      await expect.poll(bulkOpacity).toBe("1");
    }
    await setSectionOpen("project-structure", false);
    await waitForStructureCollapsedAtBottom();

    const sectionTops = await tauriPage.evaluate<number[]>(`(() => {
      const ids = ${JSON.stringify(sectionIds)};
      return ids.map((id) => document.querySelector('[data-testid="' + id + '"]')?.getBoundingClientRect().top ?? -1);
    })()`);
    expect(sectionTops[0]).toBeLessThan(sectionTops[1]);
    expect(sectionTops[1]).toBeLessThan(sectionTops[2]);

    // Collapsing one view can temporarily give its space to the next view. Do
    // this in visual order so the final view hands the unused space to the
    // dedicated filler rather than forcing an earlier header back open.
    for (const id of sectionIds) await setSectionOpen(id, false);
    for (const id of sectionIds) {
      await expect(sectionToggle(id)).toBeVisible();
      await expect(sectionToggle(id)).toHaveAttribute("aria-expanded", "false");
    }
    const fullyCollapsedSizes = await panelSizes();
    const { stackHeight, sectionHeights } = await tauriPage.evaluate<{
      stackHeight: number;
      sectionHeights: number[];
    }>(`(() => ({
      stackHeight: document.querySelector('[data-testid="explorer-stack"]')?.getBoundingClientRect().height ?? -1,
      sectionHeights: ${JSON.stringify(sectionIds)}.map((id) => document.querySelector('[data-testid="' + id + '"]')?.getBoundingClientRect().height ?? -1),
    }))()`);
    const expectedCollapsedSize = Math.max(
      1.5,
      Math.min(28, (32 / stackHeight) * 100),
    );
    expect(
      fullyCollapsedSizes
        .slice(0, 3)
        .every((size) => Math.abs(size - expectedCollapsedSize) < 0.3),
    ).toBe(true);
    expect(sectionHeights.every((height) => height >= 30.5 && height <= 33)).toBe(
      true,
    );
    expect(fullyCollapsedSizes[3]).toBeGreaterThan(0);

    // Re-enter Explorer with the all-collapsed layout restored from storage.
    // The app mounts this stack in StrictMode, so opening Structure after the
    // remount must still reclaim the filler instead of leaving its content at
    // the minimum expanded height above a large blank area.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await openRailTab(tauriPage, "Search Project");
    await openRailTab(tauriPage, "Explorer");
    for (const id of sectionIds) {
      await expect(sectionToggle(id)).toHaveAttribute("aria-expanded", "false");
    }

    await setSectionOpen("project-structure", true);
    await waitForFillerReclaimed();
    const structureBottomGap = await tauriPage.evaluate<number>(`(() => {
      const stack = document.querySelector('[data-testid="explorer-stack"]')?.getBoundingClientRect();
      const structure = document.querySelector('[data-panel-id="project-structure-v"]')?.getBoundingClientRect();
      if (!stack || !structure) throw new Error("Explorer structure geometry is missing");
      return Math.abs(stack.bottom - structure.bottom);
    })()`);
    expect(structureBottomGap).toBeLessThan(1);
    await setSectionOpen("project-structure", false);

    await setSectionOpen("source-tree", true);
    await setSectionOpen("document-outline", true);
    const geometry = () =>
      tauriPage.evaluate<{
        sourceHeight: number;
        outlineTop: number;
        outlineHeight: number;
      }>(`(() => {
        const source = document.querySelector('[data-panel-id="source-tree-v"]')?.getBoundingClientRect();
        const outline = document.querySelector('[data-panel-id="document-outline-v"]')?.getBoundingClientRect();
        if (!source || !outline) throw new Error("Explorer panels are missing");
        return { sourceHeight: source.height, outlineTop: outline.top, outlineHeight: outline.height };
      })()`);
    const beforeResize = await geometry();
    const handle = tauriPage.getByRole("separator", {
      name: "Resize Explorer and Outline",
    });
    await expect(handle).toBeVisible();
    await handle.focus();
    await tauriPage.keyboard.press("ArrowDown");
    await tauriPage.waitForFunction(
      `Math.abs((document.querySelector('[data-panel-id="source-tree-v"]')?.getBoundingClientRect().height ?? 0) - ${JSON.stringify(beforeResize.sourceHeight)}) >= 1`,
      5_000,
    );
    const afterResize = await geometry();
    expect(afterResize.sourceHeight).not.toBe(beforeResize.sourceHeight);
    expect(afterResize.outlineTop).not.toBe(beforeResize.outlineTop);
    expect(afterResize.outlineHeight).not.toBe(beforeResize.outlineHeight);

    // Persist a non-default collapse pattern so this round-trip also proves
    // that the accordion headers are synchronized from the restored panel
    // layout rather than merely falling back to their React defaults.
    await setSectionOpen("source-tree", false);
    await setSectionOpen("document-outline", true);
    await setSectionOpen("project-structure", true);
    const persistedLayout = await panelSizes();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(
      await tauriPage.evaluate<string | null>(
        `localStorage.getItem(${JSON.stringify(storageKey)})`,
      ),
    ).not.toBeNull();

    await openRailTab(tauriPage, "Search Project");
    await openRailTab(tauriPage, "Explorer");
    await tauriPage.waitForFunction(
      `(() => {
        const ids = ${JSON.stringify(panelIds)};
        const expected = ${JSON.stringify(persistedLayout)};
        const actual = ids.map((id) => Number(document.querySelector('[data-panel-id="' + id + '"]')?.getAttribute('data-panel-size') ?? -1));
        return actual.every((size, index) => Math.abs(size - expected[index]) < 0.6);
      })()`,
      5_000,
    );
    await expect(sectionToggle("source-tree")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(sectionToggle("document-outline")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(sectionToggle("project-structure")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    for (const id of sectionIds) await expect(sectionToggle(id)).toBeVisible();
  } finally {
    // Let the panel library flush its debounced save, then restore the state
    // this shared native webview had before the regression ran.
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await openRailTab(tauriPage, "Search Project");
    } catch {
      // If setup failed before the rail mounted, there is nothing to unmount.
    }
    await tauriPage.evaluate(`(() => {
      const key = ${JSON.stringify(storageKey)};
      const value = ${JSON.stringify(previousLayout)};
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return true;
    })()`);
    expect(
      await tauriPage.evaluate<string | null>(
        `localStorage.getItem(${JSON.stringify(storageKey)})`,
      ),
    ).toBe(previousLayout);
  }
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
  await openRailTab(tauriPage, "Explorer");
  const explorerToggle = tauriPage
    .getByTestId("source-tree")
    .locator('button[aria-controls="source-tree-content"]');
  if ((await explorerToggle.getAttribute("aria-expanded")) !== "true") {
    await explorerToggle.click();
  }
  await expect(explorerToggle).toHaveAttribute("aria-expanded", "true");
  // Keep focus inside the section so its on-hover/on-focus controls are
  // exposed even though the native test driver cannot set CSS :hover.
  await explorerToggle.focus();
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
