import { test, expect } from "../fixtures";
import {
  compileAndWait,
  createBlankProject,
  editorSource,
  expectCompiledPdfContains,
  openProject,
  replaceEditorSource,
  typeAtCaret,
  waitLong,
  type Page,
} from "../helpers";

// Semantic delimiter pairing and completion against the real editor: the
// production extension set, real input events, the real corpus, and the real
// completion popup. Unit tests cover the registry; what only the app can show
// is that pairing wins over the generic bracket handler, that Enter on a
// dropdown entry inserts both halves, and that what the editor writes compiles.

const PROJECT = "Delimiters";

const PREAMBLE = "\\documentclass{article}\n\\usepackage{amsmath}\n";

async function openDelimiterProject(page: Page) {
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
  await ensureAutoClose(page);
}

// Reset to a known preamble and park the caret at the end, so each probe types
// into the same state no matter what the previous one left behind.
async function seed(page: Page, source = PREAMBLE) {
  await replaceEditorSource(page, source);
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
      return 1;
    })`,
  );
}

async function caretAfter(page: Page, needle: string) {
  const placed = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const at = view.state.doc.toString().indexOf(${JSON.stringify(needle)});
      if (at < 0) return false;
      view.dispatch({ selection: { anchor: at + ${needle.length} } });
      view.focus();
      return true;
    })`,
  );
  if (!placed) throw new Error(`caretAfter: no ${needle} in the document`);
}

async function caretOffset(page: Page): Promise<number> {
  return page.evaluate<number>(
    `import("/src/components/editor/cm/controller.ts").then(
      ({ getEditorView }) => getEditorView().state.selection.main.head
    )`,
  );
}

// Typed after the preamble, so the assertion reads only what this probe wrote.
async function typedTail(page: Page, text: string): Promise<string> {
  await seed(page);
  await typeAtCaret(page, text);
  await expect
    .poll(async () => (await editorSource(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(PREAMBLE.length);
  return (await editorSource(page)).slice(PREAMBLE.length);
}

async function waitForCompletion(page: Page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await page.evaluate<boolean>(
      `!!document.querySelector('.cm-tooltip-autocomplete li[role="option"]')`,
    );
    if (open) return;
    if (Date.now() > deadline) throw new Error("completion popup did not open");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function settle(page: Page, ms: number) {
  await page.evaluate(
    `new Promise((resolve) => setTimeout(() => resolve(1), ${ms}))`,
  );
}

// Environment completion is served from the project-intelligence snapshot,
// which re-analyses on a debounce after every edit. A popup opened while that
// is still in flight can close under the accept, leaving Enter to insert a
// newline. Letting analysis settle and asking for the popup again gives a
// stable list, the same way 59-latex-intelligence.spec.ts does.
async function retriggerCompletion(page: Page, settleMs = 1_500) {
  await settle(page, settleMs);
  await page.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    ), 1)`,
  );
  await page.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true })
    ), 1)`,
  );
  await waitForCompletion(page);
}

async function completionLabels(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `[...document.querySelectorAll('.cm-tooltip-autocomplete li[role="option"]')]
      .map((li) => li.querySelector('.cm-completionLabel')?.textContent ?? '')`,
  );
}

async function selectedLabel(page: Page): Promise<string> {
  return page.evaluate<string>(
    `document.querySelector('.cm-tooltip-autocomplete li[aria-selected="true"] .cm-completionLabel')?.textContent ?? ''`,
  );
}

// Accepts the highlighted entry with Enter, the path a user takes. A synthetic
// ArrowDown does not drive the popup selection: it falls through to the plain
// cursor motion, which closes the popup and leaves the next Enter to insert a
// newline. So callers narrow the query until the entry they want is the one
// already highlighted, and this asserts that rather than navigating.
async function acceptCompletion(page: Page, label: string, timeoutMs = 10_000) {
  await waitForCompletion(page);
  // Re-querying is debounced, so an open popup may still be answering the
  // query as it stood before the last keystrokes. Wait for the narrowed list
  // to land rather than reading whatever is on screen right now.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await selectedLabel(page)) === label) break;
    if (Date.now() > deadline) {
      throw new Error(
        `completion highlighted ${(await selectedLabel(page)) || "(nothing)"} rather than ${label}; it offered ${(await completionLabels(page)).slice(0, 12).join(", ")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await page.press(".cm-content", "Enter");
  await waitLong(
    page,
    `!document.querySelector('.cm-tooltip-autocomplete li[role="option"]')`,
    10_000,
  );
}

// A preceding spec that toggles these off and fails before restoring them
// would otherwise cascade into every pairing assertion here.
async function ensureAutoClose(page: Page) {
  await page.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      useSettingsStore.setState({
        editorAutoCloseBrackets: true,
        editorAutoCloseMath: true,
        editorAutoCloseEnvironments: true,
        editorAutocomplete: true,
      });
      return 1;
    })`,
  );
}

test("size commands close their delimiter as the user types", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openDelimiterProject(tauriPage);

  expect(await typedTail(tauriPage, "\\left(")).toBe("\\left(\\right)");
  expect(await typedTail(tauriPage, "\\bigl[")).toBe("\\bigl[\\bigr]");
  expect(await typedTail(tauriPage, "\\Biggl(")).toBe("\\Biggl(\\Biggr)");
  expect(await typedTail(tauriPage, "\\big<")).toBe("\\big<\\big>");
  expect(await typedTail(tauriPage, "\\left|")).toBe("\\left|\\right|");
  expect(await typedTail(tauriPage, "\\left\\{")).toBe(
    "\\left\\{\\right\\}",
  );
  expect(await typedTail(tauriPage, "\\left\\|")).toBe(
    "\\left\\|\\right\\|",
  );
});

test("separators and closers are recognised without gaining a partner", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openDelimiterProject(tauriPage);

  // A separator takes no partner, and the generic bracket handler must not
  // hand it one either.
  expect(await typedTail(tauriPage, "\\middle|")).toBe("\\middle|");
  expect(await typedTail(tauriPage, "\\middle(")).toBe("\\middle(");
  expect(await typedTail(tauriPage, "\\bigm|")).toBe("\\bigm|");
  // A closing size command already is somebody's partner.
  expect(await typedTail(tauriPage, "\\right)")).toBe("\\right)");
  // The null delimiter is offered by completion, never inserted on its own.
  expect(await typedTail(tauriPage, "\\left.")).toBe("\\left.");
});

test("an empty pair clears from either end", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left(");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\left(\\right)");
  await tauriPage.press(".cm-content", "Backspace");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toBe(PREAMBLE);

  // Typing the closing glyph steps over the closer rather than doubling it.
  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left[");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\left[\\right]");
  const inside = await caretOffset(tauriPage);
  await typeAtCaret(tauriPage, "]");
  await expect
    .poll(async () => await caretOffset(tauriPage), { timeout: 10_000 })
    .toBe(inside + "\\right]".length);
  expect(await editorSource(tauriPage)).toBe(
    `${PREAMBLE}\\left[\\right]`,
  );
});

test("Enter on a dropdown entry inserts both halves of a named delimiter", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left\\lan");
  await waitForCompletion(tauriPage);
  expect(await completionLabels(tauriPage)).toContain("\\left\\langle");
  await acceptCompletion(tauriPage, "\\left\\langle");

  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toBe(`${PREAMBLE}\\left\\langle\\right\\rangle`);
  // The scoped source replaces the whole `\left\lan` run, so the size command
  // must appear once, not twice.
  expect(await editorSource(tauriPage)).not.toContain("\\left\\left");
});

test("a size command already open scopes the dropdown to delimiters", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left\\");
  await waitForCompletion(tauriPage);
  // The scoped list is far under the 100-option render window, so what the
  // popup renders here is the whole of what the source offered.
  const labels = await completionLabels(tauriPage);
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((label) => label.startsWith("\\left"))).toBe(true);
  expect(labels).toContain("\\left\\langle");
  expect(labels).toContain("\\left\\lvert");
  expect(labels).not.toContain("\\lambda");

  await typeAtCaret(tauriPage, "lc");
  await acceptCompletion(tauriPage, "\\left\\lceil");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toBe(`${PREAMBLE}\\left\\lceil\\right\\rceil`);
});

test("accepting a brace delimiter keeps its backslash", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openDelimiterProject(tauriPage);

  // The snippet parser reads `\{` as an escaped brace and drops the backslash,
  // which turned every brace delimiter into the invalid `\left{ ... \right}`.
  // A bare `\left` query leaves hundreds of options for CodeMirror to filter,
  // so this walks the scoped list instead; the corpus entry that spells the
  // same delimiter is covered in src/lib/latex-corpus.test.ts against the real
  // corpus file.
  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left\\");
  await acceptCompletion(tauriPage, "\\left\\{");

  const source = await editorSource(tauriPage);
  expect(source).toBe(`${PREAMBLE}\\left\\{\\right\\}`);
  expect(source).not.toContain("\\left{\\right}");
});

test("an environment that needs an argument completes with it", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  // `alignat` cannot be asked for by name: every `xalignat`/`xxalignat`
  // variant contains it, so which one ranks first is not ours to decide.
  // `alignedat` is unique and carries the same argument shape.
  await typeAtCaret(tauriPage, "\\begin{alignedat");
  await retriggerCompletion(tauriPage);
  await acceptCompletion(tauriPage, "alignedat");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\begin{alignedat}{2}");
  expect(await editorSource(tauriPage)).toContain("\\end{alignedat}");

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\begin{tabularx");
  await retriggerCompletion(tauriPage);
  await acceptCompletion(tauriPage, "tabularx");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\begin{tabularx}{\\linewidth}{lcr}");
});

test("delimiters the editor writes compile", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await openDelimiterProject(tauriPage);

  await seed(
    tauriPage,
    `${PREAMBLE}\\begin{document}\nDelimiter probe.\n\\[\n  \n\\]\n\\end{document}\n`,
  );
  await caretAfter(tauriPage, "\\[\n  ");

  // Every delimiter below is produced by the editor, not typed whole: a
  // missing backslash would leave `\left{`, which Tectonic rejects outright.
  await typeAtCaret(tauriPage, "\\left\\{");
  await typeAtCaret(tauriPage, " x ");
  await caretAfter(tauriPage, "\\right\\}");
  await typeAtCaret(tauriPage, " \\bigl(");
  await typeAtCaret(tauriPage, " y ");
  await caretAfter(tauriPage, "\\bigr)");
  await typeAtCaret(tauriPage, " \\Biggl[");
  await typeAtCaret(tauriPage, " z ");

  const source = await editorSource(tauriPage);
  expect(source).toContain("\\left\\{ x \\right\\}");
  expect(source).toContain("\\bigl( y \\bigr)");
  expect(source).toContain("\\Biggl[ z \\Biggr]");

  await compileAndWait(tauriPage);
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute(
    "data-severity",
    "ok",
    { timeout: 120_000 },
  );
  await expectCompiledPdfContains(tauriPage, "Delimiter probe");
});
