import { test, expect } from "../fixtures";
import {
  caretIn,
  clickToolbarControl,
  openGallery,
  openRailTab,
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

test("both list kinds insert their environments", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await openListDropdown(tauriPage);
  await tauriPage.getByText("Bulleted list").click();
  await editorHas(tauriPage, "\\begin{itemize}");
  await openListDropdown(tauriPage);
  await tauriPage.getByText("Numbered list").click();
  await editorHas(tauriPage, "\\begin{enumerate}");
});

test("the find button opens the editor search panel", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await tauriPage.click('[aria-label^="Find ("]');
  await expect(tauriPage.locator(".cm-vs-search")).toBeVisible({ timeout: 5_000 });
});

test("non-tex files get no formatting toolbar; txt files edit fine", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await expect(tauriPage.locator('[aria-label^="Bold ("]')).toBeVisible();

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
