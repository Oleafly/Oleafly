import { test, expect } from "../fixtures";
import { compileAndWait, expectCompiledPdfAbsent, expectCompiledPdfContains, waitLong } from "../helpers";
import type { Page } from "../helpers";
import {
  expectMainDocument,
  folderFixtures,
  openFolder,
  openedState,
  showSplitView,
  waitForCompileSuccess,
  waitForPdfPage,
} from "../open-folder";
import { scriptValue } from "../script-value";

const fixtures = folderFixtures("formats");
const ARTICLE = (mark: string) => `\\documentclass{article}\n\\begin{document}\n${mark}\n\\end{document}\n`;

test.afterAll(() => fixtures.remove());

function pressWithPointer(selector: string): string {
  return `(() => {
    const el = document.querySelector(${scriptValue(selector)});
    if (!el || el.matches(':disabled')) return false;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 }));
    el.click();
    return true;
  })()`;
}

async function openInEditor(page: Page, path: string): Promise<void> {
  await page.evaluate(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().openFile(${scriptValue(path)}))`,
  );
  await waitLong(
    page,
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().activePath === ${scriptValue(path)})`,
    20_000,
  );
}

async function openCompileMenuItem(page: Page, item: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await page.evaluate<boolean>(pressWithPointer('[data-testid="compile-options-button"]')))) continue;
    for (let tick = 0; tick < 20; tick++) {
      if (await page.evaluate<boolean>(`!!document.querySelector(${scriptValue(`[data-testid="${item}"]`)})`)) {
        await page.evaluate(pressWithPointer(`[data-testid="${item}"]`));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await page.press("body", "Escape");
  }
  throw new Error(`compile menu item ${item} never showed`);
}

test("a Quarto book opens on the chapter its config names, not the LaTeX Quarto rendered", async ({
  tauriPage: page,
}) => {
  const folder = fixtures.make("Field Book", {
    "_quarto.yml": "project:\n  type: book\nbook:\n  chapters:\n    - index.qmd\n    - methods.qmd\n",
    "index.qmd": "# Preface\n\nWelcome.\n",
    "methods.qmd": "# Methods\n",
    "notes.md": "# Meeting notes\n",
    "_book/Field-Book.tex": ARTICLE("Rendered book."),
    "_extensions/journal/template.tex": "\\documentclass[$classoption$]{$documentclass$}\n\\begin{document}\n$body$\n\\end{document}\n",
  });

  const opened = await openFolder(page, folder);
  expect(opened.mainDoc).toBe("index.qmd");
  expect(opened.engine).toBe("quarto");
  await expectMainDocument(page, "index.qmd");
  expect(await page.evaluate<boolean>(`!!document.querySelector('[data-testid="main-document-picker"]')`)).toBe(false);
});

test("a paper rendered with keep-tex opens on its notebook", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Kept Tex", {
    "paper.qmd": "---\ntitle: Soil carbon\nformat:\n  pdf:\n    keep-tex: true\n---\n\n# Intro\n",
    "paper.tex": `% Options for packages loaded elsewhere\n${ARTICLE("Rendered by Quarto.")}`,
    "references.bib": "@article{a,title={A},year={2020}}\n",
  });

  const opened = await openFolder(page, folder);
  expect(opened.mainDoc).toBe("paper.qmd");
  expect(opened.engine).toBe("quarto");
});

test("a LaTeX paper compiles its Markdown notes with Pandoc while they are open", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Paper With Notes", {
    "paper.tex": ARTICLE("PAPERFORMATMARK"),
    "notes/meeting.md": "---\ntitle: Meeting\n---\n\nNOTESFORMATMARK from the meeting.\n",
  });

  const opened = await openFolder(page, folder);
  expect(opened.mainDoc).toBe("paper.tex");
  expect(opened.engine).toBe("latex");
  await showSplitView(page);
  await waitForCompileSuccess(page);
  await waitForPdfPage(page);
  await expectCompiledPdfContains(page, "PAPERFORMATMARK");

  await openInEditor(page, "notes/meeting.md");
  await expect(page.locator('[data-testid="tex-root-indicator"]')).toBeVisible({ timeout: 10_000 });
  await compileAndWait(page);
  await expectCompiledPdfContains(page, "NOTESFORMATMARK");
  const during = await openedState(page);
  expect([during.mainDoc, during.engine]).toEqual(["paper.tex", "latex"]);

  await openInEditor(page, "paper.tex");
  await compileAndWait(page);
  await expectCompiledPdfContains(page, "PAPERFORMATMARK");
  await expectCompiledPdfAbsent(page, "NOTESFORMATMARK");
});

test("Change main document moves the project to the format of the file picked", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Switch Format", {
    "paper.tex": ARTICLE("SWITCHPAPERMARK"),
    "report.md": "# Report\n\nSWITCHREPORTMARK\n",
  });

  const opened = await openFolder(page, folder);
  expect([opened.mainDoc, opened.engine]).toEqual(["paper.tex", "latex"]);
  await waitLong(
    page,
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().engineLoaded)`,
    20_000,
  );
  await openCompileMenuItem(page, "compile-change-main");
  const choice = '[data-testid="main-document-candidates"] label[data-path="report.md"]';
  await waitLong(page, `!!document.querySelector(${scriptValue(choice)})`, 20_000);
  await page.click(choice);
  await page.evaluate(
    `[...document.querySelectorAll('[data-testid="main-document-picker"] button')].find((button) => button.textContent?.includes("Use as main document"))?.click()`,
  );
  await expect
    .poll(async () => {
      const state = await openedState(page);
      return [state.mainDoc, state.engine];
    }, { timeout: 20_000 })
    .toEqual(["report.md", "markdown"]);
  await expectMainDocument(page, "report.md");
});
