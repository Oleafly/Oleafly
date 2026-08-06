import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strToU8, zipSync } from "fflate";
import { test, expect } from "../fixtures";
import {
  openProject,
  setNextImportPaths,
  waitLong,
  type Page,
} from "../helpers";

// Overleaf import end to end: ZIP in, main document inferred, engine flow
// wired. Fixtures are built at run time so the specs stay hermetic.

function writeZip(name: string, entries: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oleafly-ovl-"));
  const files: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(entries)) {
    files[path] = strToU8(content);
  }
  const zipPath = join(dir, name);
  writeFileSync(zipPath, zipSync(files));
  return zipPath;
}

async function importZip(page: Page, zipPath: string) {
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  await setNextImportPaths(page, [zipPath]);
  await page.click('[data-testid="import-project-button"]');
  await page.getByText("Overleaf ZIP").click();
  await waitLong(
    page,
    `!!document.querySelector('[data-tour="project-editor"] .cm-content')`,
    45_000,
  );
}

async function projectState(page: Page) {
  return page.evaluate<{
    main: string;
    name: string;
    paths: string[];
    engineId: string;
  }>(
    `import("/src/store/files.ts").then((m) => {
      const s = m.useFilesStore.getState();
      return {
        main: s.mainDoc,
        name: s.projectName,
        paths: s.tree.filter((f) => !f.is_dir).map((f) => f.path),
        engineId: s.engine.id,
      };
    })`,
  );
}

test("wrapped Overleaf ZIP unwraps and follows the TeX root magic comment", async ({
  tauriPage,
}) => {
  test.setTimeout(120_000);
  const zipPath = writeZip("wrapped-thesis.zip", {
    "wrapped-thesis/thesis.tex":
      "\\documentclass{report}\n\\input{preamble}\n\\begin{document}\\input{chapters/ch1}\\end{document}\n",
    "wrapped-thesis/preamble.tex": "\\usepackage{amsmath}\n",
    "wrapped-thesis/chapters/ch1.tex":
      "% !TeX root = ../thesis.tex\n\\chapter{One}\nHello.\n",
    "wrapped-thesis/refs.bib": "@book{k, title={T}, author={A}, year={2024}}\n",
  });
  await importZip(tauriPage, zipPath);
  const state = await projectState(tauriPage);
  // No file named main.tex: the magic root comment selects thesis.tex.
  expect(state.main).toBe("thesis.tex");
  expect(state.name).toBe("wrapped-thesis");
  // The single top-level folder from the ZIP was unwrapped.
  expect(state.paths).toContain("thesis.tex");
  expect(state.paths).toContain("chapters/ch1.tex");
  expect(state.paths.some((p) => p.startsWith("wrapped-thesis/"))).toBe(false);
});

test("a lone .tex file becomes the compile entry", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  const zipPath = writeZip("single-paper.zip", {
    "paper.tex":
      "\\documentclass{article}\n\\begin{document}Single file.\\end{document}\n",
    "notes.md": "not a tex file\n",
  });
  await importZip(tauriPage, zipPath);
  const state = await projectState(tauriPage);
  expect(state.main).toBe("paper.tex");
});

test("a Tectonic project with an engine gap offers the engine picker", async ({
  tauriPage,
}) => {
  test.setTimeout(150_000);
  const zipPath = writeZip("minted-gap.zip", {
    "main.tex":
      "\\documentclass{article}\n\\usepackage{minted}\n\\begin{document}\\begin{minted}{python}\nprint(1)\n\\end{minted}\\end{document}\n",
  });
  await importZip(tauriPage, zipPath);
  // Machines with a system TeX import straight onto latexmk. Pin the bundled
  // engine so the scan flow under test is the same on every machine.
  await tauriPage.evaluate(
    `import("/src/store/files.ts").then((m) => m.useFilesStore.getState().setEngine("xetex"))`,
  );
  await waitLong(
    tauriPage,
    `import("/src/store/files.ts").then((m) => m.useFilesStore.getState().engine.id === "latex")`,
    15_000,
  );
  // Reopening the project runs the import scan against the Tectonic engine.
  await tauriPage.click('[title="Back to library"]');
  await openProject(tauriPage, "minted-gap");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-tour="project-editor"] .cm-content')`,
    30_000,
  );
  // The blocker toast carries the entry point into the engine picker.
  await waitLong(
    tauriPage,
    `[...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes("Choose engine"))`,
    20_000,
  );
  await tauriPage.getByText("Choose engine").click();
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="engine-picker-modal"]')`,
    10_000,
  );
  const modalText = await tauriPage.evaluate<string>(
    `document.querySelector('[data-testid="engine-picker-modal"]')?.textContent ?? ""`,
  );
  expect(modalText).toContain("minted");
  expect(modalText).toContain("Keep using Tectonic");
  await tauriPage.click('[data-testid="engine-picker-keep-tectonic"]');
  await waitLong(
    tauriPage,
    `!document.querySelector('[data-testid="engine-picker-modal"]')`,
    10_000,
  );
  // The choice is remembered: the project stays on the bundled engine.
  const state = await projectState(tauriPage);
  expect(state.engineId).toBe("latex");
});
