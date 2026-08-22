import { test, expect } from "../fixtures";
import {
  createBlankProject,
  editorSource,
  openProject,
  openSettings,
  replaceEditorSource,
  waitLong,
  type Page,
} from "../helpers";

// Inline ghost completion in the real editor: a dim preview of the top
// candidate after the cursor, accepted with Tab. The suggestion comes from the
// completion sources the popup already uses, so this spec drives real typing
// against the real LaTeX corpus rather than a stub.

const PROJECT = "Ghost Completion";
const GHOST = ".cm-ghostCompletion";

async function openGhostProject(page: Page) {
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  const exists = await page.evaluate<boolean>(
    `import("/src/store/files.ts").then((m) =>
      m.useFilesStore.getState().projects.some((p) => p.name === ${JSON.stringify(PROJECT)}))`,
  );
  if (exists) {
    await openProject(page, PROJECT);
  } else {
    await createBlankProject(page, PROJECT);
  }
  await waitLong(page, `!!document.querySelector('.cm-content')`, 30_000);
}

async function toggleSetting(page: Page, label: string, on: boolean) {
  await openSettings(page, "appearance");
  await page.press('[data-testid="appearance-tab-editor"]', "Enter");
  await waitLong(
    page,
    `document.querySelector('[data-testid="appearance-tab-editor"]')?.getAttribute("data-state") === "active"`,
    10_000,
  );
  const selector = `[role="switch"][aria-label="${label}"]`;
  await waitLong(page, `!!document.querySelector('${selector}')`, 10_000);
  const already = await page.evaluate<boolean>(
    `document.querySelector('${selector}')?.getAttribute("aria-checked") === "true"`,
  );
  if (already !== on) {
    await page.click(selector);
    await waitLong(
      page,
      `document.querySelector('${selector}')?.getAttribute("aria-checked") === "${on}"`,
      10_000,
    );
  }
  await page.click('[data-testid="settings-close"]');
  await waitLong(page, `!!document.querySelector('.cm-content')`, 10_000);
}

// One character per input event, the only path CodeMirror's input handling
// observes.
async function typeAtCaret(page: Page, text: string) {
  for (const character of text) {
    const ok = await page.evaluate<boolean>(
      `(() => {
        const content = document.querySelector('.cm-content');
        if (!content) return false;
        content.focus();
        return document.execCommand('insertText', false, ${JSON.stringify(character)});
      })()`,
    );
    if (!ok) throw new Error(`typeAtCaret: editor rejected ${character}`);
  }
}

async function caretToEnd(page: Page) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
      return 1;
    })`,
  );
}

async function ghostText(page: Page): Promise<string> {
  return page.evaluate<string>(
    `document.querySelector('${GHOST}')?.textContent ?? ""`,
  );
}

// Tab reaches the editor only as a real key event; the ghost binding sits in
// the keymap ahead of indentWithTab.
async function pressTab(page: Page) {
  await page.evaluate(
    `(() => {
      const content = document.querySelector('.cm-content');
      content.focus();
      content.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', code: 'Tab', bubbles: true, cancelable: true,
      }));
      return 1;
    })()`,
  );
}

async function settle(page: Page, ms: number) {
  await page.evaluate(
    `new Promise((resolve) => setTimeout(() => resolve(1), ${ms}))`,
  );
}

async function startDocument(page: Page) {
  await replaceEditorSource(
    page,
    "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n",
  );
  // Type on the blank line inside the document body.
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const marker = "\\\\begin{document}";
      const at = view.state.doc.toString().indexOf(marker) + marker.length + 1;
      view.dispatch({ selection: { anchor: at } });
      view.focus();
      return 1;
    })`,
  );
}

test("a dim suggestion appears while typing a command", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", true);
  await startDocument(tauriPage);

  await typeAtCaret(tauriPage, "\\alph");
  await waitLong(tauriPage, `!!document.querySelector('${GHOST}')`, 15_000);
  const suggestion = await ghostText(tauriPage);
  expect(suggestion.length).toBeGreaterThan(0);
  // The preview is the remainder only: it never repeats what was typed.
  expect(suggestion.startsWith("\\")).toBe(false);
  expect(`\\alph${suggestion}`.startsWith("\\alph")).toBe(true);
});

test("Tab accepts the suggestion into the document", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", true);
  await startDocument(tauriPage);

  await typeAtCaret(tauriPage, "\\alph");
  await waitLong(tauriPage, `!!document.querySelector('${GHOST}')`, 15_000);
  const suggestion = await ghostText(tauriPage);
  await pressTab(tauriPage);

  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain(`\\alph${suggestion}`);
  // Accepting consumes the preview.
  expect(await ghostText(tauriPage)).toBe("");
});

test("Escape dismisses the suggestion and leaves the text alone", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", true);
  await startDocument(tauriPage);

  await typeAtCaret(tauriPage, "\\alph");
  await waitLong(tauriPage, `!!document.querySelector('${GHOST}')`, 15_000);
  await tauriPage.evaluate(
    `(() => {
      const content = document.querySelector('.cm-content');
      content.focus();
      content.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
      return 1;
    })()`,
  );
  await waitLong(tauriPage, `!document.querySelector('${GHOST}')`, 10_000);
  expect(await editorSource(tauriPage)).toContain("\\alph");
  expect(await editorSource(tauriPage)).not.toContain("\\alpha ");
});

test("no suggestion appears when the preference is off", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", false);
  await startDocument(tauriPage);

  await typeAtCaret(tauriPage, "\\alph");
  // The widget is asynchronous, so wait out the window in which it would have
  // appeared before asserting that it never did.
  await settle(tauriPage, 3_000);
  expect(await ghostText(tauriPage)).toBe("");

  // With the preference off, Tab is the editor's own indent again.
  const before = await editorSource(tauriPage);
  await pressTab(tauriPage);
  await settle(tauriPage, 500);
  expect(await editorSource(tauriPage)).not.toBe(`${before}alpha`);
});

test("the preference persists and stays out of the way of plain typing", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", true);
  expect(
    await tauriPage.evaluate<string | null>(
      `localStorage.getItem("oleafly.editor.ghostCompletion")`,
    ),
  ).toBe("1");

  await startDocument(tauriPage);
  // Ordinary prose must not attract a suggestion on every short word.
  await typeAtCaret(tauriPage, "Hi ");
  await settle(tauriPage, 1_500);
  expect(await ghostText(tauriPage)).toBe("");
  await caretToEnd(tauriPage);
});
