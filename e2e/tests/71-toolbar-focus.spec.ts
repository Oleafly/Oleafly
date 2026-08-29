import { test, expect } from "../fixtures";
import {
  editorSource,
  openProject,
  readProjectText,
  typeInEditorAtStart,
  waitEditorShowsFile,
  waitLong,
} from "../helpers";

type Page = Parameters<typeof openProject>[0];

const PROBE_LINE = "% toolbar-focus-probe\n";

const FOCUS_IS_IN_EDITOR = `(() => {
  const el = document.activeElement;
  return !!(el && el.closest && el.closest(".cm-editor"));
})()`;

const COMPILE_REVISION = `(() => {
  const button = document.querySelector('[data-testid="compile-button"]');
  return Number(button?.dataset.e2eCompileRevision ?? "0");
})()`;

// Chromium (WebView2 on Windows) focuses a <button> on mousedown unless the
// page prevents the default; WebKit (macOS, Linux) never focuses one. Driving
// both halves here makes the guard mean the same thing on every runner.
function chromiumStyleClick(selector: string): string {
  return `(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!(button instanceof HTMLElement)) return "missing";
    const focusable = button.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    if (focusable) button.focus();
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    button.click();
    return focusable ? "took-focus" : "kept-focus";
  })()`;
}

function pressUndo(page: Page, mod: "ctrl" | "meta") {
  return page.evaluate<boolean>(`(() => {
    const target = document.activeElement ?? document.body;
    return target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      keyCode: 90,
      which: 90,
      ctrlKey: ${mod === "ctrl"},
      metaKey: ${mod === "meta"},
      bubbles: true,
      cancelable: true,
      composed: true,
    }));
  })()`);
}

async function openWithCaretInEditor(page: Page) {
  await openProject(page, "E2E Doc");
  await waitEditorShowsFile(page, "main.tex");
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      getEditorView()?.focus();
      return true;
    })`,
  );
  await waitLong(page, FOCUS_IS_IN_EDITOR, 15_000);
}

async function restoreMainDoc(page: Page, baseline: string) {
  await page.evaluate(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().saveActive())`,
  );
  await waitLong(
    page,
    `import("/src/store/files.ts").then(({ useFilesStore }) => !useFilesStore.getState().files["main.tex"]?.dirty)`,
    20_000,
  );
  expect(await readProjectText(page, "main.tex")).toBe(baseline);
}

test("compiling from the toolbar leaves keyboard undo reachable", async ({ tauriPage }) => {
  await openWithCaretInEditor(tauriPage);

  const baseline = await editorSource(tauriPage);
  await typeInEditorAtStart(tauriPage, PROBE_LINE);
  expect(await editorSource(tauriPage)).not.toBe(baseline);
  expect(await tauriPage.evaluate<boolean>(FOCUS_IS_IN_EDITOR)).toBe(true);

  const revisionBefore = await tauriPage.evaluate<number>(COMPILE_REVISION);
  expect(
    await tauriPage.evaluate<string>(
      chromiumStyleClick('[data-testid="compile-button"]'),
    ),
  ).toBe("kept-focus");

  // The compile button disables itself while the build runs, and a disabled
  // element that holds focus hands it to <body>. Undo lives only in
  // CodeMirror's keymap, so the caret has to survive the whole compile.
  await waitLong(tauriPage, `${COMPILE_REVISION} > ${revisionBefore}`, 240_000);
  expect(await tauriPage.evaluate<boolean>(FOCUS_IS_IN_EDITOR)).toBe(true);

  await pressUndo(tauriPage, "meta");
  await pressUndo(tauriPage, "ctrl");
  expect(await editorSource(tauriPage)).toBe(baseline);

  await restoreMainDoc(tauriPage, baseline);
});

test("editor toolbar buttons keep the caret in the editor", async ({ tauriPage }) => {
  await openWithCaretInEditor(tauriPage);

  const baseline = await editorSource(tauriPage);
  await typeInEditorAtStart(tauriPage, PROBE_LINE);
  expect(await editorSource(tauriPage)).not.toBe(baseline);

  expect(
    await tauriPage.evaluate<string>(
      chromiumStyleClick('[data-testid="editor-toolbar"] [aria-label^="Undo"]'),
    ),
  ).toBe("kept-focus");
  expect(await tauriPage.evaluate<boolean>(FOCUS_IS_IN_EDITOR)).toBe(true);
  expect(await editorSource(tauriPage)).toBe(baseline);

  await restoreMainDoc(tauriPage, baseline);
});
