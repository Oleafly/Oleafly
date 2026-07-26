import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect } from "../fixtures";
import {
  caretIn,
  compileAndProbe,
  createBlankProject,
  createProjectFromTemplate,
  editorSource,
  replaceEditorSource,
  setEditorCaretAfter,
  type Page,
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
    `(() => {
      const editor = document.querySelector(".cm-content");
      const cursor =
        document.querySelector(".cm-cursor-primary") ??
        document.querySelector(".cm-cursor");
      const rect = cursor?.getBoundingClientRect();
      if (!editor || !rect) throw new Error("editor cursor is unavailable");
      editor.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left,
        clientY: rect.top + Math.max(1, rect.height / 2),
        button: 2,
      }));
      return true;
    })()`,
  );
  await expect(page.getByRole("menu")).toBeVisible({ timeout: 5_000 });
}

async function clickContextAction(page: TauriPage, label: string) {
  await openContextMenu(page);
  await page.locator('[role="menuitem"]').filter({ hasText: label }).click();
}

async function clickContextSubAction(
  page: TauriPage,
  submenu: string,
  label: string,
) {
  await openContextMenu(page);
  // The Tauri bridge's text-locator hover only emits legacy mouse events.
  // Radix submenus open from pointer movement (or ArrowRight), so drive the
  // actual mounted submenu trigger with the events a user generates.
  await page.evaluate(
    `(() => {
      const trigger = Array.from(document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]'))
        .find((element) => (element.textContent ?? "").trim().includes(${JSON.stringify(submenu)}));
      if (!trigger) throw new Error(${JSON.stringify(`context submenu unavailable: ${submenu}`)});
      trigger.focus();
      const rect = trigger.getBoundingClientRect();
      trigger.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
      trigger.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "ArrowRight",
      }));
      return true;
    })()`,
  );
  const item = page.locator('[role="menuitem"]').filter({ hasText: label });
  await expect(item).toBeVisible({
    timeout: 5_000,
  });
  await item.click();
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
  action: string,
  expected: string,
) {
  await resetLatexCursor(page);
  await clickContextAction(page, action);
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
    ["Bold", String.raw`\textbf{text}`],
    ["Italic", String.raw`\textit{text}`],
    ["Underline", String.raw`\underline{text}`],
    ["Inline code", String.raw`\texttt{text}`],
    ["Figure", String.raw`\begin{figure}`],
    ["Table", String.raw`\begin{table}`],
    ["Align", String.raw`\begin{align}`],
    ["Equation", String.raw`\begin{equation}`],
    ["Fraction", String.raw`\frac{numerator}{denominator}`],
    ["Blockquote", String.raw`\begin{quote}`],
    ["Footnote", String.raw`\footnote{note text}`],
    ["Cross-reference", String.raw`\ref{label}`],
    ["Label", String.raw`\label{label}`],
  ] as const;
  for (const [action, expected] of directActions) {
    await expectContextInsertion(tauriPage, action, expected);
  }

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
    await clickContextSubAction(tauriPage, "Heading", label);
    expect(await editorSource(tauriPage)).toContain(
      `\\${command}{${label} Title}`,
    );
  }

  for (const [label, environment] of [
    ["Itemize", "itemize"],
    ["Enumerate", "enumerate"],
  ] as const) {
    await resetLatexCursor(tauriPage);
    await clickContextSubAction(tauriPage, "List", label);
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

  // The context action can land as a silent no-op while the editor is still
  // settling from the SyncTeX view switch; retry the whole gesture.
  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:context-nav", 2);
    await clickContextAction(tauriPage, "Go to definition");
    const landed = await tauriPage
      .waitForFunction(
        `(document.querySelector(".cm-activeLine")?.textContent ?? "")
          .includes("label{sec:context-nav}")`,
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

async function exerciseSimpleProfile(
  page: TauriPage,
  expectations: readonly (readonly [string, string])[],
) {
  for (const [action, expected] of expectations) {
    await replaceEditorSource(page, "CONTEXTTARGET");
    await setEditorCaretAfter(page, "CONTEXTTARGET");
    await clickContextAction(page, action);
    expect(await editorSource(page)).toContain(expected);
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
    ["Bold", "CONTEXTTARGET**"],
    ["Italic", "CONTEXTTARGET__"],
    ["Heading", "= Heading\n"],
    ["Bulleted list", "- Item\n"],
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
    ["Bold", "CONTEXTTARGET****"],
    ["Italic", "CONTEXTTARGET**"],
    ["Heading", "# Heading\n"],
    ["Bulleted list", "- Item\n"],
  ]);
});
