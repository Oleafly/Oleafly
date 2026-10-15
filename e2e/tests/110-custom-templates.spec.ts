import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strToU8, zipSync } from "fflate";
import { test, expect } from "../fixtures";
import {
  createProjectFromTemplate,
  finishProjectCreation,
  openGallery,
  setNextImportPaths,
  waitLong,
  type Page,
} from "../helpers";
import { OVERLEAF_FIXTURE_TEMPLATE, startOverleafFixtureServer } from "../overleaf-fixture-server";

// Custom templates end to end: a ZIP becomes a template in the gallery, the
// projects made from it are independent copies, a project is saved back as a
// template, and a gallery link is copied through the signed-in account.

let server: Awaited<ReturnType<typeof startOverleafFixtureServer>>;

test.beforeAll(async () => {
  server = await startOverleafFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});

function writeZip(name: string, entries: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oleafly-template-"));
  const files: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(entries)) files[path] = strToU8(content);
  const zipPath = join(dir, name);
  writeFileSync(zipPath, zipSync(files));
  return zipPath;
}

async function customTemplate(page: Page, name: string) {
  return page.evaluate<{ id: string; category: string; license: { author: string } | null } | null>(
    `import("/src/lib/tauri.ts").then((m) => m.listTemplates()).then((all) => {
      const found = all.find((t) => t.name === ${JSON.stringify(name)} && t.source === "custom");
      return found ? { id: found.id, category: found.category, license: found.license } : null;
    })`,
  );
}

async function projectState(page: Page) {
  return page.evaluate<{ id: string; main: string; name: string; paths: string[] }>(
    `import("/src/store/files.ts").then((m) => {
      const s = m.useFilesStore.getState();
      return {
        id: s.projectId,
        main: s.mainDoc,
        name: s.projectName,
        paths: s.tree.filter((f) => !f.is_dir).map((f) => f.path),
      };
    })`,
  );
}

async function backToLibrary(page: Page) {
  const hasBack = await page.evaluate<boolean>(`!!document.querySelector('[title="Back to library"]')`);
  if (hasBack) await page.click('[title="Back to library"]');
  await waitLong(page, `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`, 30_000);
}

test("a ZIP imported as a template makes independent projects with every file", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  const zipPath = writeZip("E2E Lab Thesis.zip", {
    "lab-thesis/thesis.tex":
      "\\documentclass{report}\n\\input{preamble}\n\\begin{document}\\input{chapters/one}\\end{document}\n",
    "lab-thesis/preamble.tex": "\\usepackage{amsmath}\n",
    "lab-thesis/chapters/one.tex": "\\chapter{One}\nHello.\n",
    "lab-thesis/LICENSE": "LPPL 1.3c\n",
    "lab-thesis/labthesis.cls": "% a class file\n",
  });

  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="import-template"]');
  await expect(tauriPage.locator('[data-testid="template-import-dialog"]')).toBeVisible({ timeout: 20_000 });
  await setNextImportPaths(tauriPage, [zipPath]);
  await tauriPage.click('[data-testid="template-import-zip"]');
  await expect(tauriPage.locator('[data-testid="template-import-name"]')).toHaveValue("E2E Lab Thesis", {
    timeout: 20_000,
  });
  await tauriPage.click('[data-testid="template-import-save"]');

  // Saving lands on "Name your project" with the new template picked.
  await expect(tauriPage.locator("#new-project-name")).toBeVisible({ timeout: 30_000 });
  await tauriPage.fill("#new-project-name", "First from template");
  await finishProjectCreation(tauriPage);
  const first = await projectState(tauriPage);
  expect(first.main).toBe("thesis.tex");
  for (const path of ["thesis.tex", "preamble.tex", "chapters/one.tex", "LICENSE", "labthesis.cls"]) {
    expect(first.paths).toContain(path);
  }
  expect(first.paths.some((path) => path.startsWith("lab-thesis/"))).toBe(false);

  const template = await customTemplate(tauriPage, "E2E Lab Thesis");
  expect(template?.category).toBe("Custom");

  await backToLibrary(tauriPage);
  await createProjectFromTemplate(tauriPage, template?.id ?? "", "Second from template");
  const second = await projectState(tauriPage);
  expect(second.id).not.toBe(first.id);
  expect(second.name).toBe("Second from template");
  expect(second.paths).toContain("LICENSE");
  expect(second.paths).toContain("chapters/one.tex");
});

test("a library project is saved as a template from its menu", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank"]');
  await expect(tauriPage.locator("#new-project-name")).toBeVisible({ timeout: 20_000 });
  await tauriPage.fill("#new-project-name", "Lab master");
  await finishProjectCreation(tauriPage);
  await backToLibrary(tauriPage);

  await tauriPage.evaluate(
    `(() => {
      const books = Array.from(document.querySelectorAll('[data-testid="project-grid"] button[aria-label^="Open "]'));
      const book = books.find((b) => b.textContent.includes("Lab master"));
      const r = book.getBoundingClientRect();
      book.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2,
      }));
      return 1;
    })()`,
  );
  await expect(tauriPage.getByText("Save as template")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Save as template").click();
  await expect(tauriPage.locator('[data-testid="save-as-template-name"]')).toHaveValue("Lab master", {
    timeout: 20_000,
  });
  await tauriPage.fill('[data-testid="save-as-template-name"]', "Saved lab master");
  await tauriPage.click('[data-testid="save-as-template-save"]');
  await waitLong(
    tauriPage,
    `!document.querySelector('[data-testid="save-as-template-dialog"]')`,
    30_000,
  );

  const template = await customTemplate(tauriPage, "Saved lab master");
  expect(template?.category).toBe("Custom");
  // Templates live in the gallery, never in the project library.
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  const books = await tauriPage.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[data-testid="project-grid"] button[aria-label^="Open "]')).map((b) => b.getAttribute("aria-label") ?? "")`,
  );
  expect(books.some((label) => label.includes("Saved lab master"))).toBe(false);
});

test("a gallery link is imported through the signed-in account", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await tauriPage.evaluate(
    `import("/src/store/overleaf-import.ts").then((m) => m.useOverleafImportStore.getState().setServer(${JSON.stringify(server.base)}))`,
  );
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="import-template"]');
  await tauriPage.click('[data-testid="template-import-link"]');
  await tauriPage.fill(
    '[data-testid="template-import-link-input"]',
    `${server.base}${OVERLEAF_FIXTURE_TEMPLATE.page}`,
  );
  await tauriPage.click('[data-testid="template-import-look-up"]');
  const details = tauriPage.locator('[data-testid="template-import-details"]');
  await expect(details).toContainText(OVERLEAF_FIXTURE_TEMPLATE.title, { timeout: 30_000 });
  await expect(details).toContainText(OVERLEAF_FIXTURE_TEMPLATE.author);
  await expect(details).toContainText(OVERLEAF_FIXTURE_TEMPLATE.license);

  await tauriPage.click('[data-testid="template-import-link-save"]');
  // A fresh fixture port has no saved sign-in, so the dialog asks for one.
  await expect(tauriPage.locator('[data-testid="template-import-sign-in"]')).toBeVisible({ timeout: 30_000 });
  expect(server.templateCopies()).toBe(0);
  await tauriPage.click('[data-testid="template-import-sign-in"]');

  await expect(tauriPage.locator("#new-project-name")).toBeVisible({ timeout: 90_000 });
  expect(server.templateCopies()).toBe(1);
  const template = await customTemplate(tauriPage, OVERLEAF_FIXTURE_TEMPLATE.title);
  expect(template?.category).toBe("Custom");
  expect(template?.license?.author).toBe(OVERLEAF_FIXTURE_TEMPLATE.author);

  await tauriPage.fill("#new-project-name", "From the gallery");
  await finishProjectCreation(tauriPage);
  const project = await projectState(tauriPage);
  expect(project.main).toBe("thesis/main.tex");
  expect(project.paths).toContain("thesis/LICENSE");
  expect(project.paths).toContain("thesis/chapters/intro.tex");
});
