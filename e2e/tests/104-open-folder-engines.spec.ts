import { test, expect } from "../fixtures";
import { compileAndWait, expectCompiledPdfAbsent, expectCompiledPdfContains } from "../helpers";
import {
  expectFolderUnchanged,
  expectMainDocument,
  expectNoOleaflyFootprint,
  folderFixtures,
  goToLibrary,
  openFolder,
  openedState,
  showSplitView,
  snapshotFolder,
  waitForCompileSuccess,
  waitForPdfPage,
} from "../open-folder";

const fixtures = folderFixtures("engines");

test.afterAll(() => fixtures.remove());

test("a Typst-only folder opens with the Typst engine and compiles", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Typst Notes", {
    "main.typ": "= Typst notes\n\nTypst opened in place.\n",
    "refs/notes.txt": "Nothing to compile here.\n",
  });
  const before = snapshotFolder(folder);

  const opened = await openFolder(page, folder);
  expect(opened.mainDoc).toBe("main.typ");
  expect(opened.engine).toBe("typst");
  await expectMainDocument(page, "main.typ");

  await showSplitView(page);
  await waitForCompileSuccess(page);
  await waitForPdfPage(page);
  await expectCompiledPdfContains(page, "Typst opened in place.");

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});

test("a Markdown-only folder opens with the Markdown engine and compiles", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Markdown Notes", {
    "README.md": "# About\n\nThis readme is not the paper.\n",
    "paper.md": "---\ntitle: Field Notes\n---\n\nMarkdown opened in place.\n",
  });
  const before = snapshotFolder(folder);

  const opened = await openFolder(page, folder);
  expect(opened.mainDoc).toBe("paper.md");
  expect(opened.engine).toBe("markdown");
  await expectMainDocument(page, "paper.md");

  await showSplitView(page);
  await waitForCompileSuccess(page);
  await waitForPdfPage(page);
  await expectCompiledPdfContains(page, "Markdown opened in place.");
  await expectCompiledPdfAbsent(page, "This readme is not the paper.");

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});

test("a TeX root comment in an opened folder compiles the root it declares", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Root Override", {
    "main.tex": "\\documentclass{article}\n\\begin{document}\nSTOREDMAINMARK\n\\end{document}\n",
    "appendix/appendix.tex": "\\documentclass{article}\n\\begin{document}\nROOTOVERRIDEMARK\n\\input{part}\n\\end{document}\n",
    "appendix/part.tex": "% !TeX root = appendix.tex\nAppendix part pulled in by the declared root.\n",
  });
  const before = snapshotFolder(folder);

  await openFolder(page, folder);
  const picker = page.locator('[data-testid="main-document-picker"]');
  await expect(picker).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="main-document-candidates"] [role="option"][data-path="appendix/appendix.tex"]')).toBeVisible();
  await page.click('[data-testid="main-document-candidates"] [role="option"][data-path="main.tex"]');
  await page.evaluate(`(() => {
    const open = Array.from(document.querySelectorAll('[data-testid="main-document-picker"] button')).find((button) => button.textContent?.trim() === "Open");
    open.click();
    return true;
  })()`);
  await expect(picker).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => (await openedState(page)).mainDoc).toBe("main.tex");

  await showSplitView(page);
  await compileAndWait(page);
  await expectCompiledPdfContains(page, "STOREDMAINMARK");

  await page.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().openFile("appendix/part.tex"))`);
  await expect.poll(async () => page.evaluate<string | null>(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().activePath)`,
  )).toBe("appendix/part.tex");
  await expect(page.locator('[data-testid="tex-root-indicator"]')).toBeVisible({ timeout: 15_000 });
  await compileAndWait(page);
  await expectCompiledPdfContains(page, "ROOTOVERRIDEMARK");
  await expectCompiledPdfContains(page, "Appendix part pulled in by the declared root.");
  await expectCompiledPdfAbsent(page, "STOREDMAINMARK");
  expect((await openedState(page)).mainDoc).toBe("main.tex");

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});
