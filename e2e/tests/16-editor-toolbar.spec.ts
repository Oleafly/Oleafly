import { test, expect } from "../fixtures";
import { caretIn, clickToolbarControl, openProject, selectWord } from "../helpers";

test("bold wraps the selection; undo and redo round-trip", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

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
});

test("toolbar inserts figure and table environments", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await caretIn(tauriPage, "here.", 1, "end");

  await clickToolbarControl(tauriPage, '[aria-label="Insert figure"]', "Insert figure");
  await expect(tauriPage.locator(".cm-content")).toContainText("includegraphics");
  await tauriPage.click('[aria-label^="Undo ("]');

  let gridOpen = false;
  for (let attempt = 0; attempt < 5 && !gridOpen; attempt++) {
    try {
      await clickToolbarControl(tauriPage, '[aria-label="Insert table"]', "Table");
      await tauriPage.waitForFunction(`!!document.querySelector('[aria-label="2 by 2 table"]')`, 3_000);
      gridOpen = true;
    } catch {}
  }
  await tauriPage.click('[aria-label="2 by 2 table"]');
  await expect(tauriPage.locator(".cm-content")).toContainText("tabular");
  await tauriPage.click('[aria-label^="Undo ("]');
  await tauriPage.waitForFunction(
    `!(document.querySelector('.cm-content')?.textContent || '').includes('tabular')`,
    5_000,
  );
});

test("citation button opens the add-citation dialog", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Add citation (DOI, arXiv, or title)"]',
    "Add citation",
  );
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
});
