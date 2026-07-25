import { test, expect } from "../fixtures";
import {
  caretIn,
  clickToolbarControl,
  createBlankProject,
  openProject,
  pressGlobal,
  selectWord,
  waitEditorContains,
} from "../helpers";

const RUN = Date.now().toString(36);

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
  await waitEditorContains(tauriPage, "\\textbf{Write}", 20_000);
  await waitEditorContains(tauriPage, "\\href{url}{link text}", 20_000);

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
