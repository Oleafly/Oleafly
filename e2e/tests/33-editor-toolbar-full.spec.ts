import { test, expect } from "../fixtures";
import {
  caretIn,
  clickToolbarControl,
  openGallery,
  openProject,
  openRailTab,
  pressGlobal,
  typeInEditorAfter,
  typeInEditorAtStart,
  type Page,
} from "../helpers";

// Runs in a throwaway project: snippets like \href{}{} would break the
// shared E2E Doc's compiles.

const RUN = Date.now().toString(36);
const NAME = `E2E Toolbar ${RUN}`;

async function openScratchProject(page: Page & { getByText(t: string): { click(): Promise<void> } }) {
  const exists = await page.evaluate<boolean>(
    `document.body.innerText.includes(${JSON.stringify(NAME)})`,
  );
  if (exists) {
    await page.getByText(NAME).click();
  } else {
    await openGallery(page);
    await page.click('[data-testid="template-card-blank"]');
    await page.fill("#new-project-name", NAME);
    await page.click('[data-testid="create-project"]');
  }
  await page.waitForFunction(`!!document.querySelector('.cm-content')`, 20_000);
  await caretIn(page, "here.", 1, "end");
}

const editorHas = (page: Page, needle: string) =>
  page.waitForFunction(
    `(document.querySelector('.cm-content')?.textContent || '').includes(${JSON.stringify(needle)})`,
    5_000,
  );

test("italic, link, and cross-reference buttons insert LaTeX", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await clickToolbarControl(tauriPage, '[aria-label^="Italic ("]', "Italic");
  await editorHas(tauriPage, "\\textit{");
  await clickToolbarControl(tauriPage, '[aria-label="Insert link"]', "Insert link");
  await editorHas(tauriPage, "\\href{");
  await clickToolbarControl(tauriPage, '[aria-label="Insert cross-reference"]', "Insert cross-reference");
  await editorHas(tauriPage, "\\ref{");
});

test("every heading level inserts its sectioning command", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  const headings = [
    ["Part", "\\part{"],
    ["Chapter", "\\chapter{"],
    ["Section", "\\section{"],
    ["Subsection", "\\subsection{"],
    ["Subsubsection", "\\subsubsection{"],
    ["Paragraph", "\\paragraph{"],
  ] as const;
  for (const [label, cmd] of headings) {
    await tauriPage.click('[aria-label="Heading level"]');
    await tauriPage.getByText(label, { exact: true }).click();
    await editorHas(tauriPage, cmd);
  }
});

async function openListDropdown(page: Page) {
  let open = false;
  for (let attempt = 0; attempt < 5 && !open; attempt++) {
    try {
      await clickToolbarControl(page, '[aria-label="Insert list"]', "List");
      await page.waitForFunction(`document.body.innerText.includes('Bulleted list')`, 3_000);
      open = true;
    } catch {}
  }
}

async function openCodeIntelligence(page: Page) {
  const trigger = page.locator('[aria-label="Code intelligence"]');
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  } else {
    await page.click('[aria-label="More formatting options"]');
    await page.click('[aria-label="Code intelligence"]');
  }
  await page.waitForFunction(
    `document.body.innerText.includes("Go to definition")`,
    5_000,
  );
}

test("both list kinds insert their environments", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await openListDropdown(tauriPage);
  await tauriPage.getByText("Bulleted list").click();
  await editorHas(tauriPage, "\\begin{itemize}");
  await openListDropdown(tauriPage);
  await tauriPage.getByText("Numbered list").click();
  await editorHas(tauriPage, "\\begin{enumerate}");
});

test("every remaining formatting control inserts its LaTeX command", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  const controls = [
    ['[aria-label="Underline"]', "Underline", "\\underline{"],
    ['[aria-label="Inline code"]', "Inline code", "\\texttt{"],
    ['[aria-label="Insert footnote"]', "Insert footnote", "\\footnote{"],
    ['[aria-label="Insert blockquote"]', "Insert blockquote", "\\begin{quote}"],
    ['[aria-label="Insert align environment"]', "Align environment", "\\begin{align}"],
    ['[aria-label="Insert equation environment"]', "Equation environment", "\\begin{equation}"],
    ['[aria-label="Insert fraction"]', "Fraction", "\\frac{"],
  ] as const;

  for (const [selector, menuLabel, latex] of controls) {
    await clickToolbarControl(tauriPage, selector, menuLabel);
    await editorHas(tauriPage, latex);
    await tauriPage.click('[aria-label^="Undo ("]');
    await tauriPage.waitForFunction(
      `!(document.querySelector('.cm-content')?.textContent || '').includes(${JSON.stringify(latex)})`,
      5_000,
    );
  }
});

test("symbol picker searches and inserts a symbol", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await clickToolbarControl(tauriPage, '[aria-label="Insert symbol"]', "Symbols");
  await expect(tauriPage.locator('[aria-label="Search symbols"]')).toBeVisible({
    timeout: 5_000,
  });
  await tauriPage.fill('[aria-label="Search symbols"]', "alpha");
  await tauriPage.click('button[title="alpha"]');
  await editorHas(tauriPage, "\\alpha");
});

test("word-count toolbar popover reports the active file", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await tauriPage.click('[aria-label="Word count"]');
  await expect(tauriPage.getByText("Words", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Characters", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Lines", { exact: true })).toBeVisible();
  await tauriPage.press("body", "Escape");
});

test("code-intelligence toolbar menu runs definition, references, and rename actions", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const hasSeed = await tauriPage.evaluate<boolean>(
    `(document.querySelector('.cm-content')?.textContent || '').includes('sec:e2e-toolbar')`,
  );
  if (!hasSeed) {
    await typeInEditorAfter(tauriPage, "Write", "\\label{sec:e2e-toolbar} ");
    await typeInEditorAfter(tauriPage, "here.", " See Section~\\ref{sec:e2e-toolbar}.");
    await pressGlobal(tauriPage, "Enter", { meta: true });
    await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute(
      "data-severity",
      "ok",
      { timeout: 90_000 },
    );
  }

  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:e2e-toolbar", 2);
    await openCodeIntelligence(tauriPage);
    await tauriPage.getByText("Go to definition").click();
    const landed = await tauriPage
      .waitForFunction(
        `(document.querySelector('.cm-activeLine')?.textContent || '').includes('label{sec:e2e-toolbar}')`,
        5_000,
      )
      .then(() => true)
      .catch(() => false);
    if (landed) break;
    if (attempt >= 3) throw new Error("toolbar go-to-definition never landed");
  }

  await caretIn(tauriPage, "sec:e2e-toolbar", 2);
  await openCodeIntelligence(tauriPage);
  await tauriPage.getByText("Rename symbol").click();
  const renameDialog = tauriPage.locator('[role="dialog"][aria-labelledby="rename-title"]');
  await expect(renameDialog).toBeVisible({ timeout: 5_000 });
  await renameDialog.getByText("Cancel", { exact: true }).click();

  await caretIn(tauriPage, "sec:e2e-toolbar", 2);
  await openCodeIntelligence(tauriPage);
  await tauriPage.getByText("Find references").click();
  await expect(tauriPage.locator('[aria-label="References (Shift-F12)"]')).toBeVisible({
    timeout: 10_000,
  });
});

test("the find button opens the editor search panel", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await tauriPage.click('[aria-label^="Find ("]');
  await expect(tauriPage.locator(".cm-vs-search")).toBeVisible({ timeout: 5_000 });
});

test("non-tex files get no formatting toolbar; txt files edit fine", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  // Undo never overflows into the "More formatting options" menu (unlike
  // Bold, which can on a narrow CI window), so it's a more reliable signal
  // that the LaTeX toolbar mounted at all.
  await expect(tauriPage.locator('[aria-label^="Undo ("]')).toBeVisible({ timeout: 10_000 });

  await openRailTab(tauriPage, "Source Tree");
  await tauriPage.getByText("project.json", { exact: true }).click();
  await tauriPage.waitForFunction(
    `!document.querySelector('[aria-label^="Bold ("]')`,
    5_000,
  );
  await expect(tauriPage.locator(".cm-content")).toContainText("name");

  await tauriPage.click('[title="New file (in the selected folder)"]');
  await tauriPage.fill('input[placeholder="New file name"]', "notes.txt");
  await tauriPage.press('input[placeholder="New file name"]', "Enter");
  await tauriPage.getByText("notes.txt", { exact: true }).click();
  await typeInEditorAtStart(tauriPage, "plain text survives");
  await expect(tauriPage.locator(".cm-content")).toContainText("plain text survives");
  await tauriPage.waitForFunction(
    `!document.querySelector('[aria-label^="Bold ("]')`,
    5_000,
  );
});

test("font files open a binary notice instead of a broken editor", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await openRailTab(tauriPage, "Source Tree");
  await tauriPage.click('[title="New file (in the selected folder)"]');
  await tauriPage.fill('input[placeholder="New file name"]', "sample.ttf");
  await tauriPage.press('input[placeholder="New file name"]', "Enter");
  await tauriPage.getByText("sample.ttf", { exact: true }).click();
  await expect(tauriPage.getByTestId("binary-file-notice")).toBeVisible({ timeout: 5_000 });
  await expect(tauriPage.getByText("No preview available")).toBeVisible();
});
