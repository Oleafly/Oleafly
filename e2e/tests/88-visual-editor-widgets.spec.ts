import { readFileSync } from "node:fs";
import { test, expect } from "../fixtures";
import {
  clickToolbarControl,
  compileAndWait,
  createBlankProject,
  editorSource,
  expectCompiledPdfContains,
  fillTextarea,
  listProjectEntries,
  replaceEditorSource,
  writeProjectBinary,
  type Page,
} from "../helpers";

test.describe.configure({ timeout: 240_000 });

const RUN = Date.now().toString(36);
const FIXTURE_PNG = readFileSync(
  new URL("../../src-tauri/resources/templates/blank/preview.png", import.meta.url),
).toString("base64");
const PREAMBLE = String.raw`\usepackage[T1]{fontenc}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{xcolor}
\usepackage{amsmath}
`;
const PASTED_IMAGE = /pasted-image-\d{8}-\d{6}\.png/u;

async function freshDocument(
  page: Page,
  suffix: string,
  body: string,
  options: { documentClass?: string; preamble?: string } = {},
) {
  await createBlankProject(page, `E2E Visual ${suffix} ${RUN}`);
  await page.waitForFunction(
    `import("/src/store/compile.ts").then(({ useCompileStore }) => {
      const compile = useCompileStore.getState();
      return compile.status === "success" && compile.lastCompileCheckpoint !== null;
    })`,
    120_000,
  );
  await replaceEditorSource(
    page,
    `\\documentclass{${options.documentClass ?? "article"}}\n${PREAMBLE}${options.preamble ?? ""}\\begin{document}\n${body}\n\\end{document}\n`,
  );
}

async function commitSourceEditor(page: Page, selector: string) {
  await page.evaluate(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("commitSourceEditor: not found: " + ${JSON.stringify(selector)});
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
      return 1;
    })()`,
  );
}

async function openFigureDialog(page: Page) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.press("body", "Escape").catch(() => {});
    await caretAfter(page, "Body.");
    await clickToolbarControl(page, '[aria-label="Insert figure"]', "Insert figure");
    try {
      await expect(page.locator('[data-testid="figure-dialog"]')).toBeVisible({ timeout: 5_000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("figure dialog never opened");
}

async function selectFirstHeaderCell(page: Page) {
  await page.evaluate(
    `import("/src/components/editor/wysiwyg/controller.ts").then(({ getWysiwygEditor }) => {
      const editor = getWysiwygEditor();
      if (!editor) throw new Error("visual editor is not mounted");
      let header = null;
      editor.state.doc.descendants((node, pos) => {
        if (header === null && node.type.name === "tableHeader") header = pos;
        return header === null;
      });
      if (header === null) throw new Error("the table has no header cell");
      editor.chain().focus().setTextSelection(header + 2).run();
      return true;
    })`,
  );
}

async function typeIntoTableCaption(page: Page, text: string) {
  await page.evaluate(
    `import("/src/components/editor/wysiwyg/controller.ts").then(({ getWysiwygEditor }) => {
      const editor = getWysiwygEditor();
      if (!editor) throw new Error("visual editor is not mounted");
      let caption = null;
      editor.state.doc.descendants((node, pos) => {
        if (caption === null && node.type.name === "tableCaption") caption = pos;
        return caption === null;
      });
      if (caption === null) throw new Error("the table has no caption node");
      editor.chain().focus().setTextSelection(caption + 1).run();
      return document.execCommand("insertText", false, ${JSON.stringify(text)});
    })`,
  );
}

async function visualHtml(page: Page): Promise<string> {
  return page.evaluate<string>(`document.querySelector(".ProseMirror")?.innerHTML ?? ""`);
}

async function openVisual(page: Page) {
  await page.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });
}

async function visualSource(page: Page): Promise<string> {
  return page.evaluate<string>(
    `Promise.all([
      import("/src/components/editor/wysiwyg/controller.ts"),
      import("/src/store/files.ts"),
    ]).then(([{ flushWysiwygPendingEdits }, { useFilesStore }]) => {
      flushWysiwygPendingEdits();
      const state = useFilesStore.getState();
      return state.activePath ? (state.files[state.activePath]?.content ?? "") : "";
    })`,
  );
}

async function selectVisualText(page: Page, text: string) {
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
  if (!selected) throw new Error(`visual text not found: ${text}`);
}

async function collapseVisualSelectionToEnd(page: Page) {
  const collapsed = await page.evaluate<boolean>(
    `import("/src/components/editor/wysiwyg/controller.ts").then(({ getWysiwygEditor }) => {
      const editor = getWysiwygEditor();
      if (!editor) return false;
      editor.chain().focus().setTextSelection(editor.state.selection.to).run();
      return true;
    })`,
  );
  if (!collapsed) throw new Error("visual editor is unavailable");
}

async function caretAfter(page: Page, text: string) {
  await selectVisualText(page, text);
  await collapseVisualSelectionToEnd(page);
}

async function refreshTree(page: Page) {
  await page.evaluate<boolean>(
    `import("/src/store/files.ts").then(({ useFilesStore }) =>
      useFilesStore.getState().refreshTree().then(() => true))`,
  );
}

async function storeTreeHasPastedImage(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(
    `import("/src/store/files.ts").then(({ useFilesStore }) =>
      useFilesStore.getState().tree.some((entry) => ${PASTED_IMAGE}.test(entry.path)))`,
  );
}

function pasteExpression(selector: string, entries: Record<string, string>, pngBase64: string | null): string {
  const fileLine = pngBase64
    ? `files.push(new File([Uint8Array.from(atob(${JSON.stringify(pngBase64)}), (c) => c.charCodeAt(0))], "image.png", { type: "image/png" }));`
    : "";
  return `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    const entries = ${JSON.stringify(entries)};
    const files = [];
    ${fileLine}
    const clipboardData = {
      types: [...Object.keys(entries), ...(files.length ? ["Files"] : [])],
      files,
      items: [],
      getData: (type) => entries[type] ?? "",
    };
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  })()`;
}

async function insertVisualTable2By2(page: Page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.press("body", "Escape").catch(() => {});
    await caretAfter(page, "Body.");
    await clickToolbarControl(page, '[aria-label="Insert table"]', "Table");
    const clicked = await page
      .waitForFunction(
        `(() => {
          const cell = document.querySelector('[aria-label="2 by 2 table"]');
          if (!(cell instanceof HTMLElement)) return false;
          cell.scrollIntoView({ block: "nearest" });
          cell.click();
          return true;
        })()`,
        3_000,
      )
      .then(() => true)
      .catch(() => false);
    if (!clicked) continue;
    const inserted = await page
      .waitForFunction(`!!document.querySelector('[data-type="table-float"] table')`, 3_000)
      .then(() => true)
      .catch(() => false);
    if (inserted) return;
  }
  throw new Error("2 by 2 visual table picker never inserted a table");
}

test("inline and display math render with KaTeX and edit in place", async ({ tauriPage }) => {
  await freshDocument(
    tauriPage,
    "math",
    String.raw`Inline $a^2+b^2$ stays.

\begin{equation}
  E = mc^2
\end{equation}
`,
  );
  await openVisual(tauriPage);
  await expect(tauriPage.locator('[data-type="math-inline"] .math-rendered .katex').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(tauriPage.locator('[data-type="math-display"] .math-rendered .katex').first()).toBeVisible({
    timeout: 20_000,
  });

  await tauriPage.click('[data-type="math-inline"] .math-rendered');
  const inlineInput = '[data-type="math-inline"][data-math-editing="true"] input.math-input';
  await expect(tauriPage.locator(inlineInput)).toBeVisible();
  await tauriPage.fill(inlineInput, "$c^2$");
  await tauriPage.press(inlineInput, "Enter");
  await expect.poll(() => visualSource(tauriPage), { timeout: 10_000 }).toContain("Inline $c^2$ stays.");

  await tauriPage.click('[data-type="math-display"] .math-rendered');
  const displayInput = '[data-type="math-display"][data-math-editing="true"] textarea.math-input';
  await expect(tauriPage.locator(displayInput)).toBeVisible();
  await fillTextarea(tauriPage, displayInput, "\\begin{equation}\n  E = 2\n\\end{equation}");
  await commitSourceEditor(tauriPage, displayInput);
  await expect.poll(() => visualSource(tauriPage), { timeout: 10_000 }).toContain("E = 2");
  await expect(tauriPage.locator('[data-type="math-display"] .math-rendered .katex').first()).toBeVisible();
});

test("part and chapter headings render natively, reach subparagraph and round-trip", async ({ tauriPage }) => {
  await freshDocument(
    tauriPage,
    "headings",
    String.raw`\part{Opening}
\chapter{First}
\section{Intro}
Body text.
`,
    { documentClass: "book" },
  );
  await openVisual(tauriPage);
  await expect(tauriPage.locator('h1[data-command="part"]')).toHaveText("Opening");
  await expect(tauriPage.locator('h1[data-command="chapter"]')).toHaveText("First");
  await selectVisualText(tauriPage, "Body text.");
  await clickToolbarControl(tauriPage, '[aria-label="Heading level"]', "Heading");
  await tauriPage.getByText("Subparagraph", { exact: true }).click();
  await expect(tauriPage.locator('h5[data-command="subparagraph"]')).toHaveText("Body text.");
  await expect.poll(() => visualSource(tauriPage), { timeout: 10_000 }).toContain("\\subparagraph{Body text.}");
  const source = await visualSource(tauriPage);
  expect(source).toContain("\\part{Opening}");
  expect(source).toContain("\\chapter{First}");
  expect(source).toContain("\\section{Intro}");
});

test("footnote markers open an editor that commits the new text", async ({ tauriPage }) => {
  await freshDocument(tauriPage, "footnote", String.raw`Text\footnote{A note} end.`);
  await openVisual(tauriPage);
  await tauriPage.click(".footnote-marker");
  const input = '[data-footnote-editing="true"] textarea.footnote-input';
  await expect(tauriPage.locator(input)).toBeVisible();
  await expect(tauriPage.locator(input)).toHaveValue("A note");
  await fillTextarea(tauriPage, input, "Changed note");
  await commitSourceEditor(tauriPage, input);
  await expect.poll(() => visualSource(tauriPage), { timeout: 10_000 }).toContain("\\footnote{Changed note}");
});

test("theorem headers show name and title, and text colours render", async ({ tauriPage }) => {
  await freshDocument(
    tauriPage,
    "theorem",
    String.raw`\begin{theorem}[Main]
Claim body.
\end{theorem}

Warm \textcolor{red}{alert} text.
`,
    { preamble: "\\newtheorem{theorem}{Theorem}\n" },
  );
  await openVisual(tauriPage);
  const theorem = tauriPage.locator('[data-type="theorem"][data-environment="theorem"]');
  await expect(theorem.locator(".theorem-name")).toHaveText("Theorem");
  await expect(theorem.locator(".theorem-title")).toHaveText("(Main)");
  await expect(theorem.locator(".theorem-body")).toContainText("Claim body.");
  await expect(tauriPage.locator('span[data-text-color="red"]')).toHaveText("alert");
  const color = await tauriPage.evaluate<string>(
    `(() => {
      const element = document.querySelector('span[data-text-color="red"]');
      return element ? getComputedStyle(element).color : "";
    })()`,
  );
  expect(color).toBe("rgb(255, 0, 0)");
});

test("the figure dialog inserts a project image that compiles", async ({ tauriPage }) => {
  await freshDocument(tauriPage, "figure", "Body.\n");
  await writeProjectBinary(tauriPage, "plot.png", FIXTURE_PNG);
  await refreshTree(tauriPage);
  await openVisual(tauriPage);
  await openFigureDialog(tauriPage);
  await tauriPage.click('[data-testid="figure-dialog-image"][data-path="plot.png"]');
  await tauriPage.click('[data-testid="figure-dialog-width-full"]');
  await tauriPage.fill('[data-testid="figure-dialog-caption"]', "Plot caption");
  await expect(tauriPage.locator('[data-testid="figure-dialog-label"]')).toHaveValue("fig:plot");
  await tauriPage.click('[data-testid="figure-dialog-insert"]');

  const image = tauriPage.locator('[data-type="figure"] img.figure-image');
  await expect(image).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => image.getAttribute("src")).toMatch(/^data:image\/png/u);
  await expect
    .poll(() => visualSource(tauriPage), { timeout: 10_000 })
    .toContain("\\includegraphics[width=\\linewidth]{plot.png}");
  const source = await visualSource(tauriPage);
  expect(source).toContain("\\caption{Plot caption}");
  expect(source).toContain("\\label{fig:plot}");

  await tauriPage.click('[aria-label="Switch to source view"]');
  await compileAndWait(tauriPage);
  await expectCompiledPdfContains(tauriPage, "Plot caption");
});

test("a pasted PNG is written to the project and inserted as a figure", async ({ tauriPage }) => {
  await freshDocument(tauriPage, "paste image", "Body.\n");
  await openVisual(tauriPage);
  await caretAfter(tauriPage, "Body.");
  const handled = await tauriPage.evaluate<boolean>(pasteExpression(".ProseMirror", {}, FIXTURE_PNG));
  expect(handled).toBe(true);
  await expect(tauriPage.locator('[data-type="figure"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => storeTreeHasPastedImage(tauriPage), { timeout: 20_000 }).toBe(true);
  await expect
    .poll(
      async () => (await listProjectEntries(tauriPage)).some((entry) => PASTED_IMAGE.test(entry.path)),
      { timeout: 20_000 },
    )
    .toBe(true);
  await expect
    .poll(() => visualSource(tauriPage), { timeout: 10_000 })
    .toMatch(/\\includegraphics\[width=0\.8\\linewidth\]\{pasted-image-\d{8}-\d{6}\.png\}/u);
  await expect(tauriPage.locator('[data-type="figure"] img.figure-image')).toBeVisible({ timeout: 20_000 });
});

test("the size picker inserts a native table that the toolbar edits", async ({ tauriPage }) => {
  await freshDocument(tauriPage, "table", "Body.\n");
  await openVisual(tauriPage);
  await insertVisualTable2By2(tauriPage);
  await expect(tauriPage.locator('[data-testid="wysiwyg-table-toolbar"]')).toBeVisible();
  await selectFirstHeaderCell(tauriPage);
  await tauriPage.click('[aria-label="Insert row below"]');
  await selectFirstHeaderCell(tauriPage);
  await tauriPage.click('[aria-label="Insert column right"]');
  await selectFirstHeaderCell(tauriPage);
  await tauriPage.selectOption('[data-testid="wysiwyg-table-toolbar"] select[aria-label="Borders"]', "booktabs");
  await expect.poll(() => visualHtml(tauriPage), { timeout: 10_000 }).toContain('data-type="table-caption"');
  await typeIntoTableCaption(tauriPage, "Table caption");
  await expect.poll(() => visualHtml(tauriPage), { timeout: 10_000 }).toContain("Table caption");
  const label = '[data-testid="wysiwyg-table-toolbar"] input[aria-label="Label"]';
  await tauriPage.fill(label, "tab:main");
  await tauriPage.press(label, "Enter");

  await expect.poll(() => visualSource(tauriPage), { timeout: 10_000 }).toContain("\\label{tab:main}");
  const source = await visualSource(tauriPage);
  expect(source).toContain("\\begin{tabular}{lll}");
  expect(source.match(/\\\\/gu)).toHaveLength(3);
  expect(source).toContain("\\toprule");
  expect(source).toContain("\\midrule");
  expect(source).toContain("\\bottomrule");
  expect(source).toContain("\\caption{Table caption}");

  await tauriPage.click('[aria-label="Switch to source view"]');
  await compileAndWait(tauriPage);
  await expectCompiledPdfContains(tauriPage, "Table caption");
});

test("pasted HTML becomes native formatting, lists and tables", async ({ tauriPage }) => {
  await freshDocument(tauriPage, "paste html", "Body.\n");
  await openVisual(tauriPage);
  await caretAfter(tauriPage, "Body.");
  const html =
    "<p><b>Bold words</b></p><ul><li>First item</li><li>Second item</li></ul><table><tr><th>Head</th><th>Two</th></tr><tr><td>c1</td><td>c2</td></tr></table>";
  const handled = await tauriPage.evaluate<boolean>(
    pasteExpression(
      ".ProseMirror",
      { "text/html": html, "text/plain": "Bold words\nFirst item\nSecond item\nHead Two\nc1 c2" },
      null,
    ),
  );
  expect(handled).toBe(true);
  await expect(tauriPage.locator(".ProseMirror strong")).toHaveText("Bold words");
  await expect(tauriPage.locator(".ProseMirror ul li")).toHaveCount(2);
  await expect(tauriPage.locator('[data-type="table-float"] table')).toBeVisible();
  await expect.poll(() => visualSource(tauriPage), { timeout: 10_000 }).toContain("\\textbf{Bold words}");
  const source = await visualSource(tauriPage);
  expect(source).toContain("\\begin{itemize}");
  expect(source).toContain("\\item First item");
  expect(source).toContain("\\begin{tabular}");
  expect(source).toContain("\\textbf{Head}");
});

test("pasting a PNG into the source editor inserts a figure snippet", async ({ tauriPage }) => {
  await freshDocument(tauriPage, "source paste", "Body.\n");
  await tauriPage.click(".cm-content");
  const handled = await tauriPage.evaluate<boolean>(pasteExpression(".cm-content", {}, FIXTURE_PNG));
  expect(handled).toBe(true);
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 20_000 })
    .toMatch(/\\includegraphics\[width=0\.8\\linewidth\]\{pasted-image-\d{8}-\d{6}\.png\}/u);
  const source = await editorSource(tauriPage);
  expect(source).toContain("\\caption{}");
  expect(source).toMatch(/\\label\{fig:pasted-image-\d{8}-\d{6}\}/u);
});
