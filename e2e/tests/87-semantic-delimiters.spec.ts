import { test, expect } from "../fixtures";
import {
  compileAndWait,
  createBlankProject,
  editorSource,
  expectCompiledPdfContains,
  openProject,
  replaceEditorSource,
  selectEditorText,
  typeAtCaret,
  waitLong,
  type Page,
} from "../helpers";

const PROJECT = "Delimiters";

const PREAMBLE = "\\documentclass{article}\n\\usepackage{amsmath}\n";

test.describe.configure({ timeout: 240_000 });

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

async function caretsAfter(page: Page, needles: string[]) {
  const placed = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const Selection = view.state.selection.constructor;
      const source = view.state.doc.toString();
      const ranges = [];
      for (const needle of ${JSON.stringify(needles)}) {
        const at = source.indexOf(needle);
        if (at < 0) return false;
        ranges.push(Selection.cursor(at + needle.length));
      }
      view.dispatch({ selection: Selection.create(ranges) });
      view.focus();
      return true;
    })`,
  );
  if (!placed) throw new Error(`caretsAfter: a needle is missing`);
}

async function caretOffset(page: Page): Promise<number> {
  return page.evaluate<number>(
    `import("/src/components/editor/cm/controller.ts").then(
      ({ getEditorView }) => getEditorView().state.selection.main.head
    )`,
  );
}

async function typedTail(page: Page, text: string): Promise<string> {
  await seed(page);
  await typeAtCaret(page, text);
  await expect
    .poll(async () => (await editorSource(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(PREAMBLE.length);
  return (await editorSource(page)).slice(PREAMBLE.length);
}

async function expectTail(page: Page, tail: string) {
  await expect
    .poll(async () => await editorSource(page), { timeout: 10_000 })
    .toBe(`${PREAMBLE}${tail}`);
}

async function expectCaretAtEnd(page: Page) {
  await expect
    .poll(async () => await caretOffset(page), { timeout: 10_000 })
    .toBe((await editorSource(page)).length);
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

async function waitForIndexSettled(page: Page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const settled = await page.evaluate<boolean>(
      `import("/src/store/project-index.ts").then(({ useIndexStore }) => {
        const state = useIndexStore.getState().intelligenceState;
        return !!state && state.stale === false;
      })`,
    );
    if (settled) return;
    if (Date.now() > deadline) {
      throw new Error("project intelligence never settled");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function pressKey(page: Page, init: Record<string, unknown>) {
  await page.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(
      new KeyboardEvent('keydown', ${JSON.stringify({ bubbles: true, cancelable: true, ...init })})
    ), 1)`,
  );
}

async function retriggerCompletion(page: Page) {
  await waitForIndexSettled(page);
  await pressKey(page, { key: "Escape" });
  await expect
    .poll(
      async () =>
        page.evaluate<boolean>(
          `!document.querySelector('.cm-tooltip-autocomplete')`,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await pressKey(page, { key: " ", ctrlKey: true });
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

async function settledCompletionLabels(
  page: Page,
  label: string,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  for (;;) {
    const labels = await completionLabels(page);
    const current = labels.join("\n");
    if (labels.includes(label) && current === previous) return labels;
    previous = current;
    if (Date.now() > deadline) {
      throw new Error(
        `completion never settled on ${label}; it offered ${labels.slice(0, 16).join(", ")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function acceptCompletion(page: Page, label: string, timeoutMs = 10_000) {
  await waitForCompletion(page);
  const labels = await settledCompletionLabels(page, label, timeoutMs);
  for (let hop = 0; hop <= labels.length; hop += 1) {
    const selected = await selectedLabel(page);
    if (selected === label) break;
    if (selected === "") throw new Error(`completion closed while walking to ${label}`);
    if (hop === labels.length) {
      throw new Error(
        `completion never highlighted ${label}; it offered ${labels.join(", ")}`,
      );
    }
    await page.press(".cm-content", "ArrowDown");
  }
  await page.press(".cm-content", "Enter");
  await waitLong(
    page,
    `!document.querySelector('.cm-tooltip-autocomplete li[role="option"]')`,
    10_000,
  );
}

async function expectScopedList(page: Page, prefix: string) {
  await waitForCompletion(page);
  await expect
    .poll(
      async () =>
        (await completionLabels(page)).every((label) =>
          label.startsWith(prefix),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  return completionLabels(page);
}

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
  expect(await typedTail(tauriPage, "\\left (")).toBe("\\left (\\right)");
});

test("separators, closers and symmetric bars stay unpaired", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  expect(await typedTail(tauriPage, "\\middle|")).toBe("\\middle|");
  expect(await typedTail(tauriPage, "\\middle(")).toBe("\\middle(");
  expect(await typedTail(tauriPage, "\\bigm|")).toBe("\\bigm|");
  expect(await typedTail(tauriPage, "\\right)")).toBe("\\right)");
  expect(await typedTail(tauriPage, "\\left.")).toBe("\\left.");
  expect(await typedTail(tauriPage, "$f(x)\\big|_0^1$")).toBe(
    "$f(x)\\big|_0^1$",
  );
});

test("a size command typed against content stays open", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage, `${PREAMBLE}\\[\n  x^2\n\\]\n`);
  await caretAfter(tauriPage, "\\[\n  ");
  await typeAtCaret(tauriPage, "\\left(");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\left(x^2");
  expect(await editorSource(tauriPage)).not.toContain("\\right)");

  await seed(tauriPage, `${PREAMBLE}\\[\n  \\frac{a}{b}\n\\]\n`);
  await caretAfter(tauriPage, "\\[\n  ");
  await typeAtCaret(tauriPage, "\\left(");
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\left(\\frac{a}{b}");
  expect(await editorSource(tauriPage)).not.toContain("\\right)");
});

test("an empty pair clears from either end", async ({ tauriPage }) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left(");
  await expectTail(tauriPage, "\\left(\\right)");
  await tauriPage.press(".cm-content", "Backspace");
  await expectTail(tauriPage, "");

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left\\{");
  await expectTail(tauriPage, "\\left\\{\\right\\}");
  await tauriPage.press(".cm-content", "Backspace");
  await expectTail(tauriPage, "");

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left[");
  await expectTail(tauriPage, "\\left[\\right]");
  const inside = await caretOffset(tauriPage);
  await typeAtCaret(tauriPage, "]");
  await expect
    .poll(async () => await caretOffset(tauriPage), { timeout: 10_000 })
    .toBe(inside + "\\right]".length);
  await expectTail(tauriPage, "\\left[\\right]");
});

test("an inner pair keeps its own closer inside a sized pair", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left((a+b)");
  await expectTail(tauriPage, "\\left((a+b)\\right)");
  expect(await caretOffset(tauriPage)).toBe(
    `${PREAMBLE}\\left((a+b)`.length,
  );
  await typeAtCaret(tauriPage, ")");
  await expectCaretAtEnd(tauriPage);
  await expectTail(tauriPage, "\\left((a+b)\\right)");
});

test("spelling out the closer never duplicates it", async ({ tauriPage }) => {
  await openDelimiterProject(tauriPage);

  for (const [typed, expected] of [
    ["\\left(x\\right)", "\\left(x\\right)"],
    ["\\left\\{x\\right\\}", "\\left\\{x\\right\\}"],
    ["\\bigl(x\\bigr)", "\\bigl(x\\bigr)"],
    ["\\big(x\\big)", "\\big(x\\big)"],
    ["\\left\\{x\\}", "\\left\\{x\\right\\}"],
    ["\\left\\|x\\|", "\\left\\|x\\right\\|"],
  ] as const) {
    await seed(tauriPage);
    await typeAtCaret(tauriPage, typed);
    await expectTail(tauriPage, expected);
    await expectCaretAtEnd(tauriPage);
  }
});

test("a closer the user typed themselves is left alone", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage, `${PREAMBLE}\\left(x\\right)`);
  await caretAfter(tauriPage, "\\left(x");
  await typeAtCaret(tauriPage, ")");
  await expectTail(tauriPage, "\\left(x)\\right)");

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left(x\\bigr)");
  await expectTail(tauriPage, "\\left(x\\bigr)\\right)");
});

test("a selection is wrapped and several carets pair at once", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage, `${PREAMBLE}\\left x + y`);
  await selectEditorText(tauriPage, "x + y");
  await typeAtCaret(tauriPage, "(");
  await expectTail(tauriPage, "\\left (x + y\\right)");

  await seed(tauriPage, `${PREAMBLE}\\left\n\\bigl`);
  await caretsAfter(tauriPage, ["\\left", "\\bigl"]);
  await typeAtCaret(tauriPage, "(");
  await expectTail(tauriPage, "\\left(\\right)\n\\bigl(\\bigr)");
});

test("Enter on a dropdown entry inserts both halves of a named delimiter", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left\\lan");
  await waitForCompletion(tauriPage);
  expect(await completionLabels(tauriPage)).toContain("\\left\\langle");
  await acceptCompletion(tauriPage, "\\left\\langle");
  await expectTail(tauriPage, "\\left\\langle\\right\\rangle");
  expect(await editorSource(tauriPage)).not.toContain("\\left\\left");

  await typeAtCaret(tauriPage, " x\\right\\rangle");
  await expectTail(tauriPage, "\\left\\langle x\\right\\rangle");
  await expectCaretAtEnd(tauriPage);
});

test("accepting the matching closer consumes the pending one", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left\\lan");
  await acceptCompletion(tauriPage, "\\left\\langle");
  await expectTail(tauriPage, "\\left\\langle\\right\\rangle");
  await typeAtCaret(tauriPage, " x\\right\\rang");
  await acceptCompletion(tauriPage, "\\right\\rangle");
  await expectTail(tauriPage, "\\left\\langle x\\right\\rangle");
  await expectCaretAtEnd(tauriPage);
});

test("a size command already open scopes the dropdown to delimiters", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left\\");
  const labels = await expectScopedList(tauriPage, "\\left");
  expect(labels.length).toBeGreaterThan(0);
  expect(labels).toContain("\\left\\langle");
  expect(labels).toContain("\\left\\lvert");
  expect(labels).toContain("\\left\\uparrow");
  expect(labels).not.toContain("\\lambda");
  await acceptCompletion(tauriPage, "\\left\\lvert");
  await expectTail(tauriPage, "\\left\\lvert\\right\\rvert");

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\middle\\");
  const separators = await expectScopedList(tauriPage, "\\middle");
  expect(separators).toContain("\\middle\\vert");
  expect(separators).not.toContain("\\middle\\langle");
  await acceptCompletion(tauriPage, "\\middle\\vert");
  await expectTail(tauriPage, "\\middle\\vert");

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\right\\");
  const closers = await expectScopedList(tauriPage, "\\right");
  expect(closers).toContain("\\right\\rangle");
  expect(closers).toContain("\\right\\rvert");
});

test("accepting a brace delimiter keeps its backslash", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\left\\");
  await acceptCompletion(tauriPage, "\\left\\{");
  await expectTail(tauriPage, "\\left\\{\\right\\}");
  expect(await editorSource(tauriPage)).not.toContain("\\left{\\right}");
});

test("a standalone pair from the dropdown clears on Backspace", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
  await typeAtCaret(tauriPage, "\\lang");
  await acceptCompletion(tauriPage, "\\langle");
  await expectTail(tauriPage, "\\langle\\rangle");
  await tauriPage.press(".cm-content", "Backspace");
  await expectTail(tauriPage, "");
});

test("an environment that needs an argument completes with it", async ({
  tauriPage,
}) => {
  await openDelimiterProject(tauriPage);

  await seed(tauriPage);
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
    .toContain("\\begin{tabularx}{\\linewidth}{lX}");
});

test("delimiters the editor writes compile", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await openDelimiterProject(tauriPage);

  await seed(
    tauriPage,
    `${PREAMBLE}\\begin{document}\nDelimiter probe.\n\\[\n  \n\\]\n\\end{document}\n`,
  );
  await caretAfter(tauriPage, "\\[\n  ");

  await typeAtCaret(tauriPage, "\\left\\{ (x) \\} + \\bigl( y \\bigr)");
  await typeAtCaret(tauriPage, " + \\Biggl[ z ] + \\big| w \\big|");

  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain(
      "\\left\\{ (x) \\right\\} + \\bigl( y \\bigr) + \\Biggl[ z \\Biggr] + \\big| w \\big|",
    );

  await compileAndWait(tauriPage);
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute(
    "data-severity",
    "ok",
    { timeout: 120_000 },
  );
  await expectCompiledPdfContains(tauriPage, "Delimiter probe");
});
