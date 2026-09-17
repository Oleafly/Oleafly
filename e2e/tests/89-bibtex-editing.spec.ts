import { test, expect } from "../fixtures";
import {
  acceptCompletion,
  createBlankProject,
  editorSource,
  openProject,
  replaceEditorSource,
  settledCompletionLabels,
  typeAtCaret,
  waitEditorShowsFile,
  waitForCompletion,
  waitLong,
  writeProjectText,
  type Page,
} from "../helpers";

const PROJECT = "BibTeX Editing";
const BIB = "refs.bib";

const MISSING_YEAR = [
  "@article{knuth84,",
  "  author = {Knuth, Donald},",
  "  title = {Literate Programming},",
  "  journal = {The Computer Journal},",
  "}",
  "",
].join("\n");

test.describe.configure({ timeout: 240_000 });

async function openBibtexProject(page: Page) {
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
  await page.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      useSettingsStore.setState({
        editorAutocomplete: true,
        editorAutoCloseBrackets: true,
      });
      return 1;
    })`,
  );
}

async function openBibFile(page: Page, content: string) {
  await writeProjectText(page, BIB, content);
  await page.evaluate(
    `import("/src/store/files.ts").then(({ useFilesStore }) =>
      useFilesStore.getState().openFile(${JSON.stringify(BIB)}))`,
  );
  await waitEditorShowsFile(page, BIB, 30_000);
  await replaceEditorSource(page, content);
}

async function typeWithRetry(page: Page, text: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await typeAtCaret(page, text);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await caretAtEnd(page);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function openMainFile(page: Page) {
  await page.evaluate(
    `import("/src/store/files.ts").then(({ useFilesStore }) =>
      useFilesStore.getState().openFile("main.tex"))`,
  );
  await waitEditorShowsFile(page, "main.tex", 30_000);
}

async function caretAtEnd(page: Page) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
      return 1;
    })`,
  );
}

async function lintMarkTexts(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `[...document.querySelectorAll('.cm-lintRange')].map(
      (mark) => mark.textContent ?? '',
    )`,
  );
}

async function bibtexLintMessages(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `Promise.all([
      import("/packages/editor/src/bibtex-linter.ts"),
      import("/src/components/editor/cm/controller.ts"),
    ]).then(([linter, cm]) =>
      linter
        .lintBibtexText(cm.getEditorView().state.doc.toString())
        .map((found) => found.message),
    )`,
  );
}

async function latexLintMessages(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `Promise.all([
      import("/packages/editor/src/latex-linter.ts"),
      import("/src/components/editor/cm/controller.ts"),
    ]).then(([linter, cm]) =>
      linter
        .lintLatexText(cm.getEditorView().state.doc.toString())
        .map((found) => found.message),
    )`,
  );
}

async function expectLintMark(page: Page, needle: string) {
  await expect
    .poll(
      async () =>
        (await lintMarkTexts(page)).some((text) => text.includes(needle)),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function expectNoLintMark(page: Page, needle: string) {
  await expect
    .poll(
      async () =>
        (await lintMarkTexts(page)).some((text) => text.includes(needle)),
      { timeout: 30_000 },
    )
    .toBe(false);
}

test("a bibliography style is completed inside \\bibliographystyle", async ({
  tauriPage,
}) => {
  await openBibtexProject(tauriPage);
  await openMainFile(tauriPage);
  await replaceEditorSource(tauriPage, "\\documentclass{article}\n");
  await caretAtEnd(tauriPage);
  await typeWithRetry(tauriPage, "\\bibliographystyle{pla");

  await waitForCompletion(tauriPage);
  const offered = await settledCompletionLabels(tauriPage, "plain", 20_000);
  expect(offered).toContain("plain");
  expect(offered).toContain("plainnat");

  await acceptCompletion(tauriPage, "plain", 20_000);
  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 15_000 })
    .toContain("\\bibliographystyle{plain}");
});

test("an entry type is completed into a full skeleton in a .bib file", async ({
  tauriPage,
}) => {
  await openBibtexProject(tauriPage);
  await openBibFile(tauriPage, "");
  await caretAtEnd(tauriPage);
  await typeWithRetry(tauriPage, "@art");

  await waitForCompletion(tauriPage);
  await acceptCompletion(tauriPage, "@article", 20_000);

  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 15_000 })
    .toContain("@article{key,");
  const source = await editorSource(tauriPage);
  expect(source).toContain("author = {author},");
  expect(source).toContain("journal = {journal},");
  expect(source).toContain("year = {year},");

  const selected = await tauriPage.evaluate<string>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const range = view.state.selection.main;
      return view.state.sliceDoc(range.from, range.to);
    })`,
  );
  expect(selected).toBe("key");
});

test("a missing required field is marked in a .bib file and %%novalidate clears it", async ({
  tauriPage,
}) => {
  await openBibtexProject(tauriPage);
  await openBibFile(tauriPage, MISSING_YEAR);

  await expectLintMark(tauriPage, "knuth84");
  const messages = await bibtexLintMessages(tauriPage);
  expect(messages.some((text) => text.includes("year or date"))).toBe(true);
  expect(messages.some((text) => text.includes("@article{knuth84}"))).toBe(
    true,
  );

  await replaceEditorSource(tauriPage, `%%novalidate\n${MISSING_YEAR}`);
  await expectNoLintMark(tauriPage, "knuth84");
  expect(await bibtexLintMessages(tauriPage)).toEqual([]);
});

test("a LaTeX syntax error is marked and %novalidate clears it", async ({
  tauriPage,
}) => {
  await openBibtexProject(tauriPage);
  await openMainFile(tauriPage);
  const broken = "\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n  \\item one\n\\end{document}\n";
  await replaceEditorSource(tauriPage, broken);

  await expectLintMark(tauriPage, "\\begin{itemize}");
  const messages = await latexLintMessages(tauriPage);
  expect(messages.some((text) => text.includes("itemize"))).toBe(true);

  await replaceEditorSource(tauriPage, `%novalidate\n${broken}`);
  await expectNoLintMark(tauriPage, "\\begin{itemize}");
  expect(await latexLintMessages(tauriPage)).toEqual([]);
});

test("a novalidate region hides only the errors inside it", async ({
  tauriPage,
}) => {
  await openBibtexProject(tauriPage);
  await openMainFile(tauriPage);
  await replaceEditorSource(
    tauriPage,
    [
      "\\documentclass{article}",
      "\\begin{document}",
      "%begin novalidate",
      "\\begin{itemize}",
      "  \\item generated",
      "%end novalidate",
      "\\begin{enumerate}",
      "\\end{document}",
      "",
    ].join("\n"),
  );

  await expectLintMark(tauriPage, "\\begin{enumerate}");
  await expectNoLintMark(tauriPage, "\\begin{itemize}");
  const messages = await latexLintMessages(tauriPage);
  expect(messages.some((text) => text.includes("enumerate"))).toBe(true);
  expect(messages.some((text) => text.includes("itemize"))).toBe(false);
});
