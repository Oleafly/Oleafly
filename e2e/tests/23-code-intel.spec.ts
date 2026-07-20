import { test, expect } from "../fixtures";
import { caretIn, openProject, pressGlobal, typeInEditorAfter, type Page } from "../helpers";

// CodeMirror keymaps listen on its own DOM, so dispatch directly to it.
async function editorKey(page: Page, key: string, mods: { shift?: boolean } = {}) {
  await page.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, shiftKey: ${!!mods.shift}, bubbles: true, cancelable: true })), 1)`,
  );
}

test.beforeEach(async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const has = await tauriPage.evaluate<boolean>(
    `document.querySelector('.cm-content').textContent.includes('sec:e2eintro')`,
  );
  if (!has) {
    // The label must sit in the body (not inside \section{...}) for the
    // project index to record it as a definition; prose anchors are single
    // syntax tokens.
    await typeInEditorAfter(tauriPage, "Write", "\\label{sec:e2eintro} ");
    await typeInEditorAfter(tauriPage, "here.", " See Section~\\ref{sec:e2eintro}.");
    // Persist the seed (unsaved edits revert on the fixture's per-test
    // reload) and give the project index a compile's worth of time.
    await pressGlobal(tauriPage, "Enter", { meta: true });
    await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute(
      "data-severity",
      "ok",
      { timeout: 90_000 },
    );
  }
});

async function contextMenuAction(page: Page & { getByText(t: string): { click(): Promise<void> } }, item: string) {
  await page.evaluate(
    `(() => {
      const el = document.querySelector('.cm-content');
      const cursor = document.querySelector('.cm-cursor-primary') || document.querySelector('.cm-cursor');
      const r = cursor?.getBoundingClientRect();
      if (!r) throw new Error('editor cursor not found');
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.top + r.height / 2, button: 2 }));
      return 1;
    })()`,
  );
  await page.getByText(item).click();
}

test("go-to-definition on a \\ref jumps to its \\label", async ({ tauriPage }) => {
  // The project index rebuilds on a debounce after the seed edit; retry the
  // navigation until the index has the symbol.
  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:e2eintro", 2);
    await contextMenuAction(tauriPage, "Go to definition");
    const landed = await tauriPage
      .waitForFunction(
        `window.getSelection().toString().includes('sec:e2eintro') || (document.querySelector('.cm-activeLine')?.textContent ?? '').includes('label{sec:e2eintro}')`,
        5_000,
      )
      .then(() => true)
      .catch(() => false);
    if (landed) break;
    if (attempt >= 3) throw new Error("go-to-definition never landed");
  }
});

test("Shift+F12 opens the references panel with the usage", async ({ tauriPage }) => {
  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:e2eintro", 2);
    await editorKey(tauriPage, "F12", { shift: true });
    const landed = await tauriPage
      .waitForFunction(
        `document.body.innerText.includes('sec:e2eintro') && !!document.querySelector('[aria-label="References (Shift-F12)"]')`,
        5_000,
      )
      .then(() => true)
      .catch(() => false);
    if (landed) break;
    if (attempt >= 3) throw new Error("references never listed");
  }
});

test("F2 opens the rename-symbol dialog and cancel leaves the doc untouched", async ({
  tauriPage,
}) => {
  const dialog = tauriPage.locator('[role="dialog"][aria-labelledby="rename-title"]');
  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:e2eintro", 2);
    await contextMenuAction(tauriPage, "Rename symbol");
    const opened = await expect(dialog)
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) break;
    if (attempt >= 3) throw new Error("rename dialog never opened");
  }
  await dialog.getByText("Cancel", { exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(tauriPage.locator(".cm-content")).toContainText("sec:e2eintro");
});
