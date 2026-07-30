import { test, expect } from "../fixtures";
import {
  caretIn,
  clickToolbarControl,
  editorSource,
  openProject,
  selectWord,
  type Page,
} from "../helpers";

async function expectSourceRestoredAndSaved(page: Page, expected: string) {
  await page.waitForFunction(
    `import("/src/components/editor/cm/controller.ts").then(
      ({ getEditorView }) =>
        getEditorView()?.state.doc.toString() === ${JSON.stringify(expected)}
    )`,
    10_000,
  );
  await page.evaluate(
    `import("/src/store/files.ts").then(
      ({ useFilesStore }) => useFilesStore.getState().saveActive()
    )`,
  );
}

test("bold wraps the selection; undo and redo round-trip", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const original = await editorSource(tauriPage);

  await selectWord(tauriPage, "Write");
  await clickToolbarControl(tauriPage, '[aria-label^="Bold ("]', "Bold");
  await expect(tauriPage.locator(".cm-content")).toContainText("\\textbf{Write}");

  await tauriPage.click('[aria-label^="Undo ("]');
  await tauriPage.waitForFunction(
    `!document.querySelector('.cm-content').textContent.includes('\\\\textbf{Write}')`,
    10_000,
  );
  await tauriPage.click('[aria-label^="Redo ("]');
  await expect(tauriPage.locator(".cm-content")).toContainText("\\textbf{Write}");
  // Leave the document as we found it.
  await tauriPage.click('[aria-label^="Undo ("]');
  await expectSourceRestoredAndSaved(tauriPage, original);
});

test("toolbar inserts figure and table environments", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const original = await editorSource(tauriPage);
  await caretIn(tauriPage, "here.", 1, "end");

  await clickToolbarControl(tauriPage, '[aria-label="Insert figure"]', "Insert figure");
  await expect(tauriPage.locator(".cm-content")).toContainText("includegraphics");
  await tauriPage.click('[aria-label^="Undo ("]');
  await expectSourceRestoredAndSaved(tauriPage, original);

  // On a narrow CI window "Insert table" can land in the toolbar's overflow
  // menu, where the size-grid popover (nested inside that menu's own popover)
  // occasionally fails to open or gets torn down mid-interaction as the
  // overflow set re-measures. Retry the whole open-pick-verify sequence
  // rather than just the "did it open" check, so a bad window gets another
  // full attempt instead of proceeding into a doomed click.
  let tableInserted = false;
  for (let attempt = 0; attempt < 8 && !tableInserted; attempt++) {
    try {
      await clickToolbarControl(tauriPage, '[aria-label="Insert table"]', "Table");
      await tauriPage.waitForFunction(`!!document.querySelector('[aria-label="2 by 2 table"]')`, 4_000);
      await tauriPage.click('[aria-label="2 by 2 table"]');
      await tauriPage.waitForFunction(
        `(document.querySelector('.cm-content')?.textContent || '').includes('tabular')`,
        4_000,
      );
      tableInserted = true;
    } catch {}
  }
  if (!tableInserted) throw new Error("could not insert a table via the toolbar after 8 attempts");
  await tauriPage.click('[aria-label^="Undo ("]');
  await tauriPage.waitForFunction(
    `!(document.querySelector('.cm-content')?.textContent || '').includes('tabular')`,
    5_000,
  );
  await expectSourceRestoredAndSaved(tauriPage, original);
});

test("citation button opens the add-citation dialog", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await clickToolbarControl(tauriPage, '[aria-label="Cite from project"]', "Cite from project");
  await tauriPage.getByText("Find and add a new citation…").click();
  await expect(
    tauriPage.locator('input[placeholder="DOI, arXiv id, URL, or a paper title…"]'),
  ).toBeVisible();
  // The fixture's per-test reload cleans up the dialog.
});

test("right-click context menu offers editor actions and inserts an equation", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const original = await editorSource(tauriPage);
  await caretIn(tauriPage, "here.", 1, "end");
  await tauriPage.evaluate(
    `(() => {
      const el = document.querySelector('.cm-content');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.left + 40, clientY: r.top + 40, button: 2,
      }));
    })()`,
  );
  await expect(tauriPage.getByText("Ask AI…")).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.getByText("Go to definition")).toBeVisible();
  await tauriPage.getByText("Equation").click();
  await expect(tauriPage.locator(".cm-content")).toContainText("\\begin{equation}");
  await tauriPage.click('[aria-label^="Undo ("]');
  await tauriPage.waitForFunction(
    `!(document.querySelector('.cm-content')?.textContent || '').includes('begin{equation}')`,
    5_000,
  );
  await expectSourceRestoredAndSaved(tauriPage, original);
});
