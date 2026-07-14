import { test, expect } from "../fixtures";
import { caretIn, openProject } from "../helpers";

async function selectWord(tauriPage: { evaluate<T>(e: string): Promise<T> }, word: string) {
  // Drive a synthetic mouse-drag over real text coordinates: CM re-asserts
  // its state over foreign DOM selections, so Range/Selection injection
  // does not stick.
  const ok = await tauriPage.evaluate<boolean>(
    `(() => {
      const content = document.querySelector('.cm-content');
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf(${JSON.stringify(word)});
        if (i >= 0) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + ${JSON.stringify(word)}.length);
          const rects = range.getClientRects();
          const a = rects[0], b = rects[rects.length - 1];
          const opts = (x, y, extra) => Object.assign({
            bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1, detail: 1,
          }, extra);
          const sx = a.left + 1, sy = a.top + a.height / 2;
          const ex = b.right - 1, ey = b.top + b.height / 2;
          const target = document.elementFromPoint(sx, sy) || content;
          target.dispatchEvent(new MouseEvent('mousedown', opts(sx, sy)));
          document.dispatchEvent(new MouseEvent('mousemove', opts(ex, ey)));
          document.dispatchEvent(new MouseEvent('mouseup', opts(ex, ey, { buttons: 0 })));
          return true;
        }
      }
      return false;
    })()`,
  );
  expect(ok).toBe(true);
}

test("bold wraps the selection; undo and redo round-trip", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await selectWord(tauriPage, "Write");
  await tauriPage.waitForFunction(`window.getSelection().toString() === 'Write'`, 5_000);
  await tauriPage.click('[aria-label="Bold (⌘B)"]');
  await expect(tauriPage.locator(".cm-content")).toContainText("\\textbf{Write}");

  await tauriPage.click('[aria-label="Undo (⌘Z)"]');
  await tauriPage.waitForFunction(
    `!document.querySelector('.cm-content').textContent.includes('\\\\textbf{Write}')`,
    10_000,
  );
  await tauriPage.click('[aria-label="Redo (⌘⇧Z)"]');
  await expect(tauriPage.locator(".cm-content")).toContainText("\\textbf{Write}");
  // Leave the document as we found it.
  await tauriPage.click('[aria-label="Undo (⌘Z)"]');
});

test("toolbar inserts figure and table environments", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await caretIn(tauriPage, "here.", 1, "end");

  await tauriPage.click('[aria-label="Insert figure"]');
  await expect(tauriPage.locator(".cm-content")).toContainText("includegraphics");
  await tauriPage.click('[aria-label="Undo (⌘Z)"]');

  await tauriPage.click('[aria-label="Insert table"]');
  await expect(tauriPage.locator(".cm-content")).toContainText("tabular");
  await tauriPage.click('[aria-label="Undo (⌘Z)"]');
  await tauriPage.waitForFunction(
    `!(document.querySelector('.cm-content')?.textContent || '').includes('tabular')`,
    5_000,
  );
});

test("citation button opens the add-citation dialog", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Add citation (DOI, arXiv, or title)"]');
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
  await tauriPage.click('[aria-label="Undo (⌘Z)"]');
  await tauriPage.waitForFunction(
    `!(document.querySelector('.cm-content')?.textContent || '').includes('begin{equation}')`,
    5_000,
  );
});
