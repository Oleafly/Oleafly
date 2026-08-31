import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "../fixtures";
import {
  compileAndProbe,
  createBlankProject,
  listProjectEntries,
  openProject,
  openRailTab,
  pressGlobal,
  readProjectBase64,
  readProjectText,
  replaceEditorSource,
  setNextImportPaths,
  type Page,
} from "../helpers";

async function openRowAction(page: Page, path: string, action: string) {
  const opened = await page.evaluate<boolean>(
    `(() => {
      const row = document.querySelector(
        '[aria-label="Source tree"] [data-path=' + CSS.escape(${JSON.stringify(path)}) + ']'
      );
      if (!row) return false;
      const expected = ${JSON.stringify(`More actions for ${path.split("/").pop()}`)};
      const button = Array.from(row.querySelectorAll('button')).find(
        candidate => candidate.getAttribute('aria-label') === expected
      );
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`,
  );
  expect(opened).toBe(true);
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).some(item => {
      const rect = item.getBoundingClientRect();
      return item.textContent?.trim() === ${JSON.stringify(action)} && rect.width > 0 && rect.height > 0;
    })`,
    10_000,
  );
  const pressed = await page.evaluate<boolean>(
    `(() => {
      const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return candidate.textContent?.trim() === ${JSON.stringify(action)} &&
          rect.width > 0 && rect.height > 0;
      });
      if (!(item instanceof HTMLElement)) return false;
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      };
      item.dispatchEvent(new PointerEvent("pointerdown", init));
      item.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
      item.click();
      return true;
    })()`,
  );
  expect(pressed).toBe(true);
  // Radix closes on real pointer selection; the synthetic sequence sometimes
  // leaves the menu open even though the action ran, so nudge it shut.
  const closed = await page
    .waitForFunction(
      `!document.querySelector('[role="menu"][data-state="open"]')`,
      2_000,
    )
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    await page.press("body", "Escape");
    await page.waitForFunction(
      `!document.querySelector('[role="menu"][data-state="open"]')`,
      5_000,
    );
  }
}

async function createEntry(
  page: Page,
  name: string,
  mode: "file" | "dir",
  parent?: string,
) {
  const placeholder = mode === "file" ? "New file name" : "New folder name";
  const destination = parent ? `folder ${parent}` : "project root";
  const inputLabel = `New ${mode === "file" ? "file" : "folder"} name in ${destination}`;
  // The tree refresh that follows a preceding import/create re-renders the
  // toolbar and rows, which can swallow the opening click or unmount the
  // inline input between its appearance and the commit. Reopen and retry
  // until the value-plus-Enter commit actually lands on a live input.
  const commitDeadline = Date.now() + 30_000;
  for (;;) {
    if (parent) {
      await openRowAction(page, parent, mode === "file" ? "New file" : "New folder");
    } else {
      await page.click(
        mode === "file"
          ? '[title="New file (in the selected folder)"]'
          : '[title="New folder (in the selected folder)"]',
      );
    }
    const appeared = await page
      .waitForFunction(
        `Array.from(document.querySelectorAll('label')).some(label =>
          label.textContent?.trim() === ${JSON.stringify(inputLabel)} &&
          label.control instanceof HTMLInputElement
        )`,
        5_000,
      )
      .then(() => true)
      .catch(() => false);
    const committed =
      appeared &&
      (await page.evaluate<boolean>(
        `(() => {
          const label = Array.from(document.querySelectorAll('label')).find(
            candidate => candidate.textContent?.trim() === ${JSON.stringify(inputLabel)}
          );
          const input = label instanceof HTMLLabelElement ? label.control : null;
          if (!(input instanceof HTMLInputElement)) return false;
          const set = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, "value"
          )?.set;
          set?.call(input, ${JSON.stringify(name)});
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", bubbles: true
          }));
          return true;
        })()`,
      ));
    if (committed) break;
    await page.evaluate(
      `document.querySelector('input[placeholder=${JSON.stringify(placeholder)}]')?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )`,
    );
    if (Date.now() > commitDeadline) {
      throw new Error(`createEntry(${name}): the inline input never committed`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const path = parent ? `${parent}/${name}` : name;
  const deadline = Date.now() + 15_000;
  let backendPaths: string[] = [];
  for (;;) {
    backendPaths = (await listProjectEntries(page)).map((entry) => entry.path);
    if (backendPaths.includes(path)) break;
    if (Date.now() > deadline) {
      throw new Error(
        `backend did not create ${path}; entries=${JSON.stringify(backendPaths)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await page.waitForFunction(
    `Array.from(document.querySelectorAll(
      '[aria-label="Source tree"] [data-path]'
    )).some(row => row.dataset.path === ${JSON.stringify(path)})`,
    30_000,
  );
  if (mode === "file") {
    // The tree row appearing does NOT mean the new file is the one that edits
    // and saves will land on. Three things carry a notion of "current file" and
    // they settle independently:
    //
    //   - the editor controller's document path (the CodeMirror swap),
    //   - the files store's `activePath`.
    //
    // `replaceEditorSource` writes through the shared view, while the update
    // listener attributes that text with `host.getActivePath()` and `saveActive`
    // saves `activePath`. Waiting on the controller alone is not enough: if the
    // store still points at the previous file, the fixture is stored against it
    // and the new file is saved empty - which is the "content was not persisted"
    // failure. Wait for both.
    await page.waitForFunction(
      `import("/packages/editor/src/controller.ts").then(
        ({ getEditorDocumentPath }) => getEditorDocumentPath() === ${JSON.stringify(path)},
      )`,
      30_000,
    );
    await page.waitForFunction(
      `import("/src/store/files.ts").then(
        ({ useFilesStore }) => useFilesStore.getState().activePath === ${JSON.stringify(path)},
      )`,
      30_000,
    );
  }
  return path;
}

async function renameEntry(page: Page, from: string, toName: string) {
  await openRowAction(page, from, "Rename");
  const committed = await page.evaluate<boolean>(
    `(() => {
      const input = document.querySelector('[aria-label="Rename file"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value"
      )?.set;
      set?.call(input, ${JSON.stringify(toName)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true
      }));
      return true;
    })()`,
  );
  expect(committed).toBe(true);
}

async function saveEditor(page: Page, expectedPath: string, expected: string) {
  // CodeMirror's editor->store sync is suppressed while the component swaps
  // documents (`suppressSyncRef`, released in a queueMicrotask), so a fixture
  // dispatched inside that window never reaches the store - and Cmd+S then
  // saves the file's original, empty content. Waiting on the active path is not
  // enough because the path is set before the swap finishes. Confirm the store
  // actually holds the text, re-applying through the view if it does not, and
  // only then save.
  const stored = `import("/src/store/files.ts").then(
    ({ useFilesStore }) =>
      useFilesStore.getState().files[${JSON.stringify(expectedPath)}]?.content ===
      ${JSON.stringify(expected)},
  )`;
  const syncDeadline = Date.now() + 15_000;
  for (;;) {
    if (await page.evaluate<boolean>(stored)) break;
    if (Date.now() > syncDeadline) {
      throw new Error(`editor content never reached the store for ${expectedPath}`);
    }
    await page.evaluate(
      `import("/packages/editor/src/controller.ts").then(({ getEditorView }) => {
        const view = getEditorView();
        if (!view) return false;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(expected)} },
          userEvent: "input.e2e-fixture",
        });
        return true;
      })`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  await pressGlobal(page, "s", { meta: true });
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await readProjectText(page, expectedPath)) === expected) return;
    } catch {
      // The file-tree refresh can briefly race the first backend read.
    }
    if (Date.now() > deadline) {
      throw new Error(`editor content was not persisted to ${expectedPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function waitForBackendPath(page: Page, path: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const paths = (await listProjectEntries(page)).map((entry) => entry.path);
    if (paths.includes(path)) return;
    if (Date.now() > deadline) {
      throw new Error(`backend path missing ${path}; entries=${JSON.stringify(paths)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function expandFolderPath(page: Page, path: string) {
  const parts = path.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const prefix = parts.slice(0, index).join("/");
    await page.waitForFunction(
      `Array.from(document.querySelectorAll(
        '[aria-label="Source tree"] [data-path]'
      )).some(row => row.dataset.path === ${JSON.stringify(prefix)})`,
      15_000,
    );
    await page.evaluate(
      `(() => {
        const row = Array.from(document.querySelectorAll(
          '[aria-label="Source tree"] [data-path]'
        )).find(candidate => candidate.dataset.path === ${JSON.stringify(prefix)});
        if (row?.getAttribute("aria-expanded") === "false") row.click();
        return true;
      })()`,
    );
  }
}

test("real row menus cover nested create/rename/copy/main/delete and reopen persistence", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  const run = Date.now().toString(36);
  const projectName = `E2E tree production ${run}`;
  const marker = `FILE TREE PDF MARKER ${run}`;
  const tex = String.raw`\documentclass{article}
\begin{document}
${marker}
\end{document}
`;

  await createBlankProject(tauriPage, projectName);
  await openRailTab(tauriPage, "Source Tree");

  const folder = await createEntry(tauriPage, `workspace-${run}`, "dir");
  const rootFile = await createEntry(tauriPage, `root-${run}.tex`, "file");
  await replaceEditorSource(tauriPage, `% root fallback fixture ${run}\n`);
  await saveEditor(tauriPage, rootFile, `% root fallback fixture ${run}\n`);

  const subfolder = await createEntry(tauriPage, "chapters", "dir", folder);
  const chapter = await createEntry(tauriPage, "chapter.tex", "file", subfolder);
  await replaceEditorSource(tauriPage, tex);
  await saveEditor(tauriPage, chapter, tex);

  const renamedFolder = `archive-${run}`;
  await renameEntry(tauriPage, folder, renamedFolder);
  const renamedChapterBefore = `${renamedFolder}/chapters/chapter.tex`;
  await waitForBackendPath(tauriPage, renamedChapterBefore);
  await expandFolderPath(tauriPage, `${renamedFolder}/chapters`);
  await renameEntry(tauriPage, renamedChapterBefore, "paper.tex");
  const mainPath = `${renamedFolder}/chapters/paper.tex`;
  await waitForBackendPath(tauriPage, mainPath);

  await openRowAction(tauriPage, renamedFolder, "Make a copy");
  const copiedFolder = `${renamedFolder} copy`;
  const copiedMain = `${copiedFolder}/chapters/paper.tex`;
  await waitForBackendPath(tauriPage, copiedMain);
  expect(await readProjectText(tauriPage, copiedMain)).toBe(tex);

  await openRowAction(tauriPage, mainPath, "Set as main document");
  await tauriPage.waitForFunction(
    `document.querySelector('[data-path=' +
      CSS.escape(${JSON.stringify(mainPath)}) +
      ']')?.dataset.mainDocument === "true"`,
    15_000,
  );
  const probe = await compileAndProbe(tauriPage, 150_000);
  expect(probe.text).toContain(marker);

  // Deleting the active root file must activate the most recently used
  // surviving tab (the new main document), not leave an empty editor.
  await tauriPage.click(
    `[aria-label="Source tree"] [data-path=${JSON.stringify(rootFile)}]`,
  );
  await tauriPage.evaluate(
    `(window.confirm = message =>
      typeof message === "string" && message.includes(${JSON.stringify(rootFile)}), true)`,
  );
  await openRowAction(tauriPage, rootFile, "Delete");
  await tauriPage.waitForFunction(
    `document.querySelector('[data-path=' +
      CSS.escape(${JSON.stringify(mainPath)}) +
      ']')?.getAttribute("aria-selected") === "true"`,
    30_000,
  );
  expect(await tauriPage.evaluate<string>(
    `document.querySelector(".cm-content")?.textContent ?? ""`,
  )).toContain(marker);

  await tauriPage.evaluate(
    `(window.confirm = message =>
      typeof message === "string" && message.includes(${JSON.stringify(copiedFolder)}), true)`,
  );
  await openRowAction(tauriPage, copiedFolder, "Delete");
  await tauriPage.waitForFunction(
    `!document.querySelector('[data-path=' +
      CSS.escape(${JSON.stringify(copiedFolder)}) + ']')`,
    15_000,
  );

  await openProject(tauriPage, projectName);
  await openRailTab(tauriPage, "Source Tree");
  await expandFolderPath(tauriPage, `${renamedFolder}/chapters`);
  const entries = await listProjectEntries(tauriPage);
  const paths = entries.map((entry) => entry.path);
  expect(paths).toContain(mainPath);
  expect(paths).not.toContain(rootFile);
  expect(paths.some((path) => path === copiedFolder || path.startsWith(`${copiedFolder}/`))).toBe(
    false,
  );
  expect(await readProjectText(tauriPage, mainPath)).toBe(tex);
  await tauriPage.waitForFunction(
    `document.querySelector('[data-path=' +
      CSS.escape(${JSON.stringify(mainPath)}) +
      ']')?.dataset.mainDocument === "true"`,
    15_000,
  );
});

test("real import actions copy exact files and recursive folders into exact destinations", async ({
  tauriPage,
}) => {
  const run = Date.now().toString(36);
  const projectName = `E2E exact import ${run}`;
  const fixtureRoot = mkdtempSync(join(tmpdir(), "oleafly-import-e2e-"));
  const rootTextPath = join(fixtureRoot, `root-${run}.txt`);
  const rowBinaryPath = join(fixtureRoot, `row-${run}.bin`);
  const sourceFolder = join(fixtureRoot, `recursive-${run}`);
  const nestedFolder = join(sourceFolder, "nested");
  const rootText = Buffer.from(`exact imported text ${run}\n`, "utf8");
  const rowBinary = Buffer.from([0, 1, 2, 127, 128, 254, 255, 42]);
  const nestedText = Buffer.from(`recursive marker ${run}\n`, "utf8");
  const nestedBinary = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6]);
  mkdirSync(nestedFolder, { recursive: true });
  writeFileSync(rootTextPath, rootText);
  writeFileSync(rowBinaryPath, rowBinary);
  writeFileSync(join(sourceFolder, "README.txt"), nestedText);
  writeFileSync(join(nestedFolder, "payload.bin"), nestedBinary);

  await createBlankProject(tauriPage, projectName);
  await openRailTab(tauriPage, "Source Tree");

  await setNextImportPaths(tauriPage, [rootTextPath]);
  await tauriPage.focus('[title="Import a file or folder (into the selected folder)"]');
  await tauriPage.press(
    '[title="Import a file or folder (into the selected folder)"]',
    "Enter",
  );
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).some(
      item => item.textContent?.trim() === "Import file(s)"
    )`,
    10_000,
  );
  await tauriPage.getByText("Import file(s)", { exact: true }).click();
  const rootDest = `root-${run}.txt`;
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-path=' +
      CSS.escape(${JSON.stringify(rootDest)}) + ']')`,
    20_000,
  );

  const destination = await createEntry(tauriPage, `imports-${run}`, "dir");
  await setNextImportPaths(tauriPage, [rowBinaryPath]);
  await openRowAction(tauriPage, destination, "Import file(s)");
  const rowDest = `${destination}/row-${run}.bin`;
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-path=' +
      CSS.escape(${JSON.stringify(rowDest)}) + ']')`,
    20_000,
  );

  await setNextImportPaths(tauriPage, [sourceFolder]);
  await openRowAction(tauriPage, destination, "Import folder");
  const recursiveRoot = `${destination}/recursive-${run}`;
  const recursiveTextDest = `${recursiveRoot}/README.txt`;
  const recursiveBinaryDest = `${recursiveRoot}/nested/payload.bin`;
  const recursiveDeadline = Date.now() + 20_000;
  for (;;) {
    const paths = (await listProjectEntries(tauriPage)).map((entry) => entry.path);
    if (paths.includes(recursiveBinaryDest)) break;
    if (Date.now() > recursiveDeadline) {
      throw new Error(
        `recursive import missing ${recursiveBinaryDest}; entries=${JSON.stringify(paths)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  expect(await readProjectBase64(tauriPage, rootDest)).toBe(rootText.toString("base64"));
  expect(await readProjectBase64(tauriPage, rowDest)).toBe(rowBinary.toString("base64"));
  expect(await readProjectBase64(tauriPage, recursiveTextDest)).toBe(
    nestedText.toString("base64"),
  );
  expect(await readProjectBase64(tauriPage, recursiveBinaryDest)).toBe(
    nestedBinary.toString("base64"),
  );
  expect(
    await tauriPage.evaluate<number>(
      `window.__e2eFileDialogState?.openRequests ?? 0`,
    ),
  ).toBeGreaterThanOrEqual(3);

  await openProject(tauriPage, projectName);
  const reopened = (await listProjectEntries(tauriPage)).map((entry) => entry.path);
  expect(reopened).toEqual(expect.arrayContaining([
    rootDest,
    rowDest,
    recursiveTextDest,
    recursiveBinaryDest,
  ]));
  expect(await readProjectBase64(tauriPage, recursiveBinaryDest)).toBe(
    nestedBinary.toString("base64"),
  );
});
