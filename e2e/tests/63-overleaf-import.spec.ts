import { mkdtempSync, writeFileSync } from "node:fs";
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

function pressWithMousePointer(selectorExpression: string): string {
  return `(() => {
    const element = ${selectorExpression};
    if (!(element instanceof HTMLElement) || element.matches(':disabled')) return false;
    element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
    }));
    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0,
    }));
    element.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
    }));
    element.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, cancelable: true, button: 0,
    }));
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0,
    }));
    return true;
  })()`;
}

async function chooseExistingProject(page: Page, triggerTestId: string) {
  const opened = await page.evaluate<boolean>(
    pressWithMousePointer(
      `document.querySelector('[data-testid=${JSON.stringify(triggerTestId)}]')`,
    ),
  );
  if (!opened) throw new Error("import trigger unavailable");
  await waitLong(
    page,
    `[...document.querySelectorAll('[role="menuitem"]')].some((element) => element.textContent?.trim() === 'Existing project (.zip)')`,
    10_000,
  );
  const selected = await page.evaluate<boolean>(
    pressWithMousePointer(
      `[...document.querySelectorAll('[role="menuitem"]')].find((element) => element.textContent?.trim() === 'Existing project (.zip)')`,
    ),
  );
  if (!selected) throw new Error("existing-project import option unavailable");
}

async function importZip(page: Page, zipPath: string, triggerTestId = "import-project-button") {
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  await setNextImportPaths(page, [zipPath]);
  await chooseExistingProject(page, triggerTestId);
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
  // The blocker toast carries the entry point into the engine picker, and a
  // toast is transient. Every gap between "the button is there" and "click it"
  // is a race the toast can win, and it did: this passed on the push run and
  // timed out on the nightly at the same commit. Count and click inside one
  // evaluation so there is no window for the toast to dismiss in between.
  await waitLong(
    tauriPage,
    `[...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes("Choose engine"))`,
    20_000,
  );
  const actions = await tauriPage.evaluate<number>(
    `(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) =>
        (b.textContent ?? "").includes("Choose engine"),
      );
      buttons[0]?.click();
      return buttons.length;
    })()`,
  );
  expect(actions).toBe(1);
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

test("the unified import chooser exposes every supported project source", async ({ tauriPage }) => {
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  const opened = await tauriPage.evaluate<boolean>(
    pressWithMousePointer(
      `document.querySelector('[data-testid="import-project-button"]')`,
    ),
  );
  if (!opened) throw new Error("import trigger unavailable");
  await waitLong(
    tauriPage,
    `['Existing project (.zip)', 'Word document', 'Markdown document', 'GitHub repo'].every(
      (label) => [...document.querySelectorAll('[role="menuitem"]')].some(
        (element) => element.textContent?.trim() === label
      )
    )`,
    10_000,
  );
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
  await chooseExistingProject(tauriPage, "import-from-overleaf");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-tour="project-editor"] .cm-content')`,
    45_000,
  );
  const state = await projectState(tauriPage);
  expect(state.main).toBe("main.tex");
  expect(state.name).toBe("chooser-import");
});
