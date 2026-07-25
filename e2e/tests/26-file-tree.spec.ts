import { test, expect } from "../fixtures";
import {
  openProject,
  openRailTab,
  typeInEditorAtStart,
  type Page,
} from "../helpers";

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

async function createRootEntry(page: Page, name: string, mode: "file" | "dir") {
  const exists = await page.evaluate<boolean>(
    `!!document.querySelector('[aria-label="Source tree"] [data-path=${JSON.stringify(name)}]')`,
  );
  if (exists) return;
  await page.click('[data-path="main.tex"]');
  await page.click(
    mode === "file"
      ? '[title="New file (in the selected folder)"]'
      : '[title="New folder (in the selected folder)"]',
  );
  const placeholder = mode === "file" ? "New file name" : "New folder name";
  await page.fill(`input[placeholder=${JSON.stringify(placeholder)}]`, name);
  await page.press(`input[placeholder=${JSON.stringify(placeholder)}]`, "Enter");
  await page.waitForFunction(
    `!!document.querySelector('[aria-label="Source tree"] [data-path=${JSON.stringify(name)}]')`,
    15_000,
  );
}

async function startInlineRename(page: Page, from: string, to: string) {
  await pickMenuItem(
    page,
    from,
    "Rename",
    `!!document.querySelector('[aria-label="Rename file"]')`,
  );
  const committed = await page.evaluate<boolean>(
    `(() => {
      const input = document.querySelector('[aria-label="Rename file"]');
      if (!input) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(input, ${JSON.stringify(to)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`,
  );
  expect(committed).toBe(true);
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

test("rename collisions offer Cancel, Keep both, and Replace without silent data loss", async ({
  tauriPage,
}) => {
  const run = Date.now().toString(36);
  const source = `collision-source-${run}.tex`;
  const target = `collision-target-${run}.tex`;
  const kept = `collision-target-${run} (2).tex`;
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Tree");

  await createRootEntry(tauriPage, target, "file");
  await typeInEditorAtStart(tauriPage, `% destination-${run}\n`);
  await createRootEntry(tauriPage, source, "file");
  await typeInEditorAtStart(tauriPage, `% source-${run}\n`);

  await startInlineRename(tauriPage, source, target);
  const conflict = tauriPage.locator('[role="alertdialog"][aria-label="File move conflict"]');
  await expect(conflict).toBeVisible({ timeout: 10_000 });
  await conflict.getByText("Cancel", { exact: true }).click();
  await expect(tauriPage.locator(`[data-path=${JSON.stringify(source)}]`)).toBeVisible();
  await expect(tauriPage.locator(`[data-path=${JSON.stringify(target)}]`)).toBeVisible();

  await startInlineRename(tauriPage, source, target);
  await expect(conflict).toBeVisible({ timeout: 10_000 });
  await conflict.getByText("Keep both", { exact: true }).click();
  await expect(tauriPage.locator(`[data-path=${JSON.stringify(source)}]`)).toBeHidden({
    timeout: 15_000,
  });
  await expect(tauriPage.locator(`[data-path=${JSON.stringify(kept)}]`)).toBeVisible({
    timeout: 15_000,
  });
  await tauriPage.click(`[data-path=${JSON.stringify(target)}]`);
  await expect(tauriPage.locator(".cm-content")).toContainText(`destination-${run}`);
  await tauriPage.click(`[data-path=${JSON.stringify(kept)}]`);
  await expect(tauriPage.locator(".cm-content")).toContainText(`source-${run}`);

  const replacement = `collision-replacement-${run}.tex`;
  await createRootEntry(tauriPage, replacement, "file");
  await typeInEditorAtStart(tauriPage, `% replacement-${run}\n`);
  await startInlineRename(tauriPage, replacement, target);
  await expect(conflict).toBeVisible({ timeout: 10_000 });
  await conflict.getByText("Replace", { exact: true }).click();
  await expect(tauriPage.locator(`[data-path=${JSON.stringify(replacement)}]`)).toBeHidden({
    timeout: 15_000,
  });
  await tauriPage.click(`[data-path=${JSON.stringify(target)}]`);
  await expect(tauriPage.locator(".cm-content")).toContainText(`replacement-${run}`);
});

test("dragging into a folder uses the same collision-safe Keep both flow", async ({
  tauriPage,
}) => {
  const run = Date.now().toString(36);
  const folder = `archive-${run}`;
  const name = `move-${run}.tex`;
  const nested = `${folder}/${name}`;
  const nestedKept = `${folder}/move-${run} (2).tex`;
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Tree");

  await createRootEntry(tauriPage, name, "file");
  await typeInEditorAtStart(tauriPage, `% moving-${run}\n`);
  await createRootEntry(tauriPage, folder, "dir");
  await tauriPage.click(`[data-path=${JSON.stringify(folder)}]`);
  await tauriPage.click('[title="New file (in the selected folder)"]');
  await tauriPage.fill('input[placeholder="New file name"]', name);
  await tauriPage.press('input[placeholder="New file name"]', "Enter");
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-path=${JSON.stringify(nested)}]')`,
    15_000,
  );
  await typeInEditorAtStart(tauriPage, `% existing-${run}\n`);

  await tauriPage.dragAndDrop(
    `[data-path=${JSON.stringify(name)}]`,
    `[data-path=${JSON.stringify(folder)}]`,
  );
  const conflict = tauriPage.locator('[role="alertdialog"][aria-label="File move conflict"]');
  await expect(conflict).toBeVisible({ timeout: 10_000 });
  await conflict.getByText("Keep both", { exact: true }).click();

  await expect(tauriPage.locator(`[data-path=${JSON.stringify(name)}]`)).toBeHidden({
    timeout: 15_000,
  });
  await expect(tauriPage.locator(`[data-path=${JSON.stringify(nested)}]`)).toBeVisible();
  await expect(tauriPage.locator(`[data-path=${JSON.stringify(nestedKept)}]`)).toBeVisible();
});
