import { test, expect } from "../fixtures";
import {
  caretIn,
  clickToolbarControl,
  createBlankProject,
  createProjectFromTemplate,
  expectDesktopShellAnchored,
  fillCommandPalette,
  openProject,
  pressGlobal,
  readProjectText,
  replaceEditorSource,
  selectWord,
  setEditorCaretAfter,
  type Page,
  waitEditorContains,
} from "../helpers";

const RUN = Date.now().toString(36);

interface EditorPaintProbe {
  sourceMatchesStore: boolean;
  sourceLength: number;
  visibleNonblankLines: number;
  unobscuredTextSamples: number;
  foldMarkerCount: number;
  largestFoldMarkerWidth: number;
  largestFoldMarkerHeight: number;
}

function editorPaintIsReady(paint: EditorPaintProbe): boolean {
  return (
    paint.sourceMatchesStore &&
    paint.sourceLength > 100 &&
    paint.visibleNonblankLines > 0 &&
    paint.unobscuredTextSamples > 0 &&
    paint.foldMarkerCount > 0 &&
    paint.largestFoldMarkerWidth <= 16 &&
    paint.largestFoldMarkerHeight <= 16
  );
}

async function editorPaintProbe(page: Page): Promise<EditorPaintProbe> {
  return await page.evaluate<EditorPaintProbe>(
    `Promise.all([
      import("/src/components/editor/cm/controller.ts"),
      import("/src/store/files.ts"),
    ]).then(([controller, filesModule]) => {
      const view = controller.getEditorView();
      if (!view) throw new Error("CodeMirror is unavailable");
      const files = filesModule.useFilesStore.getState();
      const source = view.state.doc.toString();
      const storeSource = files.activePath
        ? files.files[files.activePath]?.content ?? ""
        : "";
      const scroller = document.querySelector(".cm-scroller");
      if (!(scroller instanceof HTMLElement)) {
        throw new Error("CodeMirror scroller is unavailable");
      }
      const viewport = scroller.getBoundingClientRect();
      let visibleNonblankLines = 0;
      let unobscuredTextSamples = 0;
      for (const line of document.querySelectorAll(".cm-line")) {
        if (!(line instanceof HTMLElement) || !(line.textContent || "").trim()) continue;
        const rect = line.getBoundingClientRect();
        const style = getComputedStyle(line);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > viewport.top &&
          rect.top < viewport.bottom &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0;
        if (!visible) continue;
        visibleNonblankLines++;

        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (!textNode) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const textRect = range.getBoundingClientRect();
        const x = Math.min(textRect.right - 1, textRect.left + 2);
        const y = textRect.top + Math.min(2, textRect.height / 2);
        const top = document.elementFromPoint(x, y);
        if (top === line || (top instanceof Node && line.contains(top))) {
          unobscuredTextSamples++;
        }
      }

      const markers = Array.from(
        document.querySelectorAll(".cm-fold-marker svg"),
      ).map((marker) => marker.getBoundingClientRect());
      return {
        sourceMatchesStore: source === storeSource,
        sourceLength: source.length,
        visibleNonblankLines,
        unobscuredTextSamples,
        foldMarkerCount: markers.length,
        largestFoldMarkerWidth: Math.max(0, ...markers.map((rect) => rect.width)),
        largestFoldMarkerHeight: Math.max(0, ...markers.map((rect) => rect.height)),
      };
    })`,
  );
}

test("local LaTeX command completion survives project-intelligence refresh", async ({
  tauriPage,
}) => {
  const projectName = `E2E Local Completion ${RUN}`;
  await createBlankProject(tauriPage, projectName);

  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\begin{document}\n\\te\n\\end{document}\n",
  );
  await setEditorCaretAfter(tauriPage, "\\te");
  await tauriPage.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("CodeMirror is unavailable");
      const from = view.state.selection.main.from;
      view.dispatch({
        changes: { from, insert: "x" },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
    })`,
  );

  const completion = tauriPage.locator(".cm-tooltip-autocomplete");
  await expect(completion).toBeVisible({ timeout: 5_000 });
  await expect(completion).toContainText("\\textbf");
  await expect(completion).toContainText("\\textit");
  await expect(completion).toContainText("\\texttt");
});

test("reopening a project in persisted Visual mode keeps the workspace chrome anchored", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  const projectName = `E2E Visual Reopen ${RUN}`;
  await createBlankProject(tauriPage, projectName);

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.locator(".ProseMirror")).toBeVisible({
    timeout: 20_000,
  });

  await tauriPage.click('[aria-label="Home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({
    timeout: 20_000,
  });
  await openProject(tauriPage, projectName);

  await expect(tauriPage.locator(".ProseMirror")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    tauriPage.locator('[data-tour="project-toolbar"]'),
  ).toBeVisible();

  const shell = await tauriPage.evaluate<{
    documentScrollTop: number;
    toolbarTop: number;
    toolbarBottom: number;
    panelTop: number;
  }>(
    `(() => {
      const toolbar = document.querySelector('[data-tour="project-toolbar"]');
      const editor = document.querySelector('[data-tour="project-editor"]');
      if (!(toolbar instanceof HTMLElement) || !(editor instanceof HTMLElement)) {
        throw new Error("workspace chrome unavailable");
      }
      const toolbarRect = toolbar.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      return {
        documentScrollTop: document.scrollingElement?.scrollTop ?? -1,
        toolbarTop: toolbarRect.top,
        toolbarBottom: toolbarRect.bottom,
        panelTop: editorRect.top,
      };
    })()`,
  );
  expect(shell.documentScrollTop).toBe(0);
  expect(shell.toolbarTop).toBeGreaterThanOrEqual(0);
  expect(shell.toolbarBottom).toBeGreaterThan(shell.toolbarTop);
  expect(shell.panelTop).toBeGreaterThanOrEqual(shell.toolbarBottom);
  await expectDesktopShellAnchored(tauriPage);
});

test("a persisted Visual document paints source on its first forced-source mount", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  const projectName = `E2E First Source Paint ${RUN}`;
  await createProjectFromTemplate(tauriPage, "resume", projectName);

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 20_000 });

  try {
    // Reproduce the v0.3.1 migration path: the project remembers Visual mode,
    // while the experiment is now disabled and Source must mount active on
    // its very first frame.
    await tauriPage.evaluate(
      `import("/src/store/settings.ts").then(({ useSettingsStore }) =>
        useSettingsStore.getState().setVisualEditor(false)
      )`,
    );
    await openProject(tauriPage, projectName);
    await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

    let paint = await editorPaintProbe(tauriPage);
    try {
      await expect
        .poll(async () => {
          paint = await editorPaintProbe(tauriPage);
          return editorPaintIsReady(paint);
        }, { timeout: 20_000 })
        .toBe(true);
    } catch (error) {
      throw new Error(
        `editor paint invariants did not settle: ${JSON.stringify(paint)}`,
        { cause: error },
      );
    }
    expect(paint.sourceLength).toBeGreaterThan(100);
    expect(paint.visibleNonblankLines).toBeGreaterThan(0);
    expect(paint.unobscuredTextSamples).toBeGreaterThan(0);
    expect(paint.foldMarkerCount).toBeGreaterThan(0);
    expect(paint.largestFoldMarkerWidth).toBeLessThanOrEqual(16);
    expect(paint.largestFoldMarkerHeight).toBeLessThanOrEqual(16);
  } finally {
    await tauriPage.evaluate(
      `import("/src/store/settings.ts").then(({ useSettingsStore }) =>
        useSettingsStore.getState().setVisualEditor(true)
      )`,
    );
  }
});

test("toolbar edits flush on immediate close, survive reopen, and compile", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  const projectName = `E2E Toolbar Flow ${RUN}`;
  const transitionMarker = `% close-flush-${RUN}\n`;
  await createBlankProject(tauriPage, projectName);

  await selectWord(tauriPage, "Write");
  await clickToolbarControl(tauriPage, '[aria-label^="Bold ("]', "Bold");
  await expect(tauriPage.locator(".cm-content")).toContainText("\\textbf{Write}");

  await caretIn(tauriPage, "here.", 1, "end");
  await clickToolbarControl(tauriPage, '[aria-label="Insert link"]', "Insert link");
  await expect(tauriPage.locator(".cm-content")).toContainText("\\href{url}{link text}");

  await clickToolbarControl(tauriPage, '[aria-label="Insert figure"]', "Insert figure");
  await expect(tauriPage.locator(".cm-content")).toContainText("image-filename");
  await tauriPage.click('[aria-label^="Undo ("]');
  await tauriPage.waitForFunction(
    `!(document.querySelector('.cm-content')?.textContent || '').includes('image-filename')`,
    5_000,
  );
  await waitEditorContains(tauriPage, "\\href{url}{link text}", 5_000);

  // Put a final edit and the Home click in the same webview task. This proves
  // project close drains the dirty buffer rather than winning a race against
  // the 1.5-second autosave debounce.
  const closed = await tauriPage.evaluate<boolean>(
    `(() => {
      const content = document.querySelector('.cm-content');
      const home = document.querySelector('[aria-label="Home"]');
      if (!content || !home) return false;
      content.focus();
      const range = document.createRange();
      range.selectNodeContents(content);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('insertText', false, ${JSON.stringify(transitionMarker)})) {
        return false;
      }
      home.click();
      return true;
    })()`,
  );
  expect(closed).toBe(true);
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 20_000 });

  await openProject(tauriPage, projectName);
  await waitEditorContains(tauriPage, transitionMarker.trim(), 20_000);
  // On failure, capture what actually reached DISK: this distinguishes a
  // close-flush that lost the edit (disk lacks it too - app bug) from an
  // editor that merely loaded stale content (disk has it - load race).
  try {
    await waitEditorContains(tauriPage, "\\textbf{Write}", 20_000);
    await waitEditorContains(tauriPage, "\\href{url}{link text}", 20_000);
  } catch (error) {
    const disk = await readProjectText(tauriPage, "main.tex").catch(
      () => "unavailable",
    );
    throw new Error(`${String(error)}\non-disk main.tex:\n${disk.slice(0, 600)}`);
  }

  await expect(tauriPage.getByTestId("compile-button")).toBeEnabled({ timeout: 30_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute(
    "data-severity",
    "ok",
    { timeout: 120_000 },
  );
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 30_000 });
});

test("a direct project switch flushes an edit made in the same event turn", async ({
  tauriPage,
}) => {
  const targetName = `E2E Switch Target ${RUN}`;
  const marker = `% switch-flush-${RUN}\n`;
  await createBlankProject(tauriPage, targetName);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await fillCommandPalette(tauriPage, `/projects ${targetName}`);
  await expect(tauriPage.getByText(targetName, { exact: true })).toBeVisible();

  // Dispatch the edit and select the already-rendered project result without
  // yielding to the debounce timer between those two user-visible actions.
  const switched = await tauriPage.evaluate<boolean>(
    `(() => {
      import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
        const view = getEditorView();
        if (!view) throw new Error("editor unavailable");
        view.dispatch({ changes: { from: 0, insert: ${JSON.stringify(marker)} } });
        const result = Array.from(document.querySelectorAll('[cmdk-item]'))
          .find((item) => item.textContent.includes(${JSON.stringify(targetName)}));
        if (!result) throw new Error("target project result unavailable");
        result.click();
      });
      return true;
    })()`,
  );
  expect(switched).toBe(true);
  await expect(tauriPage.getByTestId("project-title")).toContainText(targetName, {
    timeout: 20_000,
  });

  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await fillCommandPalette(tauriPage, "/projects E2E Doc");
  await tauriPage.getByText("E2E Doc", { exact: true }).click();
  await waitEditorContains(tauriPage, marker.trim(), 20_000);
});
