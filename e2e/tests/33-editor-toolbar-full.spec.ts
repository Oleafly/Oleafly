import { test, expect } from "../fixtures";
import {
  caretIn,
  clickToolbarControl,
  openGallery,
  openRailTab,
  pressGlobal,
  typeInEditorAfter,
  typeInEditorAtStart,
  waitEditorShowsFile,
  type Page,
} from "../helpers";

// Runs in a throwaway project: snippets like \href{}{} would break the
// shared E2E Doc's compiles.

const RUN = Date.now().toString(36);
const NAME = `E2E Toolbar ${RUN}`;
const CODE_INTEL_NAME = `E2E Code Intel ${RUN}`;

async function openBlankProject(
  page: Page & { getByText(t: string): { click(): Promise<void> } },
  name: string,
) {
  const exists = await page.evaluate<boolean>(
    `document.body.innerText.includes(${JSON.stringify(name)})`,
  );
  if (exists) {
    await page.getByText(name).click();
  } else {
    await openGallery(page);
    await page.click('[data-testid="template-card-blank"]');
    await page.fill("#new-project-name", name);
    await page.click('[data-testid="create-project"]');
  }
  // Windows WebView2 cold-mounts the editor slower than macOS/Linux; a fixed
  // 20s wait times out on a loaded runner. Poll longer, and if the editor
  // never appeared (an open click that missed, or a gallery that didn't
  // dismiss), reopen the project once before giving up.
  const editorReady = await page
    .waitForFunction(`!!document.querySelector('.cm-content')`, 45_000)
    .then(() => true)
    .catch(() => false);
  if (!editorReady) {
    if (await page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(name)})`)) {
      await page.getByText(name).click().catch(() => {});
    }
    await page.waitForFunction(`!!document.querySelector('.cm-content')`, 45_000);
  }
  await caretIn(page, "here.", 1, "end");
}

async function openScratchProject(
  page: Page & { getByText(t: string): { click(): Promise<void> } },
) {
  await openBlankProject(page, NAME);
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

// Click a list item inside the OPEN Radix portal in one browser task. A naive
// getByText().click() times out on the reopened popover: Radix keeps the
// previous (closing) portal mounted for its exit animation, so the bridge can
// bind to a stale, hidden copy that never becomes clickable.
async function pickListItem(page: Page, label: "Bulleted list" | "Numbered list") {
  const clicked = await page
    .waitForFunction(
      `(() => {
        const button = Array.from(
          document.querySelectorAll('[data-radix-popper-content-wrapper] button')
        )
          .filter((candidate) => candidate.closest('[data-state="open"]'))
          .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`,
      5_000,
    )
    .then(() => true)
    .catch(() => false);
  if (!clicked) throw new Error(`list item ${label} never became clickable`);
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

async function openCodeIntelligence(page: Page) {
  const actionExpression =
    codeIntelligenceButtonExpression("Go to definition");
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await page.evaluate<boolean>(`!!(${actionExpression})`)) return;
    await clickToolbarControl(
      page,
      '[aria-label="Code intelligence"]',
      "Code",
    );
    const opened = await page
      .waitForFunction(`!!(${actionExpression})`, 3_000)
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error("Code intelligence menu did not remain open after toolbar layout settled");
}

async function clickCodeIntelligenceAction(page: Page, label: string) {
  const buttonExpression = codeIntelligenceButtonExpression(label);
  // Find and click in ONE evaluation: the toolbar's ResizeObserver relayout
  // can remount the menu between a wait that sees the action and a separate
  // click evaluation (same race class clickToolbarControl fixed). If the menu
  // closed underneath us, reopen it and try again.
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

test("both list kinds insert their environments", async ({ tauriPage }) => {
  await openScratchProject(tauriPage);
  await openListDropdown(tauriPage);
  await pickListItem(tauriPage, "Bulleted list");
  await editorHas(tauriPage, "\\begin{itemize}");
  await openListDropdown(tauriPage);
  await pickListItem(tauriPage, "Numbered list");
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
  await tauriPage.click('button[aria-label^="Insert alpha ("]');
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
  await openBlankProject(tauriPage, CODE_INTEL_NAME);
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
    await clickCodeIntelligenceAction(tauriPage, "Go to definition");
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

  // The action can land as a silent no-op when the menu remounts mid-click or
  // the caret state was consumed by the prior definition jump, so retry the
  // whole caret -> menu -> action sequence until the dialog actually opens.
  // (A promise-returning waitForFunction is truthy immediately in this bridge,
  // so it cannot serve as the readiness gate here.)
  for (let attempt = 0; ; attempt++) {
    await caretIn(tauriPage, "sec:e2e-toolbar", 2);
    await openCodeIntelligence(tauriPage);
    await clickCodeIntelligenceAction(tauriPage, "Rename symbol");
    const opened = await tauriPage
      .waitForFunction(
        `!!document.querySelector('[role="dialog"][aria-labelledby="rename-title"]')`,
        5_000,
      )
      .then(() => true)
      .catch(() => false);
    if (opened) break;
    if (attempt >= 3) throw new Error("rename dialog never opened");
  }
  const renameDialog = tauriPage.locator('[role="dialog"][aria-labelledby="rename-title"]');
  await expect(renameDialog).toBeVisible({ timeout: 10_000 });
  await renameDialog.getByText("Cancel", { exact: true }).click();

  await caretIn(tauriPage, "sec:e2e-toolbar", 2);
  await openCodeIntelligence(tauriPage);
  await clickCodeIntelligenceAction(tauriPage, "Find references");
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
  await waitEditorShowsFile(tauriPage, "notes.txt");
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
