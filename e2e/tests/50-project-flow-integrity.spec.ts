import { test, expect } from "../fixtures";
import {
  caretIn,
  clickToolbarControl,
  createBlankProject,
  expectDesktopShellAnchored,
  openProject,
  pressGlobal,
  readProjectText,
  replaceEditorSource,
  selectWord,
  setEditorCaretAfter,
  waitEditorContains,
} from "../helpers";

const RUN = Date.now().toString(36);

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
  await tauriPage.fill("[cmdk-input]", `/projects ${targetName}`);
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
  await tauriPage.fill("[cmdk-input]", "/projects E2E Doc");
  await tauriPage.getByText("E2E Doc", { exact: true }).click();
  await waitEditorContains(tauriPage, marker.trim(), 20_000);
});
