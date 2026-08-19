import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strToU8, zipSync } from "fflate";
import { test, expect } from "../fixtures";
import {
  openGallery,
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

// Radix dropdown triggers and menu items react to pointer events, not to a
// synthetic element.click() (same pattern as 28-ai-chat.spec.ts).
function pressWithPointer(selectorExpr: string): string {
  return `(() => {
    const el = ${selectorExpr};
    if (!el) return false;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 }));
    el.click();
    return true;
  })()`;
}

async function importZip(page: Page, zipPath: string) {
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  await setNextImportPaths(page, [zipPath]);
  // A single trigger click can land before the dropdown is interactive on a
  // loaded runner, in which case the portal menu never opens and no amount
  // of waiting helps — so retry the trigger itself (same pattern as the F2
  // rename loop in 23-code-intel).
  let menuVisible = false;
  for (let attempt = 0; attempt < 5 && !menuVisible; attempt++) {
    const opened = await page.evaluate<boolean>(
      pressWithPointer(`document.querySelector('[data-testid="import-project-button"]')`),
    );
    if (!opened) throw new Error("import dropdown trigger not found");
    menuVisible = await waitLong(
      page,
      `[...document.querySelectorAll('[role="menuitem"]')].some((i) => (i.textContent ?? "").includes("Overleaf ZIP"))`,
      4_000,
    )
      .then(() => true)
      .catch(() => false);
  }
  if (!menuVisible) {
    throw new Error("Overleaf ZIP menu never opened after 5 trigger attempts");
  }
  const clicked = await page.evaluate<boolean>(
    pressWithPointer(
      `[...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent ?? "").includes("Overleaf ZIP"))`,
    ),
  );
  if (!clicked) throw new Error("Overleaf ZIP menu item not found");
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
    allowShellEscape: boolean;
  }>(
    `import("/src/store/files.ts").then((m) => {
      const s = m.useFilesStore.getState();
      return {
        main: s.mainDoc,
        name: s.projectName,
        paths: s.tree.filter((f) => !f.is_dir).map((f) => f.path),
        engineId: s.engine.id,
        allowShellEscape: s.engine.allow_shell_escape,
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
  await tauriPage.evaluate(
    `import("/src/store/files.ts").then((m) => m.useFilesStore.getState().setEngine("xetex"))`,
  );
  await waitLong(
    tauriPage,
    `import("/src/store/files.ts").then((m) => m.useFilesStore.getState().engine.id === "latex")`,
    15_000,
  );
  // Reopening the project runs the import scan against the Tectonic engine.
  // openProject owns the library transition. Clicking Home here as well races
  // its readiness check against the outgoing workspace.
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
  const actions = await tauriPage.evaluate<number>(
    `[...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes("Choose engine")).length`,
  );
  expect(actions).toBe(1);
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
  expect(modalText).toContain("Shell-dependent features were detected");
  await expect(tauriPage.getByTestId("engine-picker-shell-escape")).not.toBeChecked();
  await tauriPage.click('[data-testid="engine-picker-keep-tectonic"]');
  await waitLong(
    tauriPage,
    `!document.querySelector('[data-testid="engine-picker-modal"]')`,
    10_000,
  );
  // The choice is remembered: the project stays on the bundled engine.
  const state = await projectState(tauriPage);
  expect(state.engineId).toBe("latex");
  expect(state.allowShellEscape).toBe(false);
});

test("a plain folder imports with the main document inferred", async ({
  tauriPage,
}) => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), "oleafly-ovl-folder-"));
  writeFileSync(
    join(dir, "report.tex"),
    "\\documentclass{article}\n\\begin{document}Folder import.\\input{sections/intro}\\end{document}\n",
  );
  mkdirSync(join(dir, "sections"));
  writeFileSync(join(dir, "sections", "intro.tex"), "Intro section.\n");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  await setNextImportPaths(tauriPage, [dir]);
  const opened = await tauriPage.evaluate<boolean>(
    pressWithPointer(`document.querySelector('[data-testid="import-project-button"]')`),
  );
  if (!opened) throw new Error("import dropdown trigger not found");
  await waitLong(
    tauriPage,
    `[...document.querySelectorAll('[role="menuitem"]')].some((i) => (i.textContent ?? "").includes("Project folder"))`,
    10_000,
  );
  const clicked = await tauriPage.evaluate<boolean>(
    pressWithPointer(
      `[...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent ?? "").includes("Project folder"))`,
    ),
  );
  if (!clicked) throw new Error("Project folder menu item not found");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-tour="project-editor"] .cm-content')`,
    45_000,
  );
  const state = await projectState(tauriPage);
  // Root-level \documentclass file beats the section fragment.
  expect(state.main).toBe("report.tex");
  expect(state.paths).toContain("sections/intro.tex");
});

test("the template chooser imports an Overleaf ZIP from its header button", async ({
  tauriPage,
}) => {
  test.setTimeout(120_000);
  const zipPath = writeZip("chooser-import.zip", {
    "main.tex":
      "\\documentclass{article}\n\\begin{document}From the chooser.\\end{document}\n",
  });
  await openGallery(tauriPage);
  // The path must be queued before the click: the picker opens immediately.
  await setNextImportPaths(tauriPage, [zipPath]);
  await tauriPage.click('[data-testid="import-from-overleaf"]');
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-tour="project-editor"] .cm-content')`,
    45_000,
  );
  const state = await projectState(tauriPage);
  expect(state.main).toBe("main.tex");
  expect(state.name).toBe("chooser-import");
});
