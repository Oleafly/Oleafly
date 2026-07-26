import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect } from "../fixtures";
import {
  caretIn,
  clickToolbarControl,
  compileAndProbe,
  createBlankProject,
  editorSource,
  readProjectText,
  replaceEditorLiteral,
  replaceEditorSource,
  writeProjectBinary,
  type Page,
} from "../helpers";
import type {
  E2ePdfProbe,
  E2ePdfTextItem,
} from "../../src/lib/e2e-probe";

const RUN = Date.now().toString(36);
const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAABZUlEQVQ4jZ2SPU8CQRCG38NDPM6PKCAeUNhotNLERGJHYucPMFbGj9gaY6uFP4AQSwuBHkNpYkWMjcYYbQgVnaAE8MAGPGB3LEyA4w4k9262mJl3Zp/NLohokhGLcuIVTkOvEiMWIaJRgTEWg4B9WBEhLLR4UwUwbWkAUBaarEGDHGqjirv8PV6/0sjXCwivncPvnGvXRQLv23ybSyGSuUad/QAAtvwh+Jyz6O4RicwHRLMJxLKJdhyQFRwvHaDXLxKMN3gqvyGevdHlgu5VjNsl9PoNBJw4LjMxg5E4N5xuSvBQfEauVtDl5uUAjhZ3DENNCVKfj52iICLkXcfJ8h6cI47/CQiEFzUNRfLgcGEbQdcKJuxyu2YmHUGhXoLGNFwFL+CTvH+NfV6pi6BjeK99YFPZgCJ5MOh/dEv41oplEFxDuY2q2IhYnMBhcSfFKYd6VtVmbCDsAnAPx40KiJKtMfvpL2rU7TM3sBQgAAAAAElFTkSuQmCC";

async function freshLatex(page: Page, suffix: string, source: string) {
  await createBlankProject(page, `E2E Workflow ${suffix} ${RUN}`);
  await replaceEditorSource(page, source);
}

async function readWordCounts(
  page: TauriPage,
): Promise<{ Words: number; Characters: number; Lines: number }> {
  return page.evaluate<{ Words: number; Characters: number; Lines: number }>(
    `(() => {
      const title = Array.from(document.querySelectorAll("p"))
        .find((node) => node.textContent?.trim() === "Word count");
      if (!title?.parentElement) throw new Error("word-count popover not found");
      const lines = (title.parentElement.innerText || "")
        .split("\\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const valueAfter = (label) => {
        const index = lines.indexOf(label);
        if (index < 0) throw new Error("missing word-count row: " + label);
        const value = Number(lines[index + 1].replaceAll(",", ""));
        if (!Number.isFinite(value)) throw new Error("invalid word-count value: " + lines[index + 1]);
        return value;
      };
      return {
        Words: valueAfter("Words"),
        Characters: valueAfter("Characters"),
        Lines: valueAfter("Lines"),
      };
    })()`,
  );
}

async function currentEditorSelection(
  page: TauriPage,
): Promise<{ from: number; to: number; text: string }> {
  return page.evaluate<{ from: number; to: number; text: string }>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("CodeMirror is unavailable");
      const selection = view.state.selection.main;
      return {
        from: selection.from,
        to: selection.to,
        text: view.state.sliceDoc(selection.from, selection.to),
      };
    })`,
  );
}

function codeIntelligenceButtonExpression(label: string) {
  return `Array.from(
    document.querySelectorAll('[data-radix-popper-content-wrapper] button')
  ).find((candidate) => {
    if (!candidate.textContent?.trim().startsWith(${JSON.stringify(label)})) return false;
    const style = getComputedStyle(candidate);
    const rect = candidate.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && rect.width > 0
      && rect.height > 0;
  })`;
}

async function openCodeIntelligence(page: TauriPage) {
  const actionExpression = codeIntelligenceButtonExpression("Go to definition");
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await page.evaluate<boolean>(`!!(${actionExpression})`)) return;
    await clickToolbarControl(page, '[aria-label="Code intelligence"]', "Code");
    const opened = await page
      .waitForFunction(`!!(${actionExpression})`, 3_000)
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error("Code intelligence menu did not remain open");
}

// Find and click in one browser task; the menu can remount between a wait
// that sees the action and a separate locator click (same race class the
// shared clickToolbarControl fixed).
async function clickCodeIntelligenceAction(page: TauriPage, label: string) {
  const buttonExpression = codeIntelligenceButtonExpression(label);
  const atomicClick = () =>
    page.evaluate<boolean>(`(() => {
      const button = ${buttonExpression};
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await atomicClick()) return;
    await clickToolbarControl(page, '[aria-label="Code intelligence"]', "Code");
    await page
      .waitForFunction(`!!(${buttonExpression})`, 3_000)
      .catch(() => undefined);
  }
  if (!(await atomicClick())) {
    throw new Error(`${label} code-intelligence action never became clickable`);
  }
}

// Portal items can vanish between a wait and a separate locator click when
// the toolbar relayouts or a stale exit-animation portal lingers in a
// headless webview. Find and click inside the OPEN portal in one browser
// task, retrying until the item exists.
async function clickPortalButton(
  page: TauriPage,
  predicate: string,
  description: string,
) {
  const clicked = await page
    .waitForFunction(
      `(() => {
        const button = Array.from(
          document.querySelectorAll('[data-radix-popper-content-wrapper] button')
        )
          .filter((candidate) => candidate.closest('[data-state="open"]'))
          .find((candidate) => ${predicate});
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`,
      5_000,
    )
    .then(() => true)
    .catch(() => false);
  if (!clicked) {
    throw new Error(`${description} portal button never became clickable`);
  }
}

async function selectWysiwygText(page: TauriPage, text: string) {
  const selected = await page.evaluate<boolean>(
    `import("/src/components/editor/wysiwyg/controller.ts").then(({ getWysiwygEditor }) => {
      const editor = getWysiwygEditor();
      if (!editor) return false;
      let range = null;
      editor.state.doc.descendants((node, position) => {
        if (range || !node.isText || !node.text) return;
        const offset = node.text.indexOf(${JSON.stringify(text)});
        if (offset >= 0) {
          range = {
            from: position + offset,
            to: position + offset + ${JSON.stringify(text)}.length,
          };
        }
      });
      if (!range) return false;
      editor.chain().focus().setTextSelection(range).run();
      return true;
    })`,
  );
  if (!selected) throw new Error(`WYSIWYG text not found: ${text}`);
}

async function collapseWysiwygSelectionToEnd(page: TauriPage) {
  const collapsed = await page.evaluate<boolean>(
    `import("/src/components/editor/wysiwyg/controller.ts").then(({ getWysiwygEditor }) => {
      const editor = getWysiwygEditor();
      if (!editor) return false;
      editor.chain().focus().setTextSelection(editor.state.selection.to).run();
      return true;
    })`,
  );
  if (!collapsed) throw new Error("WYSIWYG editor is unavailable");
}

async function waitForSource(
  page: TauriPage,
  predicate: (source: string) => boolean,
  description: string,
) {
  const deadline = Date.now() + 10_000;
  let source = "";
  do {
    source = await editorSource(page);
    if (predicate(source)) return source;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${description}; source=${JSON.stringify(source)}`);
}

function itemContaining(probe: E2ePdfProbe, token: string): E2ePdfTextItem {
  const item = probe.pages
    .flatMap((page) => page.items)
    .find((candidate) => candidate.str.includes(token));
  if (!item) throw new Error(`compiled PDF item not found: ${token}`);
  return item;
}

function fontIdentity(item: E2ePdfTextItem): string {
  return item.pdfFontName ?? item.loadedFontName ?? item.fontName;
}

test("word count is exact after mutation and Find navigates, reverses, and replaces", async ({
  tauriPage,
}) => {
  await freshLatex(
    tauriPage,
    "Count find",
    String.raw`\documentclass{article}
\begin{document}
alpha beta
gamma
FINDTARGET first. middle FINDTARGET second.
\end{document}
`,
  );

  await tauriPage.click('[aria-label="Word count"]');
  expect(await readWordCounts(tauriPage)).toEqual({
    Words: 8,
    Characters: 60,
    Lines: 3,
  });
  await tauriPage.press("body", "Escape");

  await replaceEditorSource(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
alpha beta
gamma delta epsilon
zeta
FINDTARGET first. middle FINDTARGET second.
\end{document}
`,
  );
  await tauriPage.click('[aria-label="Word count"]');
  expect(await readWordCounts(tauriPage)).toEqual({
    Words: 11,
    Characters: 79,
    Lines: 4,
  });
  await tauriPage.press("body", "Escape");

  await tauriPage.click('[aria-label^="Find ("]');
  await expect(tauriPage.locator(".cm-vs-search")).toBeVisible({ timeout: 5_000 });
  await tauriPage.fill('[aria-label="Find"]', "FINDTARGET");

  await tauriPage.click('[aria-label="Next match (Enter)"]');
  const first = await currentEditorSelection(tauriPage);
  expect(first.text).toBe("FINDTARGET");
  await tauriPage.click('[aria-label="Next match (Enter)"]');
  const second = await currentEditorSelection(tauriPage);
  expect(second.text).toBe("FINDTARGET");
  expect(second.from).not.toBe(first.from);
  await tauriPage.click('[aria-label="Previous match (⇧Enter)"]');
  const previous = await currentEditorSelection(tauriPage);
  expect(previous.from).toBe(first.from);

  await tauriPage.click('[aria-label="Toggle Replace"]');
  await tauriPage.fill('[aria-label="Replace"]', "REPLACEDTARGET");
  await tauriPage.click('[aria-label="Replace next"]');
  const source = await editorSource(tauriPage);
  expect(source.match(/REPLACEDTARGET/g)).toHaveLength(1);
  expect(source.match(/FINDTARGET/g)).toHaveLength(1);
});

test("Find covers filters, select-all, close, preserve-case, and replace-all", async ({
  tauriPage,
}) => {
  await freshLatex(
    tauriPage,
    "Find complete",
    String.raw`\documentclass{article}
\begin{document}
CaseToken casetoken CaseTokenish
RX1 RX22
selectme middle selectme
FOO Foo foo food
\end{document}
`,
  );
  await tauriPage.click('[aria-label^="Find ("]');
  const panel = tauriPage.locator('[role="search"][aria-label="Find and replace"]');
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await expect(tauriPage.locator('.cm-vs-count[role="status"]')).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await tauriPage.focus('[aria-label="Find"]');
  const focusOutline = await tauriPage.evaluate<{
    style: string;
    width: number;
  }>(
    `(() => {
      const input = document.querySelector('[aria-label="Find"]');
      const style = getComputedStyle(input);
      return {
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth) || 0,
      };
    })()`,
  );
  expect(focusOutline.style).not.toBe("none");
  expect(focusOutline.width).toBeGreaterThanOrEqual(2);

  const count = async () =>
    tauriPage.evaluate<string>(
      `document.querySelector(".cm-vs-count")?.textContent ?? ""`,
    );
  await tauriPage.fill('[aria-label="Find"]', "CaseToken");
  expect(await count()).toBe("3 results");
  await tauriPage.click('[aria-label="Match case"]');
  await expect(tauriPage.locator('[aria-label="Match case"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await count()).toBe("2 results");
  await tauriPage.click('[aria-label="Match whole word"]');
  await expect(
    tauriPage.locator('[aria-label="Match whole word"]'),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await count()).toBe("1 result");
  await tauriPage.click('[aria-label="Match case"]');
  expect(await count()).toBe("2 results");

  await tauriPage.click('[aria-label="Match whole word"]');
  await tauriPage.click('[aria-label="Use regular expression"]');
  await expect(
    tauriPage.locator('[aria-label="Use regular expression"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await tauriPage.fill('[aria-label="Find"]', String.raw`RX\d+`);
  expect(await count()).toBe("2 results");
  await tauriPage.fill('[aria-label="Find"]', "[");
  expect(await count()).toBe("Invalid");
  await tauriPage.click('[aria-label="Use regular expression"]');

  await tauriPage.fill('[aria-label="Find"]', "selectme");
  await tauriPage.click('[aria-label="Select all matches"]');
  const selected = await tauriPage.evaluate<string[]>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("CodeMirror is unavailable");
      return view.state.selection.ranges.map(
        (range) => view.state.sliceDoc(range.from, range.to)
      );
    })`,
  );
  expect(selected).toEqual(["selectme", "selectme"]);

  await tauriPage.click('[aria-label="Close (Esc)"]');
  await expect(panel).toBeHidden();

  await tauriPage.click('[aria-label^="Find ("]');
  await tauriPage.fill('[aria-label="Find"]', "foo");
  await tauriPage.click('[aria-label="Match whole word"]');
  const disclosure = tauriPage.locator('[aria-label="Toggle Replace"]');
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await tauriPage.fill('[aria-label="Replace"]', "bar");
  await tauriPage.click('[aria-label="Preserve case"]');
  await expect(
    tauriPage.locator('[aria-label="Preserve case"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await tauriPage.click('[aria-label="Replace all"]');
  expect(await editorSource(tauriPage)).toContain("BAR Bar bar food");
  expect(await count()).toBe("No results");

  await tauriPage.press('[aria-label="Find"]', "Escape");
  await expect(panel).toBeHidden();
});

test("toolbar code intelligence commits rename and keeps the PDF reference resolved", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await freshLatex(
    tauriPage,
    "Code intelligence",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[hidelinks]{hyperref}
\begin{document}
\section{RENAMEDSECTIONSEMANTIC}\label{sec:toolbar-original}
Resolved reference: \ref{sec:toolbar-original}.
\end{document}
`,
  );
  await compileAndProbe(tauriPage);

  await caretIn(tauriPage, "sec:toolbar-original", 2);
  await openCodeIntelligence(tauriPage);
  await clickCodeIntelligenceAction(tauriPage, "Go to definition");
  await tauriPage.waitForFunction(
    `(document.querySelector(".cm-activeLine")?.textContent ?? "")
      .includes("label{sec:toolbar-original}")`,
    10_000,
  );

  await caretIn(tauriPage, "sec:toolbar-original", 2);
  await openCodeIntelligence(tauriPage);
  await clickCodeIntelligenceAction(tauriPage, "Find references");
  await expect(
    tauriPage.locator('[aria-label="References (Shift-F12)"]'),
  ).toBeVisible({ timeout: 10_000 });

  await caretIn(tauriPage, "sec:toolbar-original", 2);
  await openCodeIntelligence(tauriPage);
  await clickCodeIntelligenceAction(tauriPage, "Rename symbol");
  const dialog = tauriPage.locator(
    '[role="dialog"][aria-labelledby="rename-title"]',
  );
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await tauriPage.fill('[aria-label="New name"]', "sec:toolbar-renamed");
  await expect(tauriPage.locator('[aria-label="New name"]')).toHaveValue(
    "sec:toolbar-renamed",
  );
  await expect(dialog).toContainText("2 edits across 1 file");
  const renameButton = tauriPage.locator('[aria-label="Commit rename"]');
  await expect(renameButton).toBeEnabled({ timeout: 5_000 });
  await renameButton.click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  const renameDeadline = Date.now() + 10_000;
  let renamedSource = "";
  do {
    renamedSource = await editorSource(tauriPage);
    if (
      !renamedSource.includes("sec:toolbar-original") &&
      renamedSource.match(/sec:toolbar-renamed/g)?.length === 2
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < renameDeadline);
  expect(renamedSource).not.toContain("sec:toolbar-original");
  expect(renamedSource.match(/sec:toolbar-renamed/g)).toHaveLength(2);

  const probe = await compileAndProbe(tauriPage);
  expect(probe.text).toContain("RENAMEDSECTIONSEMANTIC");
  expect(probe.text).not.toContain("??");
  expect(
    probe.pages
      .flatMap((page) => page.annotations)
      .some((annotation) => annotation.destination !== null),
  ).toBe(true);
});

test("WYSIWYG toolbar and keyboard undo/redo use visual history and compiled state", async ({
  tauriPage,
}) => {
  test.setTimeout(500_000);
  await freshLatex(
    tauriPage,
    "WYSIWYG history",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\begin{document}
WYSKEYBOARDSEMANTIC
\end{document}
`,
  );
  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });

  await selectWysiwygText(tauriPage, "WYSKEYBOARDSEMANTIC");
  await collapseWysiwygSelectionToEnd(tauriPage);
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert footnote"]',
    "Insert footnote",
  );
  await tauriPage.click('[aria-label="Switch to source view"]');
  await waitForSource(
    tauriPage,
    (source) => source.includes("\\footnote{note text}"),
    "WYSIWYG footnote did not serialize",
  );
  expect((await compileAndProbe(tauriPage)).text).toContain("note text");

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await tauriPage.click('[aria-label^="Undo ("]');
  await tauriPage.click('[aria-label="Switch to source view"]');
  await waitForSource(
    tauriPage,
    (source) => !source.includes("\\footnote{note text}"),
    "toolbar undo did not remove the WYSIWYG insertion",
  );
  expect((await compileAndProbe(tauriPage)).text).not.toContain("note text");

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await tauriPage.click('[aria-label^="Redo ("]');
  await tauriPage.click('[aria-label="Switch to source view"]');
  await waitForSource(
    tauriPage,
    (source) => source.includes("\\footnote{note text}"),
    "toolbar redo did not restore the WYSIWYG insertion",
  );
  expect((await compileAndProbe(tauriPage)).text).toContain("note text");

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await selectWysiwygText(tauriPage, "WYSKEYBOARDSEMANTIC");
  await clickToolbarControl(tauriPage, '[aria-label^="Bold ("]', "Bold");
  await tauriPage.press(".ProseMirror", "Control+z");
  await tauriPage.click('[aria-label="Switch to source view"]');
  await waitForSource(
    tauriPage,
    (source) => !source.includes("\\textbf{WYSKEYBOARDSEMANTIC}"),
    "Ctrl-Z did not undo WYSIWYG bold",
  );

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await tauriPage.press(".ProseMirror", "Control+Shift+z");
  await tauriPage.click('[aria-label="Switch to source view"]');
  await waitForSource(
    tauriPage,
    (source) => source.includes("\\textbf{WYSKEYBOARDSEMANTIC}"),
    "Ctrl-Shift-Z did not redo WYSIWYG bold",
  );
  const probe = await compileAndProbe(tauriPage);
  expect(probe.text).toContain("WYSKEYBOARDSEMANTIC");
});

test("WYSIWYG toolbar formatting serializes to LaTeX and renders semantically", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await freshLatex(
    tauriPage,
    "WYSIWYG",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[hidelinks]{hyperref}
\begin{document}
WYSREGULAR

WYSBOLD

WYSITALIC

WYSCODE

WYSSECTION

WYSSUBSECTION

WYSSUBSUBSECTION

WYSBULLET

WYSNUMBER

WYSQUOTE
\end{document}
`,
  );
  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });

  await selectWysiwygText(tauriPage, "WYSBOLD");
  await clickToolbarControl(tauriPage, '[aria-label^="Bold ("]', "Bold");
  await selectWysiwygText(tauriPage, "WYSITALIC");
  await clickToolbarControl(tauriPage, '[aria-label^="Italic ("]', "Italic");
  await selectWysiwygText(tauriPage, "WYSCODE");
  await clickToolbarControl(tauriPage, '[aria-label="Inline code"]', "Inline code");
  await selectWysiwygText(tauriPage, "WYSSECTION");
  await clickToolbarControl(tauriPage, '[aria-label="Heading level"]', "Heading");
  await tauriPage.getByText("Section", { exact: true }).click();
  await selectWysiwygText(tauriPage, "WYSSUBSECTION");
  await clickToolbarControl(tauriPage, '[aria-label="Heading level"]', "Heading");
  await tauriPage.getByText("Subsection", { exact: true }).click();
  await selectWysiwygText(tauriPage, "WYSSUBSUBSECTION");
  await clickToolbarControl(tauriPage, '[aria-label="Heading level"]', "Heading");
  await tauriPage.getByText("Subsubsection", { exact: true }).click();
  await selectWysiwygText(tauriPage, "WYSBULLET");
  await clickToolbarControl(tauriPage, '[aria-label="Insert list"]', "List");
  await clickPortalButton(
    tauriPage,
    `candidate.textContent?.trim() === "Bulleted list"
      || Array.from(candidate.querySelectorAll("span")).some((s) => s.textContent?.trim() === "Bulleted list")`,
    "Bulleted list",
  );
  await selectWysiwygText(tauriPage, "WYSNUMBER");
  await clickToolbarControl(tauriPage, '[aria-label="Insert list"]', "List");
  await clickPortalButton(
    tauriPage,
    `candidate.textContent?.trim() === "Numbered list"
      || Array.from(candidate.querySelectorAll("span")).some((s) => s.textContent?.trim() === "Numbered list")`,
    "Numbered list",
  );
  await selectWysiwygText(tauriPage, "WYSQUOTE");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert blockquote"]',
    "Insert blockquote",
  );

  await tauriPage.click('[aria-label="Switch to source view"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
  const deadline = Date.now() + 10_000;
  let source = "";
  do {
    source = await editorSource(tauriPage);
    if (
      source.includes("\\textbf{WYSBOLD}") &&
      source.includes("\\begin{quote}")
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);

  expect(source).toContain("\\textbf{WYSBOLD}");
  expect(source).toContain("\\textit{WYSITALIC}");
  expect(source).toContain("\\texttt{WYSCODE}");
  expect(source).toContain("\\section{WYSSECTION}");
  expect(source).toContain("\\subsection{WYSSUBSECTION}");
  expect(source).toContain("\\subsubsection{WYSSUBSUBSECTION}");
  expect(source).toContain("\\begin{itemize}");
  expect(source).toContain("\\item WYSBULLET");
  expect(source).toContain("\\begin{enumerate}");
  expect(source).toContain("\\item WYSNUMBER");
  expect(source).toContain("\\begin{quote}");

  const probe = await compileAndProbe(tauriPage);
  for (const token of [
    "WYSREGULAR",
    "WYSBOLD",
    "WYSITALIC",
    "WYSCODE",
    "WYSSECTION",
    "WYSSUBSECTION",
    "WYSSUBSUBSECTION",
    "WYSBULLET",
    "WYSNUMBER",
    "WYSQUOTE",
  ]) {
    expect(probe.text).toContain(token);
  }
  expect(probe.outline).toEqual(
    expect.arrayContaining([
      "WYSSECTION",
      "WYSSUBSECTION",
      "WYSSUBSUBSECTION",
    ]),
  );
  const regular = itemContaining(probe, "WYSREGULAR");
  expect(fontIdentity(itemContaining(probe, "WYSBOLD"))).not.toBe(
    fontIdentity(regular),
  );
  expect(fontIdentity(itemContaining(probe, "WYSITALIC"))).not.toBe(
    fontIdentity(regular),
  );
  expect(fontIdentity(itemContaining(probe, "WYSCODE"))).not.toBe(
    fontIdentity(regular),
  );
  expect(itemContaining(probe, "WYSQUOTE").x).toBeGreaterThan(regular.x + 5);
});

test("every raw-backed WYSIWYG formatting branch serializes and compiles after placeholder entry", async ({
  tauriPage,
}) => {
  test.setTimeout(500_000);
  await freshLatex(
    tauriPage,
    "WYSIWYG raw branches",
    String.raw`\documentclass{book}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage[hidelinks]{hyperref}
\begin{document}
\label{label}
WYSRAWANCHOR
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`,
  );
  await writeProjectBinary(tauriPage, "visual.png", RED_PNG);
  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });

  const atAnchor = async () => {
    await selectWysiwygText(tauriPage, "WYSRAWANCHOR");
    await collapseWysiwygSelectionToEnd(tauriPage);
  };
  const rawAction = async (selector: string, menuLabel: string) => {
    await atAnchor();
    await clickToolbarControl(tauriPage, selector, menuLabel);
  };
  const rawHeading = async (label: "Part" | "Chapter" | "Paragraph") => {
    await atAnchor();
    await clickToolbarControl(
      tauriPage,
      '[aria-label="Heading level"]',
      "Heading",
    );
    await clickPortalButton(
      tauriPage,
      `candidate.textContent?.trim() === ${JSON.stringify(label)}
        || Array.from(candidate.querySelectorAll("span")).some((s) => s.textContent?.trim() === ${JSON.stringify(label)})`,
      label,
    );
  };

  // Insert in reverse structural order because every deterministic caret is
  // immediately after the same anchor.
  await rawHeading("Paragraph");
  await rawHeading("Chapter");
  await rawHeading("Part");
  await rawAction('[aria-label="Underline"]', "Underline");
  await rawAction('[aria-label="Insert link"]', "Insert link");
  await rawAction(
    '[aria-label="Insert cross-reference"]',
    "Insert cross-reference",
  );
  await rawAction('[aria-label="Insert footnote"]', "Insert footnote");

  await atAnchor();
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Add citation (DOI, arXiv, or title)"]',
    "Add citation",
  );
  await expect(
    tauriPage.locator(
      'input[placeholder="DOI, arXiv id, URL, or a paper title…"]',
    ),
  ).toBeVisible({ timeout: 5_000 });
  const citation = await tauriPage.evaluate<{ key?: string; error?: string }>(
    `Promise.all([
      import("/src/features/citation.ts"),
      import("/src/store/citation.ts"),
    ]).then(async ([{ addCitation }, { useCitationStore }]) => {
      const result = await addCitation(${JSON.stringify(String.raw`@article{visualfixture,
  author = {Hopper, Grace},
  title = {{VISUALCITATIONSEMANTIC}},
  year = {2026}
}`)});
      useCitationStore.getState().setOpen(false);
      return result;
    })`,
  );
  expect(citation.error).toBeUndefined();
  expect(citation.key).toBeTruthy();

  await rawAction('[aria-label="Insert figure"]', "Insert figure");

  await atAnchor();
  await clickToolbarControl(tauriPage, '[aria-label="Insert table"]', "Table");
  await clickPortalButton(tauriPage, `candidate.getAttribute("aria-label") === "1 by 1 table"`, "1 by 1 table");

  await rawAction(
    '[aria-label="Insert align environment"]',
    "Align environment",
  );
  await rawAction(
    '[aria-label="Insert equation environment"]',
    "Equation environment",
  );
  await rawAction('[aria-label="Insert fraction"]', "Fraction");

  await atAnchor();
  await clickToolbarControl(tauriPage, '[aria-label="Insert symbol"]', "Symbols");
  await clickPortalButton(
    tauriPage,
    `candidate.textContent?.trim() === "Misc"
      || Array.from(candidate.querySelectorAll("span")).some((s) => s.textContent?.trim() === "Misc")`,
    "Misc",
  );
  await clickPortalButton(tauriPage, `candidate.getAttribute("title") === "hash"`, "hash symbol");

  await tauriPage.click('[aria-label="Word count"]');
  await expect(tauriPage.getByText("Words", { exact: true })).toBeVisible();
  await tauriPage.press("body", "Escape");
  await tauriPage.click('[aria-label="Switch to source view"]');

  await waitForSource(
    tauriPage,
    (source) =>
      source.includes("\\part{Part Title}") &&
      source.includes("\\begin{table}") &&
      source.includes("\\frac{numerator}{denominator}") &&
      source.includes(`\\cite{${citation.key}}`) &&
      source.includes("\\#"),
    "raw-backed WYSIWYG actions did not serialize",
  );
  await replaceEditorLiteral(
    tauriPage,
    "\\underline{text}",
    "\\underline{VISUALUNDERLINE}",
  );
  await replaceEditorLiteral(
    tauriPage,
    "\\href{url}{link text}",
    "\\href{https://example.com/visual}{VISUALLINK}",
  );
  await replaceEditorLiteral(
    tauriPage,
    "\\footnote{note text}",
    "\\footnote{VISUALFOOTNOTE}",
  );
  await replaceEditorLiteral(tauriPage, "image-filename", "visual.png");
  await replaceEditorLiteral(
    tauriPage,
    "Caption text",
    "VISUALFIGCAPTION",
  );
  await replaceEditorLiteral(
    tauriPage,
    "\\caption{}",
    "\\caption{VISUALTABLECAPTION}",
  );
  // insertEnvironment (both CM and WYSIWYG raw-block paths) leaves a
  // two-space caret line between begin/end, so the literal must include it.
  await replaceEditorLiteral(
    tauriPage,
    "\\begin{align}\n  \n\\end{align}",
    String.raw`\begin{align}
  \mathrm{VISUALALIGN} &= 7
\end{align}`,
  );
  await replaceEditorLiteral(
    tauriPage,
    "\\begin{equation}\n  \n\\end{equation}",
    String.raw`\begin{equation}
  \mathrm{VISUALEQUATION} = 8
\end{equation}`,
  );
  await replaceEditorLiteral(
    tauriPage,
    String.raw`\frac{numerator}{denominator}`,
    String.raw`$\frac{\mathrm{VISUALNUMERATOR}}{\mathrm{VISUALDENOMINATOR}}$`,
  );

  const source = await editorSource(tauriPage);
  expect(await readProjectText(tauriPage, "references.bib")).toContain(
    "VISUALCITATIONSEMANTIC",
  );
  for (const expected of [
    "\\part{Part Title}",
    "\\chapter{Chapter Title}",
    "\\paragraph{Paragraph Title}",
    "\\ref{label}",
    "\\begin{figure}",
    "\\begin{table}",
    "\\begin{align}",
    "\\begin{equation}",
    "\\#",
  ]) {
    expect(source).toContain(expected);
  }

  const probe = await compileAndProbe(tauriPage);
  const compactText = probe.text.replace(/\s+/g, "");
  for (const token of [
    "Part Title",
    "Chapter Title",
    "Paragraph Title",
    "VISUALUNDERLINE",
    "VISUALLINK",
    "VISUALFOOTNOTE",
    "VISUALFIGCAPTION",
    "VISUALTABLECAPTION",
    "VISUALALIGN",
    "VISUALEQUATION",
    "VISUALNUMERATOR",
    "VISUALDENOMINATOR",
    "VISUALCITATIONSEMANTIC",
    "#",
  ]) {
    expect(compactText).toContain(token.replace(/\s+/g, ""));
  }
});
