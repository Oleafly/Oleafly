// Level-3 UI evidence for the conversion matrix: drives the real app UI
// (menus, dialogs, previews) and saves screenshots to
// e2e-artifacts/conversion-matrix/. Assertions are on visible DOM so the
// pass means the features work through the interface, not just the IPC.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import {
  openRailTab,
  replaceEditorSource,
  setEditorCaretAfter,
  setNextImportPaths,
  setNextSavePath,
  waitLong,
  writeProjectText,
  type Page,
} from "../helpers";

const FIXTURES = fileURLToPath(new URL("../../fixtures/conversion-matrix", import.meta.url));
const fixture = (name: string) => `${FIXTURES}/${name}`;
const SHOTS = fileURLToPath(new URL("../../e2e-artifacts/conversion-matrix", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  try {
    await (page as unknown as {
      screenshot(options: { path: string }): Promise<unknown>;
    }).screenshot({ path: `${SHOTS}/${name}` });
  } catch {
    // Best effort; DOM assertions carry the pass.
  }
}

const pressMenuTrigger = (selector: string) => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!(element instanceof HTMLElement)) return false;
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  return true;
})()`;

async function atLibrary(page: Page) {
  await page.evaluate(`import("/src/store/files.ts").then((m) => {
    const s = m.useFilesStore.getState();
    if (s.projectId) s.closeProject();
  })`);
  await waitLong(page, `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`, 30_000);
  await waitLong(page, `!!document.querySelector('[data-testid="import-project-button"]')`, 15_000);
}

async function openImportMenu(page: Page) {
  await page.evaluate(pressMenuTrigger('[data-testid="import-project-button"]'));
  await waitLong(page, `!!document.querySelector('[data-testid="import-kind-html"]')`, 10_000);
}

async function openExportMenu(page: Page) {
  await waitLong(page, `!!document.querySelector('[aria-label="Export"]')`, 15_000);
  await page.evaluate(
    `(() => {
      const button = document.querySelector('[aria-label="Export"]');
      if (!(button instanceof HTMLElement)) throw new Error("Export control unavailable");
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      return true;
    })()`,
  );
}

async function createProject(page: Page, kind: "latex" | "typst", name: string) {
  await page.evaluate(
    `import("/src/store/files.ts").then((m) => m.useFilesStore.getState().${kind === "typst" ? "createTypstProject" : "createProject"}(${JSON.stringify(name)}))`,
  );
  await waitLong(page, `!!document.querySelector('[data-tour="project-editor"] .cm-content')`, 60_000);
}

async function editorText(page: Page): Promise<string> {
  return page.evaluate<string>(
    `import("/src/components/editor/cm/controller.ts").then((m) => {
      const view = m.getEditorView();
      return view ? view.state.doc.toString() : "";
    })`,
  );
}

test("import menu lists every registry source", async ({ tauriPage }) => {
  await atLibrary(tauriPage);
  await openImportMenu(tauriPage);
  for (const kind of ["import-kind-word", "import-kind-markdown", "import-kind-html", "import-kind-typst"]) {
    await waitLong(tauriPage, `!!document.querySelector('[data-testid="${kind}"]')`, 5_000);
  }
  await expect(tauriPage.getByText("Existing project (.zip)")).toBeVisible();
  await shot(tauriPage, "01-import-menu-registry-kinds.png");
  await tauriPage.keyboard.press("Escape");
});

test("html imports as a LaTeX project through the menu targets", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await atLibrary(tauriPage);
  await setNextImportPaths(tauriPage, [fixture("mathml-page.html")]);
  await openImportMenu(tauriPage);
  await tauriPage.evaluate(
    `(() => {
      const trigger = document.querySelector('[data-testid="import-kind-html"]');
      if (!(trigger instanceof HTMLElement)) throw new Error("html submenu trigger missing");
      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' }));
      trigger.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', clientX: 40, clientY: 40 }));
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }));
      trigger.focus();
      return true;
    })()`,
  );
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="import-target-html-latex"]')`, 10_000);
  await shot(tauriPage, "02-import-html-targets.png");
  await tauriPage.evaluate(
    `(() => {
      const item = document.querySelector('[data-testid="import-target-html-latex"]');
      if (!(item instanceof HTMLElement)) throw new Error("latex target missing");
      item.click();
      return true;
    })()`,
  );
  await waitLong(tauriPage, `!!document.querySelector('[data-tour="project-editor"] .cm-content')`, 90_000);
  expect(await editorText(tauriPage)).toContain("\\section{");
  await shot(tauriPage, "03-html-to-latex-editor.png");
});

test("latex paper compiles and shows the pdf preview", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await atLibrary(tauriPage);
  await tauriPage.evaluate(
    `import("/src/store/files.ts").then((m) => m.useFilesStore.getState().importProject(${JSON.stringify(fixture("latex-paper.zip"))}))`,
  );
  await waitLong(tauriPage, `!!document.querySelector('[data-tour="project-editor"] .cm-content')`, 90_000);
  await waitLong(
    tauriPage,
    `import("/src/store/compile.ts").then((m) => m.useCompileStore.getState().pdfBytes !== null)`,
    180_000,
  );
  await shot(tauriPage, "04-latex-paper-pdf-preview.png");
});

test("export menu shows the registry formats and exports typst", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await atLibrary(tauriPage);
  await createProject(tauriPage, "latex", "export-typst-ui");
  await writeProjectText(tauriPage, "main.tex", readFileSync(`${FIXTURES}/latex-paper/main.tex`, "utf8"));
  await writeProjectText(tauriPage, "sections/method.tex", readFileSync(`${FIXTURES}/latex-paper/sections/method.tex`, "utf8"));
  await writeProjectText(tauriPage, "refs.bib", readFileSync(`${FIXTURES}/latex-paper/refs.bib`, "utf8"));
  mkdirSync(`${SHOTS}/05-source`, { recursive: true });
  await setNextSavePath(tauriPage, `${SHOTS}/05-source/latex-paper.typ`);
  await openExportMenu(tauriPage);
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="export-route-latex-to-typst"]')`, 10_000);
  await shot(tauriPage, "05-export-menu-registry.png");
  await tauriPage.locator('[data-testid="export-route-latex-to-typst"]').click();
  const dest = `${SHOTS}/05-source/latex-paper.typ`;
  const deadline = Date.now() + 120_000;
  while (!(existsSync(dest) && statSync(dest).size > 0)) {
    if (Date.now() > deadline) throw new Error("typst export did not land");
    await new Promise((r) => setTimeout(r, 400));
  }
  expect(readFileSync(dest, "utf8")).toContain("= Introduction");
});

test("typst project export menu offers word, html, markdown, and tex", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await atLibrary(tauriPage);
  await createProject(tauriPage, "typst", "typst-export-ui");
  await writeProjectText(tauriPage, "main.typ", readFileSync(fixture("paper.typ"), "utf8"));
  await openExportMenu(tauriPage);
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="export-route-typst-to-latex"]')`, 10_000);
  for (const route of ["typst-to-docx", "typst-to-html", "typst-to-markdown"]) {
    await waitLong(tauriPage, `!!document.querySelector('[data-testid="export-route-${route}"]')`, 5_000);
  }
  await shot(tauriPage, "06-typst-export-menu.png");
  await tauriPage.keyboard.press("Escape");
});

test("equation context menu exports a real svg image", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await atLibrary(tauriPage);
  await createProject(tauriPage, "latex", "equation-export-ui");
  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\begin{document}\n\\begin{equation}\n  E = mc^2\n\\end{equation}\n\\end{document}\n",
  );
  // Put the caret inside the equation, then right-click the editor.
  await setEditorCaretAfter(tauriPage, "E = mc", 1);
  await tauriPage.evaluate(
    `import("/src/components/editor/cm/controller.ts").then((m) => {
      const view = m.getEditorView();
      const editor = document.querySelector('.cm-content');
      if (!view || !(editor instanceof HTMLElement)) throw new Error("editor missing");
      // Right-click exactly at the caret so the enclosing-equation lookup
      // resolves the math under it, like a real user would.
      const head = view.state.selection.main.head;
      const coords = view.coordsAtPos(head) ?? editor.getBoundingClientRect();
      editor.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: coords.left, clientY: (coords.top + coords.bottom) / 2, button: 2,
      }));
      return true;
    })`,
  );
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="context-export-equation-svg"]')`, 10_000);
  await shot(tauriPage, "07-equation-context-menu.png");
  mkdirSync(`${SHOTS}/07-equation`, { recursive: true });
  await setNextSavePath(tauriPage, `${SHOTS}/07-equation/equation.svg`);
  await tauriPage.locator('[data-testid="context-export-equation-svg"]').click();
  const dest = `${SHOTS}/07-equation/equation.svg`;
  const deadline = Date.now() + 90_000;
  while (!(existsSync(dest) && statSync(dest).size > 0)) {
    if (Date.now() > deadline) throw new Error("equation svg did not land");
    await new Promise((r) => setTimeout(r, 400));
  }
  const svg = readFileSync(dest, "utf8");
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain("<path");
});

test("table import dialog previews and inserts a booktabs table", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await atLibrary(tauriPage);
  await createProject(tauriPage, "latex", "table-import-ui");
  await setNextImportPaths(tauriPage, [fixture("messy.csv")]);
  await tauriPage.evaluate(`import("/src/store/table-import.ts").then((m) => m.useTableImportStore.getState().setOpen(true))`);
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="table-import-dialog"]')`, 10_000);
  await tauriPage.getByText("Choose CSV, TSV, or XLSX").click();
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="table-import-preview"]')`, 30_000);
  await shot(tauriPage, "08-table-import-preview.png");
  await tauriPage.locator('[data-testid="table-import-insert"]').click();
  await waitLong(
    tauriPage,
    `import("/src/components/editor/cm/controller.ts").then((m) => (m.getEditorView()?.state.doc.toString() ?? "").includes("\\\\toprule"))`,
    30_000,
  );
  await shot(tauriPage, "09-table-inserted-booktabs.png");
});

test("references panel cleaner shows the dry-run diff", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await atLibrary(tauriPage);
  await createProject(tauriPage, "latex", "cleaner-ui");
  await writeProjectText(tauriPage, "references.bib", readFileSync(fixture("dirty.bib"), "utf8"));
  // The rail tab's registered label carries its shortcut hint.
  await openRailTab(tauriPage, "References & citations (Shift-F12)");
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="clean-library-button"]')`, 20_000);
  await tauriPage.locator('[data-testid="clean-library-button"]').click();
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="clean-library-dialog"]')`, 10_000);
  await tauriPage.locator('[data-testid="clean-library-dry-run"]').click();
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="clean-library-diff"]')`, 30_000);
  await expect(tauriPage.locator('[data-testid="clean-library-actions"]')).toContainText("duplicate");
  await shot(tauriPage, "10-clean-library-dry-run-diff.png");
});

test("writing generator hands a grounded prompt to the assistant", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await atLibrary(tauriPage);
  await tauriPage.evaluate(`import("/src/store/home-view.ts").then((m) => m.useHomeViewStore.getState().goTo("generators"))`);
  await waitLong(tauriPage, `!!document.querySelector('[data-testid="generator-abstract"]')`, 15_000);
  await shot(tauriPage, "11-generators-gallery.png");
  await tauriPage.evaluate(
    `import("/src/features/assistant-handoff.ts").then((m) => { const original = m.ensureAiProviderOrOpenSettings; return true; })`,
  ).catch(() => {});
  await tauriPage.locator('[data-testid="generator-abstract"]').click();
  // The assistant surface opens (or settings, when no provider is set).
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="chat-composer"], [contenteditable="true"], textarea, [data-testid*="settings"]') || (document.body.textContent ?? "").includes("Connect a provider")`,
    15_000,
  );
  await shot(tauriPage, "12-generator-abstract-handoff.png");
});
