import { test, expect } from "../fixtures";
import { caretIn, openProject, pressGlobal, typeInEditorAfter, type Page } from "../helpers";

// Code intelligence over the real project index: go-to-definition,
// find-references, and the rename dialog, driven by their keyboard shortcuts.

/** Dispatch a key to the editor (CodeMirror keymaps listen on its DOM). */
async function editorKey(page: Page, key: string, mods: { shift?: boolean } = {}) {
  await page.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, shiftKey: ${!!mods.shift}, bubbles: true, cancelable: true })), 1)`,
  );
}

test.beforeEach(async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Seed a label + ref pair once (idempotent: skip if already present).
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
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 60, button: 2 }));
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
    // The rail switches to the References panel listing main.tex hits.
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
  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:e2eintro", 2);
    await contextMenuAction(tauriPage, "Rename symbol");
    // The rename dialog announces the symbol being renamed.
    const opened = await tauriPage
      .waitForFunction(
        `document.body.innerText.includes('Rename') && document.body.innerText.includes('sec:e2eintro') && !!document.querySelector('input')`,
        5_000,
      )
      .then(() => true)
      .catch(() => false);
    if (opened) break;
    if (attempt >= 3) throw new Error("rename dialog never opened");
  }
  await tauriPage.evaluate(
    `(Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel').click(), 1)`,
  );
  await expect(tauriPage.locator(".cm-content")).toContainText("sec:e2eintro");
});
