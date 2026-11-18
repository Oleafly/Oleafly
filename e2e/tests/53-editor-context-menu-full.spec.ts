import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect } from "../fixtures";
import {
  caretIn,
  caretLineIncludes,
  clickEditorContextPath,
  compileAndProbe,
  createBlankProject,
  createProjectFromTemplate,
  editorSource,
  type Page,
  replaceEditorSource,
  setEditorCaretAfter,
} from "../helpers";

const RUN = Date.now().toString(36);
const LATEX_SOURCE = String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage[hidelinks]{hyperref}
\begin{document}
CONTEXTTARGET
\end{document}
`;

async function freshLatex(page: Page, suffix: string, source = LATEX_SOURCE) {
  await createBlankProject(page, `E2E Context ${suffix} ${RUN}`);
  await replaceEditorSource(page, source);
}

async function openContextMenu(page: TauriPage) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const editor = document.querySelector(".cm-content");
      const cursor =
        document.querySelector(".cm-cursor-primary") ??
        document.querySelector(".cm-cursor");
      const rect = cursor?.getBoundingClientRect();
      const view = getEditorView();
      if (!editor || !rect || !view) {
        throw new Error("editor cursor is unavailable");
      }
      const intendedPosition = view.state.selection.main.head;
      editor.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left,
        clientY: rect.top + Math.max(1, rect.height / 2),
        button: 2,
      }));
      // A zero-width CodeMirror caret sits on the boundary between two
      // characters. WebKitGTK can resolve that synthetic point to the
      // preceding character, while a user right-click has a non-zero glyph
      // target. Restore the exact public editor selection after opening the
      // real context menu so code-intelligence actions run on the symbol the
      // test deliberately selected.
      view.dispatch({ selection: { anchor: intendedPosition } });
      view.focus();
      return true;
    })`,
  );
  await expect(page.getByRole("menu")).toBeVisible({ timeout: 5_000 });
}

async function clickContextAction(page: TauriPage, ...path: string[]) {
  await openContextMenu(page);
  await clickEditorContextPath(page, path);
}

async function resetInlineAi(page: TauriPage) {
  await page.evaluate(
    `import("/src/store/inlineEdit.ts").then(
      ({ useInlineEditStore }) => useInlineEditStore.getState().reset()
    )`,
  );
}

async function resetLatexCursor(page: TauriPage) {
  await replaceEditorSource(page, LATEX_SOURCE);
  await setEditorCaretAfter(page, "CONTEXTTARGET");
}

async function expectContextInsertion(
  page: TauriPage,
  path: readonly string[],
  expected: string,
) {
  await resetLatexCursor(page);
  await clickContextAction(page, ...path);
  expect(await editorSource(page)).toContain(expected);
}

test("LaTeX context menu activates every formatting and insertion action", async ({
  tauriPage,
}) => {
  await freshLatex(tauriPage, "LaTeX inventory");

  await resetLatexCursor(tauriPage);
  await clickContextAction(tauriPage, "Ask AI…");
  await expect(tauriPage.locator(".cm-inline-prompt")).toBeVisible({
    timeout: 5_000,
  });
  await resetInlineAi(tauriPage);

  const directActions = [
    [["Format", "Bold"], String.raw`\textbf{text}`],
    [["Format", "Italic"], String.raw`\textit{text}`],
    [["Format", "Underline"], String.raw`\underline{text}`],
    [["Format", "Inline code"], String.raw`\texttt{text}`],
    [["Insert", "Table"], String.raw`\begin{table}`],
    [["Insert", "Equation"], String.raw`\begin{equation}`],
    [["Insert", "Align"], String.raw`\begin{align}`],
    [["Insert", "Fraction"], String.raw`\frac{numerator}{denominator}`],
    [["Insert", "Blockquote"], String.raw`\begin{quote}`],
    [["Insert", "Footnote"], String.raw`\footnote{note text}`],
    [["Insert", "Cross-reference"], String.raw`\ref{label}`],
    [["Insert", "Label"], String.raw`\label{label}`],
  ] as const;
  for (const [path, expected] of directActions) {
    await expectContextInsertion(tauriPage, path, expected);
  }

  await resetLatexCursor(tauriPage);
  await clickContextAction(tauriPage, "Insert", "Figure");
  await tauriPage.click('[data-testid="figure-dialog-placeholder"]');
  expect(await editorSource(tauriPage)).toContain(String.raw`\begin{figure}`);

  const headingActions = [
    ["Part", "part"],
    ["Chapter", "chapter"],
    ["Section", "section"],
    ["Subsection", "subsection"],
    ["Subsubsection", "subsubsection"],
    ["Paragraph", "paragraph"],
  ] as const;
  for (const [label, command] of headingActions) {
    await resetLatexCursor(tauriPage);
    await clickContextAction(tauriPage, "Insert", "Heading", label);
    expect(await editorSource(tauriPage)).toContain(
      `\\${command}{${label} Title}`,
    );
  }

  for (const [label, environment] of [
    ["Itemize", "itemize"],
    ["Enumerate", "enumerate"],
  ] as const) {
    await resetLatexCursor(tauriPage);
    await clickContextAction(tauriPage, "Insert", "List", label);
    expect(await editorSource(tauriPage)).toContain(
      `\\begin{${environment}}`,
    );
  }
});

test("LaTeX context navigation actions run SyncTeX and all code-intelligence paths", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await freshLatex(
    tauriPage,
    "Navigation inventory",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[hidelinks]{hyperref}
\begin{document}
\section{CONTEXTNAVSECTION}\label{sec:context-nav}
Context reference: \ref{sec:context-nav}.
\end{document}
`,
  );
  await compileAndProbe(tauriPage);

  await tauriPage.click('[aria-label="Source View"]');
  await caretIn(tauriPage, "CONTEXTNAVSECTION");
  await clickContextAction(tauriPage, "Go to PDF (SyncTeX)");
  await expect(tauriPage.locator('[aria-label="Split View"]')).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 10_000 },
  );
  await expect(tauriPage.locator(".ll-synctex-hl")).toBeVisible({
    timeout: 15_000,
  });

  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:context-nav", 2);
    await clickContextAction(tauriPage, "Go to definition");
    const landed = await tauriPage
      .waitForFunction(
        caretLineIncludes("label{sec:context-nav}"),
        5_000,
      )
      .then(() => true)
      .catch(() => false);
    if (landed) break;
    if (attempt >= 3) throw new Error("context go-to-definition never landed");
  }

  await caretIn(tauriPage, "sec:context-nav", 2);
  await clickContextAction(tauriPage, "Find references");
  await expect(
    tauriPage.locator('[aria-label="References (Shift-F12)"]'),
  ).toBeVisible({ timeout: 10_000 });

  const dialog = tauriPage.locator(
    '[role="dialog"][aria-labelledby="rename-title"]',
  );
  // CodeMirror can briefly retain the definition selection made by the
  // preceding navigation while the references rail is resizing the editor.
  // Retry the real context-menu gesture until the caret placement sticks.
  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:context-nav", 2);
    await clickContextAction(tauriPage, "Rename symbol");
    const opened = await expect(dialog)
      .toBeVisible({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) break;
    if (attempt >= 3) throw new Error("context-menu rename never opened");
  }
  await dialog.getByText("Cancel", { exact: true }).click();
  await expect(dialog).toBeHidden();
});

// Types at the caret the way CodeMirror's input handling does, so the Markdown engine's typing
// handoff sees a keystroke. The menu's Markdown actions run once their module's import resolves,
// so the key waits a turn of the event loop first, as a person's would.
async function typeAtCaret(page: TauriPage, text: string) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(async ({ getEditorView }) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const view = getEditorView();
      if (!view) throw new Error("editor is unavailable");
      const at = view.state.selection.main.head;
      view.dispatch({
        changes: { from: at, insert: ${JSON.stringify(text)} },
        selection: { anchor: at + ${text.length} },
        userEvent: "input.type",
      });
    })`,
  );
}

// [menu path, expected source, text typed after the action]. Markdown's formatting works as in
// Visual: Bold and Italic at an empty caret write nothing and make the next typed text bold or
// italic, and Heading and Bulleted list turn the caret's line into one.
async function exerciseSimpleProfile(
  page: TauriPage,
  expectations: readonly (readonly [readonly string[], string, string?])[],
) {
  for (const [path, expected, typed] of expectations) {
    await replaceEditorSource(page, "CONTEXTTARGET");
    await setEditorCaretAfter(page, "CONTEXTTARGET");
    await clickContextAction(page, ...path);
    if (typed !== undefined) await typeAtCaret(page, typed);
    await expect.poll(() => editorSource(page)).toContain(expected);
  }

  await replaceEditorSource(page, "CONTEXTTARGET");
  await setEditorCaretAfter(page, "CONTEXTTARGET");
  await clickContextAction(page, "Ask AI…");
  await expect(page.locator(".cm-inline-prompt")).toBeVisible({
    timeout: 5_000,
  });
  await resetInlineAi(page);
}

test("Typst context menu activates every profile-appropriate action", async ({
  tauriPage,
}) => {
  await createProjectFromTemplate(
    tauriPage,
    "blank-typst",
    `E2E Context Typst ${RUN}`,
  );
  await exerciseSimpleProfile(tauriPage, [
    [["Format", "Bold"], "CONTEXTTARGET*text*"],
    [["Format", "Italic"], "CONTEXTTARGET_text_"],
    [["Insert", "Heading", "Title"], "= Title\n"],
    [["Insert", "Heading", "Section"], "== Section\n"],
    [["Insert", "List", "Bulleted list"], "- Item\n"],
    [["Insert", "List", "Numbered list"], "+ Item\n"],
  ]);
});

test("Markdown context menu activates every profile-appropriate action", async ({
  tauriPage,
}) => {
  await createProjectFromTemplate(
    tauriPage,
    "blank-markdown",
    `E2E Context Markdown ${RUN}`,
  );
  await exerciseSimpleProfile(tauriPage, [
    // The block actions come first: they change the text, so waiting for them also loads the
    // Markdown engine before Bold and Italic, whose effect only shows in the next typed key.
    [["Insert", "Heading"], "# CONTEXTTARGET"],
    [["Insert", "Bulleted list"], "- CONTEXTTARGET"],
    [["Insert", "Table"], "CONTEXTTARGET\n\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |"],
    [["Insert", "Equation"], "CONTEXTTARGET$$\n\n$$\n"],
    [["Format", "Bold"], "CONTEXTTARGET**X**", "X"],
    [["Format", "Italic"], "CONTEXTTARGET*X*", "X"],
  ]);
});
