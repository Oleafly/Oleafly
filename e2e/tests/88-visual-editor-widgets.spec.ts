import { readFileSync } from "node:fs";
import { test, expect } from "../fixtures";
import {
  clickToolbarControl,
  compileAndWait,
  createBlankProject,
  editorSource,
  expectCompiledPdfContains,
  replaceEditorLiteral,
  replaceEditorSource,
  selectEditorText,
  setEditorCaretAfter,
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

async function openVisual(page: Page) {
  await page.click('[aria-label="Switch to WYSIWYG view"]');
  await page.waitForFunction(
    `import("/src/store/visual-mode.ts").then(
      ({ useVisualModeStore }) => useVisualModeStore.getState().enabled === true
    )`,
    10_000,
  );
  await expect(page.locator(".cm-content .ofl-visual-end-document")).toBeVisible({
    timeout: 20_000,
  });
}

async function openSource(page: Page) {
  await page.click('[aria-label="Switch to source view"]');
  await page.waitForFunction(
    `import("/src/store/visual-mode.ts").then(
      ({ useVisualModeStore }) => useVisualModeStore.getState().enabled === false
    )`,
    10_000,
  );
}

async function refreshTree(page: Page) {
  await page.evaluate<boolean>(
    `import("/src/store/files.ts").then(({ useFilesStore }) =>
      useFilesStore.getState().refreshTree().then(() => true))`,
  );
}

async function pressElement(page: Page, selector: string) {
  await page.evaluate(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error("element is unavailable: " + ${JSON.stringify(selector)});
      const options = { bubbles: true, cancelable: true, button: 0, detail: 1 };
      element.dispatchEvent(new MouseEvent("mousedown", options));
      element.dispatchEvent(new MouseEvent("mouseup", options));
      element.dispatchEvent(new MouseEvent("click", options));
      return 1;
    })()`,
  );
}

async function lineTextAt(page: Page, needle: string): Promise<string> {
  return page.evaluate<string>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return "";
      const at = view.state.doc.toString().indexOf(${JSON.stringify(needle)});
      if (at < 0) return "";
      const line = view.state.doc.lineAt(at);
      const block = view.domAtPos(line.from).node;
      const element = block instanceof Element ? block : block.parentElement;
      return element?.closest(".cm-line")?.textContent ?? "";
    })`,
  );
}

async function breadcrumbTrail(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `Array.from(
      document.querySelectorAll('[data-testid="editor-breadcrumbs"] button'),
      (button) => button.textContent?.trim() ?? "",
    )`,
  );
}

test("visual mode renders the document and reveals the source under the cursor", async ({
  tauriPage,
}) => {
  await freshDocument(
    tauriPage,
    "render",
    String.raw`\section{Widgets}
Inline $a^2+b^2$ stays put.

\begin{equation}
  E = mc^2
\end{equation}

A note\footnote{A footnote} and \textcolor{red}{alert} text.

\begin{theorem}[Main]
Claim body.
\end{theorem}
`,
    { preamble: "\\newtheorem{theorem}{Theorem}\n" },
  );
  await openVisual(tauriPage);

  const content = tauriPage.locator(".cm-content");
  await expect(content.locator(".ofl-visual-heading").first()).toHaveText("Widgets");
  await expect(content.locator(".ofl-visual-math-inline .katex").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(content.locator(".ofl-visual-math .katex").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(content.locator(".ofl-visual-footnote").first()).toBeVisible();
  await expect(content.locator(".ofl-visual-begin-theorem").first()).toContainText("Theorem (Main)");
  await expect(content.locator(".ofl-visual-theorem-title").first()).toHaveText("Main");
  await expect(content.locator(".ofl-visual-textcolor").first()).toHaveText("alert");
  await expect(content.locator(".ofl-visual-end-document")).toBeVisible();

  const colour = await tauriPage.evaluate<string>(
    `(() => {
      const element = document.querySelector(".cm-content .ofl-visual-textcolor");
      return element ? getComputedStyle(element).color : "";
    })()`,
  );
  expect(colour).toBe("rgb(255, 0, 0)");

  await expect.poll(() => breadcrumbTrail(tauriPage), { timeout: 10_000 }).toEqual(["Widgets"]);
});

test("moving the cursor into a heading shows its command and the edit lands in the file", async ({
  tauriPage,
}) => {
  await freshDocument(
    tauriPage,
    "reveal",
    String.raw`\section{Widgets}
Body text.
`,
  );
  await openVisual(tauriPage);
  await expect(tauriPage.locator(".cm-content .ofl-visual-heading").first()).toHaveText("Widgets");

  await setEditorCaretAfter(tauriPage, "Widgets");
  await expect
    .poll(() => lineTextAt(tauriPage, "\\section{Widgets}"), { timeout: 10_000 })
    .toBe("{Widgets}");

  await replaceEditorLiteral(tauriPage, "Widgets", "Rendering");
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\section{Rendering}");

  await setEditorCaretAfter(tauriPage, "Body text.");
  await expect
    .poll(() => lineTextAt(tauriPage, "\\section{Rendering}"), { timeout: 10_000 })
    .toBe("Rendering");
});

test("the preamble and the end of the document collapse into their own bars", async ({
  tauriPage,
}) => {
  await freshDocument(tauriPage, "bars", "Body.\n");
  await openVisual(tauriPage);

  const preamble = tauriPage.locator(".cm-content .ofl-visual-preamble-widget");
  await expect(preamble).toBeVisible();
  await expect(preamble).toContainText("Show document preamble");
  await pressElement(tauriPage, ".cm-content .ofl-visual-preamble-widget");
  await expect(preamble).toContainText("Hide document preamble");
  await expect(tauriPage.locator(".cm-content .ofl-visual-preamble-expanded")).toBeVisible();

  await pressElement(tauriPage, ".cm-content .ofl-visual-preamble-widget");
  await expect(preamble).toContainText("Show document preamble");

  const end = tauriPage.locator(".cm-content .ofl-visual-end-document");
  await expect(end).toContainText("End of document");
  await setEditorCaretAfter(tauriPage, "\\end{document}");
  await expect
    .poll(() => lineTextAt(tauriPage, "\\end{document}"), { timeout: 10_000 })
    .toContain("\\end{document}");
});

test("a tabular renders as a grid whose toolbar edits the source", async ({ tauriPage }) => {
  await freshDocument(
    tauriPage,
    "table",
    String.raw`\begin{table}[htbp]
  \centering
  \caption{Table caption}
  \begin{tabular}{ll}
    a & b \\
    c & d \\
  \end{tabular}
\end{table}
`,
  );
  await openVisual(tauriPage);

  const cell = ".cm-content .ofl-visual-table-grid .ofl-visual-table-cell-text";
  await expect
    .poll(
      () => tauriPage.evaluate<string>(`document.querySelector(${JSON.stringify(cell)})?.textContent ?? ""`),
      { timeout: 20_000 },
    )
    .toBe("a");

  await pressElement(tauriPage, cell);
  await expect(tauriPage.locator(".ofl-visual-table-toolbar")).toBeVisible({ timeout: 10_000 });
  await tauriPage.click('.ofl-visual-table-toolbar [aria-label="Insert"]');
  await tauriPage.waitForFunction(
    `(() => {
      const item = Array.from(document.querySelectorAll('.ofl-visual-table-menu [role="menuitem"]')).find(
        (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent ?? "").trim() === "Insert row below",
      );
      if (!(item instanceof HTMLElement)) return false;
      item.click();
      return true;
    })()`,
    10_000,
  );
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 10_000 })
    .toMatch(/(\\\\[\s\S]*){3}/u);

  await openSource(tauriPage);
  await compileAndWait(tauriPage);
  await expectCompiledPdfContains(tauriPage, "Table caption");
});

test("a project image renders in place and the edit button reopens the figure dialog", async ({
  tauriPage,
}) => {
  await freshDocument(
    tauriPage,
    "figure",
    String.raw`\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.5\linewidth]{plot.png}
  \caption{Plot caption}
  \label{fig:plot}
\end{figure}
`,
  );
  await writeProjectBinary(tauriPage, "plot.png", FIXTURE_PNG);
  await refreshTree(tauriPage);
  await openVisual(tauriPage);

  const image = tauriPage.locator(".cm-content .ofl-visual-graphics-image").first();
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => image.getAttribute("src")).toMatch(/^data:image\/png/u);

  await tauriPage.evaluate(
    `(() => {
      const host = document.querySelector(".cm-content .ofl-visual-graphics");
      host?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      const button = document.querySelector(".cm-content .ofl-visual-graphics-edit");
      if (!(button instanceof HTMLElement)) throw new Error("graphics edit button is unavailable");
      button.click();
      return 1;
    })()`,
  );
  await expect(tauriPage.locator('[data-testid="figure-dialog"]')).toBeVisible({ timeout: 10_000 });
  await tauriPage.click('[data-testid="figure-dialog-width-full"]');
  await tauriPage.click('[data-testid="figure-dialog-insert"]');
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\includegraphics[width=\\linewidth]{plot.png}");
});

test("Windows resolves image references with different filename casing", async ({ tauriPage }) => {
  test.skip(process.platform !== "win32", "Requires a case-insensitive Windows filesystem");
  await freshDocument(
    tauriPage,
    "figure-case",
    String.raw`\includegraphics[width=0.5\linewidth]{plot.png}`,
  );
  await writeProjectBinary(tauriPage, "Plot.PNG", FIXTURE_PNG);
  await refreshTree(tauriPage);
  await openVisual(tauriPage);

  const image = tauriPage.locator(".cm-content .ofl-visual-graphics-image").first();
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => image.getAttribute("src")).toMatch(/^data:image\/png/u);
});

test("toolbar insertions write LaTeX into the document in visual mode", async ({ tauriPage }) => {
  await freshDocument(tauriPage, "insert", "Body text.\n");
  await openVisual(tauriPage);

  await selectEditorText(tauriPage, "Body");
  await clickToolbarControl(tauriPage, '[aria-label^="Bold ("]', "Bold");
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\textbf{Body}");

  await setEditorCaretAfter(tauriPage, "text.");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert cross-reference"]',
    "Insert cross-reference",
  );
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 10_000 })
    .toContain("\\ref{label}");
});
