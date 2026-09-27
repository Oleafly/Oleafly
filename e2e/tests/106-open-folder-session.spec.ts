import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import {
  expectFolderUnchanged,
  folderCard,
  folderFixtures,
  goToLibrary,
  openFolder,
  openedState,
  showSplitView,
  snapshotFolder,
  waitForCompileSuccess,
} from "../open-folder";
import { scriptValue } from "../script-value";

const fixtures = folderFixtures("session");
const SECOND = `Draft Two ${fixtures.tag}`;
const VANISHING = `Vanishing Paper ${fixtures.tag}`;

test.afterAll(() => fixtures.remove());

function article(body: string): string {
  return `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

test("opening another folder while an edit is unsaved keeps the edit", async ({ tauriPage: page }) => {
  const first = fixtures.make("Draft One", { "main.tex": article("Original first draft.") });
  const second = fixtures.make(SECOND, { "main.tex": article("Second folder draft.") });
  const secondBefore = snapshotFolder(second);
  const firstBefore = snapshotFolder(first);
  const edit = " Unsaved edit kept across the switch.";

  const opened = await openFolder(page, first);
  await expect.poll(async () => page.evaluate<boolean>(
    `import("/src/store/files.ts").then(({ useFilesStore }) => {
      const s = useFilesStore.getState();
      return s.activePath === "main.tex" && typeof s.files["main.tex"]?.content === "string";
    })`,
  ), { timeout: 30_000 }).toBe(true);
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await waitForCompileSuccess(page);

  const dirtyAtSwitch = await page.evaluate<boolean>(
    `Promise.all([
      import("/src/components/editor/cm/controller.ts"),
      import("/src/store/files.ts"),
      import("/src/lib/tauri.ts"),
    ]).then(([controller, files, tauri]) => {
      const view = controller.getEditorView();
      const source = view.state.doc.toString();
      const anchor = source.indexOf("Original first draft.") + "Original first draft.".length;
      view.dispatch({ changes: { from: anchor, insert: ${scriptValue(edit)} }, userEvent: "input.type" });
      const dirty = files.useFilesStore.getState().files["main.tex"]?.dirty === true;
      return tauri.debugInjectOpenRequest(${scriptValue(second)}).then(() => dirty);
    })`,
  );
  expect(dirtyAtSwitch).toBe(true);

  await expect.poll(async () => {
    const state = await openedState(page);
    return !state.loading && state.projectId !== opened.projectId && state.projectName === SECOND;
  }, { timeout: 60_000 }).toBe(true);
  await waitForCompileSuccess(page);
  expect(await page.evaluate<unknown>(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().saveBlocked)`,
  )).toBeNull();
  await expect.poll(() => readFileSync(join(first, "main.tex"), "utf8"), { timeout: 20_000 }).toContain(
    `Original first draft.${edit}`,
  );
  expectFolderUnchanged(first, firstBefore, [".", "main.tex"]);

  const reopened = await openFolder(page, first);
  expect(reopened.projectId).toBe(opened.projectId);
  await expect.poll(async () => page.evaluate<string>(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().files["main.tex"]?.content ?? "")`,
  ), { timeout: 30_000 }).toContain(`Original first draft.${edit}`);

  await goToLibrary(page);
  expectFolderUnchanged(second, secondBefore);
});

test("deleting an open folder shows it as unavailable with Locate", async ({ tauriPage: page }) => {
  const folder = fixtures.make(VANISHING, { "main.tex": article("Soon gone.") });
  const before = snapshotFolder(folder);

  await openFolder(page, folder);
  await showSplitView(page);
  await waitForCompileSuccess(page);
  expectFolderUnchanged(folder, before);
  rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });

  const banner = page.locator('[data-testid="folder-unavailable-banner"]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText("This folder isn't available.");
  expect(await page.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[data-testid="folder-unavailable-banner"] button')).map((button) => button.textContent?.trim() ?? "")`,
  )).toContain("Locate…");

  await goToLibrary(page);
  const card = folderCard(VANISHING);
  await expect.poll(async () => page.evaluate<string>(
    `document.querySelector(${scriptValue(card)})?.parentElement?.textContent ?? ""`,
  ), { timeout: 30_000 }).toContain("Folder missing");
  await page.evaluate(`(document.querySelector(${scriptValue(card)}).click(), true)`);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText(`Can't find “${VANISHING}”`);
  expect(await page.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).map((button) => button.textContent?.trim() ?? "")`,
  )).toContain("Locate…");
});
