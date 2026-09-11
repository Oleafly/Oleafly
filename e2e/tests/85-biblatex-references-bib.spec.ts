import { test, expect } from "../fixtures";
import {
  compileAndWait,
  createBlankProject,
  expectCompiledPdfContains,
  openRailTab,
  setEditorContent,
} from "../helpers";

const MAIN = `\\documentclass{article}
\\usepackage[backend=biber,style=numeric]{biblatex}
\\addbibresource{references.bib}
\\begin{document}
The laddering technique is described in \\cite{miles2004laddering}.
\\printbibliography
\\end{document}
`;

const BIB = `@article{miles2004laddering,
  author = {Miles, Sarah and Rowe, Gene},
  title = {The laddering technique},
  journal = {Doing Social Psychology Research},
  year = {2004},
  pages = {305--343}
}
`;

async function compileLog(page: { evaluate<T>(e: string): Promise<T> }): Promise<string> {
  return page.evaluate<string>(
    `import("/src/store/compile.ts").then(({ useCompileStore }) => useCompileStore.getState().log || "")`,
  );
}

test("a citation imported into a fresh biblatex project resolves on the first compile", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, "E2E Biblatex");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await setEditorContent(tauriPage, MAIN);
  await openRailTab(tauriPage, "Research Assistant");

  const hookReady = await tauriPage.evaluate<boolean>(
    `typeof window.__importCitationFile === "function"`,
  );
  expect(hookReady, "__importCitationFile devtools hook must be present").toBe(true);
  const imported = await tauriPage.evaluate<{ imported: number; errors: string[] }>(
    `window.__importCitationFile("refs.bib", ${JSON.stringify(BIB)})`,
  );
  expect(imported.errors).toEqual([]);
  expect(imported.imported).toBe(1);

  await expect
    .poll(
      () =>
        tauriPage.evaluate<boolean>(
          `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().tree.some((entry) => entry.path === "references.bib"))`,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  await compileAndWait(tauriPage, 180_000);
  const log = await compileLog(tauriPage);
  expect(log).not.toContain("Empty bibliography");
  expect(log).not.toContain("Please (re)run Biber");
  expect(log).not.toContain("Cannot find 'references.bib'");
  await expectCompiledPdfContains(tauriPage, "Doing Social Psychology Research", 120_000);
});

test("a bibliography file that does not exist is named in the compile diagnostics", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, "E2E Biblatex Missing");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await setEditorContent(tauriPage, MAIN.replace("references.bib", "missing.bib"));
  await tauriPage.click('[data-testid="compile-button"]');
  await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `import("/src/store/compile.ts").then(({ useCompileStore }) => {
            const state = useCompileStore.getState();
            if (state.status === "compiling") return "";
            const messages = (state.diagnostics ?? []).map((d) => d.message).join("\\n");
            return messages + "\\n" + (state.log || "");
          })`,
        ),
      { timeout: 180_000 },
    )
    .toMatch(/could not open missing\.bib|Cannot find 'missing\.bib'/);
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "error");
});
