import { test, expect } from "../fixtures";
import {
  createBlankProject,
  openProject,
  waitLong,
  type Page,
} from "../helpers";

// The per-project compiler pin (Overleaf's Compiler setting): picking
// pdfLaTeX / XeLaTeX / LuaLaTeX moves the project onto latexmk and stores the
// choice in project.json, Tectonic clears it. Nothing here compiles: CI has no
// TeX distribution, and the pin is persisted by set_project_engine, which
// validates the engine against the main document without probing for binaries.

const PROJECT = "Compiler Pin";

// Radix dropdown triggers and menu items react to pointer events, not to the
// bridge's synthetic element.click().
function pressWithPointer(selectorExpr: string): string {
  return `(() => {
    const el = ${selectorExpr};
    if (!el || el.matches(':disabled')) return false;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 }));
    el.click();
    return true;
  })()`;
}

// The default-engine preference decides what a NEW project starts on, and it
// persists in localStorage across runs. Pin it so these specs assert the
// per-project choice rather than whatever the machine was left on.
async function useTectonicDefault(page: Page) {
  await page.evaluate(
    `import("/src/store/settings.ts").then((m) => {
      m.useSettingsStore.getState().setDefaultLatexEngine("tectonic");
      return 1;
    })`,
  );
}

// Every test starts on a freshly reloaded SPA sitting in the library, so each
// one opens the project itself instead of inheriting the previous test's view.
async function openCompilerProject(page: Page) {
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  await useTectonicDefault(page);
  const exists = await page.evaluate<boolean>(
    `import("/src/store/files.ts").then((m) =>
      m.useFilesStore.getState().projects.some((p) => p.name === ${JSON.stringify(PROJECT)}))`,
  );
  if (exists) {
    await openProject(page, PROJECT);
    await waitLong(
      page,
      `!!document.querySelector('[data-tour="project-editor"] .cm-content')`,
      30_000,
    );
  } else {
    await createBlankProject(page, PROJECT);
  }
  await waitLong(
    page,
    `import("/src/store/files.ts").then((m) => m.useFilesStore.getState().engineLoaded)`,
    20_000,
  );
}

async function openCompileMenu(page: Page) {
  await waitLong(
    page,
    `import("/src/store/files.ts").then((m) => {
      const trigger = document.querySelector('[data-testid="compile-options-button"]');
      return m.useFilesStore.getState().engineLoaded && !!trigger && !trigger.matches(':disabled');
    })`,
    20_000,
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const opened = await page.evaluate<boolean>(
      pressWithPointer(
        `document.querySelector('[data-testid="compile-options-button"]')`,
      ),
    );
    if (!opened) continue;
    for (let tick = 0; tick < 20; tick++) {
      const visible = await page.evaluate<boolean>(
        `!!document.querySelector('[data-testid="compiler-tectonic"]')`,
      );
      if (visible) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await page.press("body", "Escape");
  }
  throw new Error("compile options menu did not open");
}

async function chooseCompiler(page: Page, testid: string) {
  await openCompileMenu(page);
  const clicked = await page.evaluate<boolean>(
    pressWithPointer(`document.querySelector('[data-testid="${testid}"]')`),
  );
  if (!clicked) throw new Error(`compiler item ${testid} not found`);
  await waitLong(
    page,
    `!document.querySelector('[data-testid="${testid}"]')`,
    10_000,
  );
}

async function engineState(page: Page) {
  return page.evaluate<{ id: string; flavor: string | null }>(
    `import("/src/store/files.ts").then((m) => {
      const engine = m.useFilesStore.getState().engine;
      return { id: engine.id, flavor: engine.tex_flavor ?? null };
    })`,
  );
}

async function waitForEngine(page: Page, id: string, flavor: string | null) {
  await waitLong(
    page,
    `import("/src/store/files.ts").then((m) => {
      const engine = m.useFilesStore.getState().engine;
      return m.useFilesStore.getState().engineLoaded
        && engine.id === ${JSON.stringify(id)}
        && (engine.tex_flavor ?? null) === ${JSON.stringify(flavor)};
    })`,
    20_000,
  );
}

// The selected radio item is the one Radix marks checked.
async function checkedCompiler(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(
    `(() => {
      const checked = [...document.querySelectorAll('[role="menuitemradio"]')]
        .find((item) => item.getAttribute("aria-checked") === "true"
          && (item.getAttribute("data-testid") ?? "").startsWith("compiler-"));
      return checked ? checked.getAttribute("data-testid") : null;
    })()`,
  );
}

async function expectCheckedCompiler(page: Page, testid: string) {
  await waitLong(
    page,
    `document.querySelector('[data-testid="${testid}"]')?.getAttribute("aria-checked") === "true"`,
    10_000,
  );
  expect(await checkedCompiler(page)).toBe(testid);
}

test("a new LaTeX project starts on Tectonic with no compiler pinned", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  await useTectonicDefault(tauriPage);
  // Always a brand new project: the claim under test is about what a project
  // starts as, which an already-pinned one from an earlier test cannot show.
  await createBlankProject(tauriPage, "Compiler Default");
  await waitLong(
    tauriPage,
    `import("/src/store/files.ts").then((m) => m.useFilesStore.getState().engineLoaded)`,
    20_000,
  );
  const initial = await engineState(tauriPage);
  expect(initial.id).toBe("latex");
  expect(initial.flavor).toBeNull();

  await openCompileMenu(tauriPage);
  await expectCheckedCompiler(tauriPage, "compiler-tectonic");
  await tauriPage.press("body", "Escape");
});

test("picking pdfLaTeX moves the project to latexmk and pins the compiler", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openCompilerProject(tauriPage);
  await chooseCompiler(tauriPage, "compiler-pdflatex");
  await waitForEngine(tauriPage, "latexmk", "pdflatex");

  // The menu reflects the stored pin, not just the engine.
  await openCompileMenu(tauriPage);
  await expectCheckedCompiler(tauriPage, "compiler-pdflatex");
  await tauriPage.press("body", "Escape");
});

test("the pinned compiler survives closing and reopening the project", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openCompilerProject(tauriPage);
  await chooseCompiler(tauriPage, "compiler-xelatex");
  await waitForEngine(tauriPage, "latexmk", "xelatex");

  await tauriPage.click('[title="Back to library"]');
  await openProject(tauriPage, PROJECT);
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-tour="project-editor"] .cm-content')`,
    30_000,
  );
  // project.json carried the choice, so the reopened project is still pinned.
  await waitForEngine(tauriPage, "latexmk", "xelatex");
});

test("switching compilers repins without leaving the latexmk engine", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openCompilerProject(tauriPage);
  await chooseCompiler(tauriPage, "compiler-pdflatex");
  await waitForEngine(tauriPage, "latexmk", "pdflatex");
  await chooseCompiler(tauriPage, "compiler-lualatex");
  await waitForEngine(tauriPage, "latexmk", "lualatex");
});

test("Auto keeps latexmk but clears the pin so the source decides", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openCompilerProject(tauriPage);
  await chooseCompiler(tauriPage, "compiler-pdflatex");
  await waitForEngine(tauriPage, "latexmk", "pdflatex");
  await chooseCompiler(tauriPage, "compiler-auto");
  await waitForEngine(tauriPage, "latexmk", null);

  await openCompileMenu(tauriPage);
  await expectCheckedCompiler(tauriPage, "compiler-auto");
  await tauriPage.press("body", "Escape");
});

test("Tectonic returns the project to the bundled engine and drops the pin", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openCompilerProject(tauriPage);
  await chooseCompiler(tauriPage, "compiler-pdflatex");
  await waitForEngine(tauriPage, "latexmk", "pdflatex");
  await chooseCompiler(tauriPage, "compiler-tectonic");
  await waitForEngine(tauriPage, "latex", null);
});
