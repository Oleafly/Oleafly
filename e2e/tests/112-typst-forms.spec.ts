import { readFileSync } from "node:fs";
import { test, expect } from "../fixtures";
import {
  compileAndWait,
  createProjectFromTemplate,
  editorSource,
  expectCompiledPdfContains,
  replaceEditorLiteral,
  replaceEditorSource,
  setTypstFormField,
  writeProjectText,
  type Page,
} from "../helpers";

test.describe.configure({ timeout: 300_000 });

const RUN = Date.now().toString(36);
const FIXTURE = new URL("../../test/fixtures/typst-forms/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURE), "utf8");
const VENDORED = "typst-packages/local/acme-report/0.1.0";

async function openVisual(page: Page) {
  await page.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(page.locator(".cm-editor.ofl-visual-parsed")).toBeVisible({ timeout: 20_000 });
}

async function openFormsFile(page: Page) {
  await page.evaluate(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().openFile("oleafly-forms.toml"))`,
  );
}

async function openMainDocument(page: Page) {
  await page.evaluate(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().openFile(useFilesStore.getState().mainDoc))`,
  );
}

async function saveActiveFile(page: Page) {
  await page.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().saveActive())`);
}

async function waitForReportCatalog(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          `import("/src/store/typst-forms.ts").then(({ useTypstFormsStore }) =>
            useTypstFormsStore.getState().loadedWith?.includes("@local/acme-report:0.1.0") === true)`,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function editFormsFile(page: Page, text: string) {
  await openFormsFile(page);
  await expect.poll(() => editorSource(page), { timeout: 10_000 }).toContain("[tool.oleafly]");
  await replaceEditorSource(page, text);
  await saveActiveFile(page);
}

async function writeFixtureProject(page: Page) {
  await writeProjectText(page, `${VENDORED}/typst.toml`, fixture("packages/local/acme-report/0.1.0/typst.toml"));
  await writeProjectText(page, `${VENDORED}/lib.typ`, fixture("packages/local/acme-report/0.1.0/lib.typ"));
  await writeProjectText(page, "oleafly-forms.toml", fixture("project/oleafly-forms.toml"));
  await writeProjectText(page, "template/memo.typ", fixture("project/template/memo.typ"));
  await page.evaluate(
    `Promise.all([import("/src/lib/typst-universe.ts"), import("/src/store/files.ts")]).then(([universe, files]) =>
      universe.setTypstVendorPackages(files.useFilesStore.getState().projectId, true))`,
  );
  await replaceEditorSource(page, fixture("project/report.typ"));
}

test("forms declared by a vendored template show as cards and chips and edit the report", async ({ tauriPage }) => {
  await createProjectFromTemplate(tauriPage, "blank-typst", `E2E Typst forms ${RUN}`);
  await writeFixtureProject(tauriPage);
  await compileAndWait(tauriPage);
  await openVisual(tauriPage);

  const cards = tauriPage.locator(".cm-content .ofl-visual-form-card");
  await expect(cards).toHaveCount(5, { timeout: 30_000 });
  await expect(tauriPage.locator(".cm-content .ofl-visual-form-chip-button")).toHaveText("Status: In review");

  await setTypstFormField(tauriPage, "Cover page", "Title", "Annual operations report", "enter");
  await expect.poll(() => editorSource(tauriPage), { timeout: 10_000 }).toContain('title: "Annual operations report"');

  await tauriPage.click(".cm-content .ofl-visual-form-chip-button");
  await expect(tauriPage.locator(".ofl-visual-form-popover")).toBeVisible();
  await setTypstFormField(tauriPage, "Status", "Status", "approved", "change");
  await expect.poll(() => editorSource(tauriPage), { timeout: 10_000 }).toContain('#badge("approved")');

  await compileAndWait(tauriPage);
  await expectCompiledPdfContains(tauriPage, "Annual operations report");
  await expectCompiledPdfContains(tauriPage, "Approved");
});

test("editing oleafly-forms.toml updates the cards and marks a broken definition", async ({ tauriPage }) => {
  await createProjectFromTemplate(tauriPage, "blank-typst", `E2E Typst forms file ${RUN}`);
  await writeFixtureProject(tauriPage);
  await openVisual(tauriPage);
  const formTitle = (text: string) =>
    tauriPage.locator(".cm-content .ofl-visual-form-card .ofl-visual-form-title").filter({ hasText: text });
  await expect(formTitle("Memo header")).toBeVisible({ timeout: 30_000 });

  await editFormsFile(tauriPage, fixture("project/oleafly-forms.toml").replace('label = "Memo header"', 'label = "Team memo"'));
  await openMainDocument(tauriPage);
  await expect(formTitle("Team memo")).toBeVisible({ timeout: 30_000 });
  await expect(formTitle("Memo header")).toBeHidden();

  await openFormsFile(tauriPage);
  await expect.poll(() => editorSource(tauriPage), { timeout: 10_000 }).toContain('label = "Team memo"');
  const markers = tauriPage.locator(".cm-editor .cm-lintRange-error");
  await replaceEditorLiteral(tauriPage, 'kind = "text", label = "To"', 'kind = "date", label = "To"');
  await expect(markers.first()).toBeVisible({ timeout: 30_000 });
  await replaceEditorLiteral(tauriPage, 'kind = "date", label = "To"', 'kind = "text", label = "To"');
  await expect(markers).toHaveCount(0, { timeout: 30_000 });
});

test("a Typst project without definitions shows no forms", async ({ tauriPage }) => {
  await createProjectFromTemplate(tauriPage, "blank-typst", `E2E Typst no forms ${RUN}`);
  await replaceEditorSource(tauriPage, fixture("project/report.typ"));
  await openVisual(tauriPage);
  await expect(tauriPage.locator(".cm-content .ofl-visual-typst-heading-1").first()).toBeVisible();
  await waitForReportCatalog(tauriPage);
  await expect(tauriPage.locator(".cm-content .ofl-visual-form-card, .cm-content .ofl-visual-form-chip")).toHaveCount(0);
  await expect(tauriPage.locator(".cm-content")).toContainText("#acme.cover-page(");
});
