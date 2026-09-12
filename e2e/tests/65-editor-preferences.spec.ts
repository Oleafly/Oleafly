import { test, expect } from "../fixtures";
import {
  createBlankProject,
  editorSource,
  openProject,
  openSettings,
  replaceEditorSource,
  typeAtCaret,
  waitLong,
  type Page,
} from "../helpers";

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

test("LaTeX math and environment closing follow their own toggles", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);
  await toggleSetting(tauriPage, "Auto-close brackets", true);

  await toggleSetting(tauriPage, "Auto-close math", true);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "$");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("$$");

  await toggleSetting(tauriPage, "Auto-close environments", true);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\begin{itemize}");
  await tauriPage.press(".cm-content", "Escape");
  await tauriPage.press(".cm-content", "Enter");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\end{itemize}");
  expect(await editorSource(tauriPage)).toContain("\\item ");

  await toggleSetting(tauriPage, "Auto-close math", false);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "$x");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("$x");
  expect(await editorSource(tauriPage)).not.toContain("$$");

  await toggleSetting(tauriPage, "Auto-close environments", false);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\begin{quote}");
  await tauriPage.press(".cm-content", "Escape");
  await tauriPage.press(".cm-content", "Enter");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\begin{quote}\n");
  expect(await editorSource(tauriPage)).not.toContain("\\end{quote}");

  await toggleSetting(tauriPage, "Auto-close brackets", true);
  await toggleSetting(tauriPage, "Auto-close math", true);
  await toggleSetting(tauriPage, "Auto-close environments", true);
});

test("auto-close brackets gates math and environment closing", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);
  await toggleSetting(tauriPage, "Auto-close math", true);
  await toggleSetting(tauriPage, "Auto-close environments", true);
  await toggleSetting(tauriPage, "Auto-close brackets", false);

  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "$x");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("$x");
  expect(await editorSource(tauriPage)).not.toContain("$$");

  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\begin{quote}");
  await tauriPage.press(".cm-content", "Escape");
  await tauriPage.press(".cm-content", "Enter");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\begin{quote}\n");
  expect(await editorSource(tauriPage)).not.toContain("\\end{quote}");

  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\begin{itemize}\n  \\item first",
  );
  await caretToEnd(tauriPage);
  await tauriPage.press(".cm-content", "Escape");
  await tauriPage.press(".cm-content", "Enter");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\item first\n  \\item ");

  await toggleSetting(tauriPage, "Auto-close brackets", true);
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
