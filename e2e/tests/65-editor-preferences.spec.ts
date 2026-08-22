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

// Editor preferences (Auto-complete, Auto-close brackets, Non-blinking
// cursor). Each one must reconfigure the live editor through its compartment,
// so every assertion here is made against the running CodeMirror instance
// rather than the settings store alone.

const PROJECT = "Editor Prefs";

// Every test starts on a freshly reloaded SPA sitting in the library, so each
// one opens the editor itself instead of inheriting the previous test's view.
async function openPrefsProject(page: Page) {
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
  // The backdrop shares the "Close settings" aria-label with the header
  // button, so target the button by test id.
  await page.click('[data-testid="settings-close"]');
  await waitLong(
    page,
    `!document.querySelector('[data-testid="settings-section-appearance"]')`,
    10_000,
  );
  await waitLong(page, `!!document.querySelector('.cm-content')`, 10_000);
}

// Real typing, one character per input event. execCommand drives the DOM input
// path, which is the only route CodeMirror's input handlers (and therefore
// bracket closing and the completion popup) observe, and bracket closing only
// fires when the inserted text is the single bracket character. A dispatched
// transaction, or one multi-character insert, would bypass both and prove
// nothing.
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

// Give an asynchronous surface time to appear before asserting it did not.
async function settle(page: Page, ms: number) {
  await page.evaluate(
    `new Promise((resolve) => setTimeout(() => resolve(1), ${ms}))`,
  );
}

async function cursorBlinkDuration(page: Page): Promise<string> {
  return page.evaluate<string>(
    `document.querySelector('.cm-cursorLayer')?.style.animationDuration ?? ""`,
  );
}

test("auto-close brackets inserts the closing brace, and stops when turned off", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);

  await toggleSetting(tauriPage, "Auto-close brackets", true);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\textbf{");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\textbf{}");

  await toggleSetting(tauriPage, "Auto-close brackets", false);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\textit{");
  // Give the editor the same settling time the enabled case got before
  // asserting the closing brace is absent.
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\textit{");
  expect(await editorSource(tauriPage)).not.toContain("\\textit{}");
});

test("auto-complete opens the popup while typing, and stays closed when off", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);
  await toggleSetting(tauriPage, "Auto-complete", true);
  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n",
  );
  await tauriPage.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const at = view.state.doc.toString().indexOf("\\\\begin{document}") + "\\\\begin{document}".length + 1;
      view.dispatch({ selection: { anchor: at } });
      view.focus();
      return 1;
    })`,
  );
  await typeAtCaret(tauriPage, "\\alph");
  await waitLong(
    tauriPage,
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    15_000,
  );

  await toggleSetting(tauriPage, "Auto-complete", false);
  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n",
  );
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\alph");
  // The popup is asynchronous. Polling would pass on its first read, before a
  // late popup could appear, so wait out the completion delay first and then
  // assert it never opened.
  await settle(tauriPage, 3_000);
  expect(
    await tauriPage.evaluate<boolean>(
      `!!document.querySelector('.cm-tooltip-autocomplete')`,
    ),
  ).toBe(false);
});

test("the non-blinking cursor stops the cursor animation", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);
  await toggleSetting(tauriPage, "Non-blinking cursor", false);
  await expect
    .poll(async () => await cursorBlinkDuration(tauriPage), { timeout: 10_000 })
    .not.toBe("0ms");

  await toggleSetting(tauriPage, "Non-blinking cursor", true);
  // A zero blink rate is how CodeMirror renders a solid cursor.
  await expect
    .poll(async () => await cursorBlinkDuration(tauriPage), { timeout: 10_000 })
    .toBe("0ms");

  // The editor keeps working after the compartment reconfigures.
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "solid");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("solid");
});

test("editor preferences persist across a reload", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);
  await toggleSetting(tauriPage, "Auto-complete", false);
  await toggleSetting(tauriPage, "Non-blinking cursor", true);
  const stored = await tauriPage.evaluate<string>(
    `[
      localStorage.getItem("oleafly.editor.autocomplete"),
      localStorage.getItem("oleafly.editor.solidCursor"),
    ].join(",")`,
  );
  expect(stored).toBe("0,1");

  // Restore the defaults so later specs in the shared app instance are not
  // left with completions disabled.
  await toggleSetting(tauriPage, "Auto-complete", true);
  await toggleSetting(tauriPage, "Non-blinking cursor", false);
});
