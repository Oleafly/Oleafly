import { test, expect } from "../fixtures";
import {
  typeInEditorAfter,
  setEditorContent,
  createBlankProject,
  expectCompiledPdfContains,
  expectCompiledPdfAbsent,
  expectCompiledPdfEmpty,
} from "../helpers";

const ORIGINAL_BLANK =
  "\\documentclass[11pt]{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{hyperref}\n\n" +
  "\\title{Untitled}\n\\author{}\n\n\\begin{document}\n\\maketitle\n\n" +
  "\\section{Introduction}\nWrite your \\LaTeX{} here.\n\n\\end{document}\n";

test("typed text appears in the compiled PDF", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await createBlankProject(tauriPage, `Typed RT ${Date.now().toString(36)}`);
  await typeInEditorAfter(tauriPage, "here.", " E2EMARKER");
  await expect(tauriPage.locator(".cm-content")).toContainText("E2EMARKER");
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toBeEnabled({ timeout: 120_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
  await expectCompiledPdfContains(tauriPage, "E2EMARKER");
});

test("reverting an edit removes the text from the recompiled PDF", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await createBlankProject(tauriPage, `Revert RT ${Date.now().toString(36)}`);

  await typeInEditorAfter(tauriPage, "here.", " E2EREVERTMARK");
  await expect(tauriPage.locator(".cm-content")).toContainText("E2EREVERTMARK");
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toBeEnabled({ timeout: 120_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
  await expectCompiledPdfContains(tauriPage, "E2EREVERTMARK");

  await setEditorContent(tauriPage, ORIGINAL_BLANK);
  await expect(tauriPage.locator(".cm-content")).not.toContainText("E2EREVERTMARK");
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toBeEnabled({ timeout: 120_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
  await expectCompiledPdfAbsent(tauriPage, "E2EREVERTMARK");
});

test("replacing the whole document recompiles to the new content", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await createBlankProject(tauriPage, `Replace RT ${Date.now().toString(36)}`);

  const fresh =
    "\\documentclass{article}\n\\begin{document}\nFULLREPLACEMARK new body text.\n\\end{document}\n";
  await setEditorContent(tauriPage, fresh);
  await expect(tauriPage.locator(".cm-content")).toContainText("FULLREPLACEMARK");
  await expect(tauriPage.locator(".cm-content")).not.toContainText("Introduction");
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toBeEnabled({ timeout: 120_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
  await expectCompiledPdfContains(tauriPage, "FULLREPLACEMARK");
  await expectCompiledPdfAbsent(tauriPage, "Introduction");
});

test("an empty-body document compiles to a blank page", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await createBlankProject(tauriPage, `Blank RT ${Date.now().toString(36)}`);

  const blank =
    "\\documentclass{article}\n\\pagestyle{empty}\n\\begin{document}\n\\null\n\\end{document}\n";
  await setEditorContent(tauriPage, blank);
  await expect(tauriPage.locator(".cm-content")).not.toContainText("Introduction");
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toBeEnabled({ timeout: 120_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
  await expectCompiledPdfEmpty(tauriPage);
});
