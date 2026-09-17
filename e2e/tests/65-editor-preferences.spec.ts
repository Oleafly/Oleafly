import { test, expect } from "../fixtures";
import {
  chooseAppSelectOption,
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

async function openEditorAppearanceTab(page: Page) {
  await openSettings(page, "appearance");
  await page.press('[data-testid="appearance-tab-editor"]', "Enter");
  await waitLong(
    page,
    `document.querySelector('[data-testid="appearance-tab-editor"]')?.getAttribute("data-state") === "active"`,
    10_000,
  );
}

async function closeSettings(page: Page) {
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

async function toggleSetting(page: Page, label: string, on: boolean) {
  await openEditorAppearanceTab(page);
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
  await closeSettings(page);
}

async function chooseEditorSetting(page: Page, testId: string, optionLabel: string) {
  await openEditorAppearanceTab(page);
  await chooseAppSelectOption(
    page,
    `[data-testid="${testId}"]`,
    { attribute: "data-label", value: optionLabel },
  );
  await closeSettings(page);
}

async function pressInEditor(
  page: Page,
  key: string,
  code: string,
  keyCode: number,
  mods: { alt?: boolean; ctrl?: boolean; mod?: boolean; shift?: boolean } = {},
) {
  await page.evaluate(
    `(() => {
      const apple = /Mac|iPhone|iPad/.test(navigator.platform);
      const target = document.querySelector('.cm-content');
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: ${JSON.stringify(key)},
        code: ${JSON.stringify(code)},
        keyCode: ${keyCode},
        which: ${keyCode},
        altKey: ${!!mods.alt},
        ctrlKey: ${!!mods.ctrl} || (${!!mods.mod} && !apple),
        metaKey: ${!!mods.mod} && apple,
        shiftKey: ${!!mods.shift},
        bubbles: true,
        cancelable: true,
      }));
      return 1;
    })()`,
  );
}

async function selectInEditor(page: Page, from: number, to: number) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      view.dispatch({ selection: { anchor: ${from}, head: ${to} } });
      view.focus();
      return 1;
    })`,
  );
}

async function caretAt(page: Page, at: number) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      view.dispatch({ selection: { anchor: ${at} } });
      view.focus();
      return 1;
    })`,
  );
}

async function chooseLineHeight(page: Page, optionLabel: string): Promise<number> {
  await chooseEditorSetting(page, "settings-editor-line-height-trigger", optionLabel);
  await waitLong(page, `!!document.querySelector('.cm-line')`, 10_000);
  return page.evaluate<number>(
    `Number.parseFloat(
      getComputedStyle(document.querySelector('.cm-line')).lineHeight,
    )`,
  );
}

async function selectionHead(page: Page): Promise<number> {
  return page.evaluate<number>(
    `import("/src/components/editor/cm/controller.ts").then(
      ({ getEditorView }) => getEditorView().state.selection.main.head,
    )`,
  );
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

  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\left(");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\left(");
  expect(await editorSource(tauriPage)).not.toContain("\\right)");

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

test("semantic delimiter pairing follows the math toggle", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);
  await toggleSetting(tauriPage, "Auto-close brackets", true);
  await toggleSetting(tauriPage, "Auto-close math", true);

  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\left(");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\left(\\right)");

  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\bigl\\{");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\bigl\\{\\bigr\\}");

  await toggleSetting(tauriPage, "Auto-close math", false);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await typeAtCaret(tauriPage, "\\left(");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\left(");
  expect(await editorSource(tauriPage)).not.toContain("\\right)");

  await toggleSetting(tauriPage, "Auto-close math", true);
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

test("the keybinding mode switches between Default, Emacs and Vim", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);

  await chooseEditorSetting(tauriPage, "settings-editor-keymap-trigger", "Emacs");
  await waitLong(
    tauriPage,
    `!!document.querySelector('.cm-scroller.cm-emacsMode')`,
    10_000,
  );
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretAt(tauriPage, 8);
  await pressInEditor(tauriPage, "a", "KeyA", 65, { ctrl: true });
  await expect
    .poll(async () => await selectionHead(tauriPage), { timeout: 10_000 })
    .toBe(0);

  await chooseEditorSetting(tauriPage, "settings-editor-keymap-trigger", "Vim");
  await waitLong(tauriPage, `!!document.querySelector('.cm-vim-panel')`, 10_000);
  expect(
    await tauriPage.evaluate<boolean>(
      `!!document.querySelector('.cm-scroller.cm-emacsMode')`,
    ),
  ).toBe(false);

  await chooseEditorSetting(tauriPage, "settings-editor-keymap-trigger", "Default");
  await settle(tauriPage, 500);
  expect(
    await tauriPage.evaluate<boolean>(
      `!!document.querySelector('.cm-vim-panel') || !!document.querySelector('.cm-scroller.cm-emacsMode')`,
    ),
  ).toBe(false);
});

test("tab size, line wrapping and line height follow their settings", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);

  await chooseEditorSetting(tauriPage, "settings-editor-tab-size-trigger", "2");
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretToEnd(tauriPage);
  await tauriPage.press(".cm-content", "Tab");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("article}\n  ");
  expect(
    await tauriPage.evaluate<number>(
      `import("/src/components/editor/cm/controller.ts").then(
        ({ getEditorView }) => getEditorView().state.tabSize,
      )`,
    ),
  ).toBe(2);

  await toggleSetting(tauriPage, "Wrap long lines", false);
  await expect
    .poll(
      async () =>
        await tauriPage.evaluate<boolean>(
          `!!document.querySelector('.cm-content.cm-lineWrapping')`,
        ),
      { timeout: 10_000 },
    )
    .toBe(false);

  await toggleSetting(tauriPage, "Wrap long lines", true);
  await expect
    .poll(
      async () =>
        await tauriPage.evaluate<boolean>(
          `!!document.querySelector('.cm-content.cm-lineWrapping')`,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  const compact = await chooseLineHeight(tauriPage, "Compact");
  const wide = await chooseLineHeight(tauriPage, "Wide");
  expect(wide).toBeGreaterThan(compact);

  await chooseEditorSetting(tauriPage, "settings-editor-line-height-trigger", "Normal");
  await chooseEditorSetting(tauriPage, "settings-editor-tab-size-trigger", "4");
});

test("the default editor keys run their commands", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);
  await replaceEditorSource(tauriPage, "alpha beta\ngamma delta\n");

  await selectInEditor(tauriPage, 0, 5);
  await pressInEditor(tauriPage, "u", "KeyU", 85, { ctrl: true });
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("ALPHA beta");

  await caretAt(tauriPage, 0);
  await pressInEditor(tauriPage, "D", "KeyD", 68, { mod: true, shift: true });
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("ALPHA beta\nALPHA beta\n");

  await pressInEditor(tauriPage, "d", "KeyD", 68, { mod: true });
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toBe("ALPHA beta\ngamma delta\n");

  await caretAt(tauriPage, 0);
  await pressInEditor(tauriPage, "ArrowDown", "ArrowDown", 40, {
    ctrl: true,
    alt: true,
  });
  await expect
    .poll(
      async () =>
        await tauriPage.evaluate<number>(
          `import("/src/components/editor/cm/controller.ts").then(
            ({ getEditorView }) => getEditorView().state.selection.ranges.length,
          )`,
        ),
      { timeout: 10_000 },
    )
    .toBe(2);

  await caretAt(tauriPage, 0);
  await pressInEditor(tauriPage, "L", "KeyL", 76, { mod: true, shift: true });
  await waitLong(
    tauriPage,
    `!!document.querySelector('.cm-dialog input[name="line"]')`,
    10_000,
  );
  await tauriPage.press(".cm-content", "Escape");
});

test("Mod-slash comments the line instead of opening the shortcut reference", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretAt(tauriPage, 3);

  await pressInEditor(tauriPage, "/", "Slash", 191, { mod: true });
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("% \\documentclass{article}");
  await settle(tauriPage, 1_000);
  expect(
    await tauriPage.evaluate<boolean>(
      `!!document.querySelector('[aria-labelledby="hotkeys-title"]')`,
    ),
  ).toBe(false);

  await pressInEditor(tauriPage, "/", "Slash", 191, { mod: true });
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toBe("\\documentclass{article}\n");
});

test("remapping an editor key takes effect without a reload", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openPrefsProject(tauriPage);

  await openSettings(tauriPage, "shortcuts");
  await tauriPage.press('[data-testid="shortcuts-tab-editor"]', "Enter");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="editor-key-row-deleteLine"]')`,
    10_000,
  );
  await tauriPage.evaluate(
    `(() => {
      const row = document.querySelector('[data-testid="editor-key-row-deleteLine"]');
      const trigger = [...row.querySelectorAll('button')].find(
        (button) => (button.getAttribute('aria-label') ?? '').startsWith('Edit '),
      );
      trigger.click();
      return 1;
    })()`,
  );
  await tauriPage.evaluate(
    `(() => {
      const apple = /Mac|iPhone|iPad/.test(navigator.platform);
      const row = document.querySelector('[data-testid="editor-key-row-deleteLine"]');
      const recording = [...row.querySelectorAll('button')].find(
        (button) => (button.getAttribute('aria-label') ?? '').startsWith('Recording '),
      );
      recording.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'K',
        code: 'KeyK',
        keyCode: 75,
        which: 75,
        ctrlKey: !apple,
        metaKey: apple,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
      return 1;
    })()`,
  );
  await waitLong(
    tauriPage,
    `JSON.parse(localStorage.getItem("oleafly.editorKeymap") ?? "{}").deleteLine === "Mod-Shift-k"`,
    10_000,
  );
  await closeSettings(tauriPage);

  await replaceEditorSource(tauriPage, "alpha\nbeta\n");
  await caretAt(tauriPage, 0);
  await pressInEditor(tauriPage, "K", "KeyK", 75, { mod: true, shift: true });
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toBe("beta\n");

  await tauriPage.evaluate(
    `import("/src/store/editor-keymap.ts").then((m) => {
      m.useEditorKeymapStore.getState().resetAll();
      return 1;
    })`,
  );
});

