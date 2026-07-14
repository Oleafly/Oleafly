import { test, expect } from "../fixtures";
import { openProject, openRailTab, type Page } from "../helpers";

// Menu items are selected with real plugin clicks (same as the library book
// menu); synthetic pointer-event dispatch on Radix items is unreliable.

async function treeContextMenu(page: Page & { getByText(t: string): unknown }, fileName: string) {
  const ok = await page.evaluate<boolean>(
    `(() => {
      const tree = document.querySelector('[aria-label="Source tree"]');
      if (!tree) return false;
      const rows = Array.from(tree.querySelectorAll('*'));
      const row = rows.find(el => el.children.length === 0 && el.textContent.trim() === ${JSON.stringify(fileName)});
      if (!row) return false;
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2,
      }));
      return true;
    })()`,
  );
  expect(ok).toBe(true);
}

async function pickMenuItem(
  page: Page,
  fileName: string,
  label: string,
  doneExpr: string,
) {
  for (let attempt = 0; ; attempt++) {
    await treeContextMenu(page, fileName);
    const opened = await page
      .waitForFunction(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).some(m => m.textContent.trim() === ${JSON.stringify(label)})`,
        5_000,
      )
      .then(() => true)
      .catch(() => false);
    if (opened) {
      await page.getByText(label, { exact: true }).click();
      const done = await page
        .waitForFunction(doneExpr, 5_000)
        .then(() => true)
        .catch(() => false);
      if (done) return;
    }
    if (attempt >= 3) throw new Error(`menu item ${label} never took effect`);
  }
}

test("create a scratch file in the tree", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Tree");

  // Menu operations run in their own tests (fresh pages): right after a
  // create, the tree refresh churn reliably swallows Radix menu-item selection.
  await tauriPage.click('[title="New file (in the selected folder)"]');
  await tauriPage.fill('input[placeholder="New file name"]', "scratch.tex");
  await tauriPage.press('input[placeholder="New file name"]', "Enter");
  await tauriPage.waitForFunction(
    `!document.querySelector('input[placeholder="New file name"]') && (document.querySelector('[aria-label="Source tree"]')?.textContent ?? '').includes('scratch.tex')`,
    15_000,
  );
});

test("rename a file via the tree context menu", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Tree");
  // A retry after a mid-rename failure may find the file already renamed
  // (the inline input commits on blur), so accept either starting state.
  await tauriPage.waitForFunction(
    `['scratch.tex', 'renamed.tex'].some(n => (document.querySelector('[aria-label="Source tree"]')?.textContent ?? '').includes(n))`,
    15_000,
  );
  const hasScratch = await tauriPage.evaluate<boolean>(
    `(document.querySelector('[aria-label="Source tree"]')?.textContent ?? '').includes('scratch.tex')`,
  );

  if (hasScratch) {
    await pickMenuItem(
      tauriPage,
      "scratch.tex",
      "Rename",
      `!!document.querySelector('[aria-label="Rename file"]')`,
    );
    // Set the name and commit with Enter in ONE evaluate: the input commits
    // on blur, so a separate fill-then-press can lose the input in between.
    const committed = await tauriPage.evaluate<boolean>(
      `(() => {
        const el = document.querySelector('[aria-label="Rename file"]');
        if (!el) return false;
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(el, 'renamed.tex');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`,
    );
    expect(committed).toBe(true);
  }
  await tauriPage.waitForFunction(
    `(document.querySelector('[aria-label="Source tree"]')?.textContent ?? '').includes('renamed.tex')
     && !(document.querySelector('[aria-label="Source tree"]')?.textContent ?? '').includes('scratch.tex')`,
    15_000,
  );
});

test("delete a file via the tree context menu", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Tree");
  await tauriPage.waitForFunction(
    `(document.querySelector('[aria-label="Source tree"]')?.textContent ?? '').includes('renamed.tex')`,
    15_000,
  );

  // Scoped confirm override: only accept the dialog naming this file.
  await tauriPage.evaluate(
    `(window.confirm = (msg) => typeof msg === 'string' && msg.includes('renamed.tex'), 1)`,
  );
  await pickMenuItem(
    tauriPage,
    "renamed.tex",
    "Delete",
    `!(document.querySelector('[aria-label="Source tree"]')?.textContent ?? '').includes('renamed.tex')`,
  );
});
