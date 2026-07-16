import { test, expect } from "../fixtures";
import { openGallery } from "../helpers";

// Templates differ in class, packages, and layout, so this is the suite's
// regression net for "we changed something and a template broke".

const RUN = Date.now().toString(36);

// modern-resume downloads its font pack on creation, so it is network-gated
// like the font tests. diagram is the image-kind project, tested separately below.
const TEX_TEMPLATES = [
  "acm",
  "article-academic",
  "assignment",
  "ats-resume",
  "beamer",
  "bibliography",
  "blank",
  "book",
  "calendar",
  "elsevier",
  "ieee",
  "letter",
  "newsletter",
  "poster",
  "resume",
  "sidebar-resume",
  "thesis",
];
const NETWORK_TEMPLATES = ["modern-resume"];

async function createFromTemplate(page: import("../helpers").Page, id: string, name: string) {
  await openGallery(page);
  const card = page.locator(`[data-testid="template-card-${id}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.click(`[data-testid="template-card-${id}"]`, { timeout: 30_000 });
  await expect(page.locator("#new-project-name")).toBeVisible({ timeout: 10_000 });
  await page.fill("#new-project-name", name);
  await expect(page.getByTestId("create-project")).toBeEnabled({ timeout: 10_000 });
  await page.click('[data-testid="create-project"]');
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 60_000 });
}

async function compileClean(page: import("../helpers").Page) {
  await page.click('[aria-label="Recompile"]');
  await expect(page.locator(".pdf-canvas")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");
}

async function exportMenuItems(page: import("../helpers").Page): Promise<string> {
  await page.click('[aria-label="Export"]');
  await page.waitForFunction(
    `document.body.innerText.includes('Export source (.zip)')`,
    10_000,
  );
  return page.evaluate<string>(`document.body.innerText`);
}

for (const id of TEX_TEMPLATES) {
  test(`template ${id}: create and compile with zero errors`, async ({ tauriPage }) => {
    test.setTimeout(240_000);
    await createFromTemplate(tauriPage, id, `E2E T ${id} ${RUN}`);
    await compileClean(tauriPage);
  });
}

for (const id of NETWORK_TEMPLATES) {
  test(`template ${id}: create (with asset download) and compile with zero errors`, async ({ tauriPage }) => {
    test.skip(process.env.E2E_SKIP_NETWORK === "1", "needs network for the font pack");
    test.setTimeout(300_000);
    await createFromTemplate(tauriPage, id, `E2E T ${id} ${RUN}`);
    await compileClean(tauriPage);
  });
}

test("presentation export menu offers PowerPoint but not EPUB", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await createFromTemplate(tauriPage, "beamer", `E2E X beamer ${RUN}`);
  await compileClean(tauriPage);
  const items = await exportMenuItems(tauriPage);
  expect(items).toContain("Export as PowerPoint (.pptx)");
  expect(items).not.toContain("Export as EPUB");
  expect(items).toContain("Export as Word (.docx)");
});

test("book export menu offers EPUB but not PowerPoint", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await createFromTemplate(tauriPage, "book", `E2E X book ${RUN}`);
  await compileClean(tauriPage);
  const items = await exportMenuItems(tauriPage);
  expect(items).toContain("Export as EPUB (.epub)");
  expect(items).not.toContain("Export as PowerPoint");
});

test("plain document export menu offers neither PowerPoint nor EPUB", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await createFromTemplate(tauriPage, "blank", `E2E X doc ${RUN}`);
  await compileClean(tauriPage);
  const items = await exportMenuItems(tauriPage);
  expect(items).toContain("Export as Word (.docx)");
  expect(items).toContain("Export as HTML (.html)");
  expect(items).toContain("Export as Markdown (.md)");
  expect(items).toContain("Export as Plain text (.txt)");
  expect(items).not.toContain("Export as PowerPoint");
  expect(items).not.toContain("Export as EPUB");
});

test("image project exports an image, not document formats", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await createFromTemplate(tauriPage, "diagram", `E2E X image ${RUN}`);
  await compileClean(tauriPage);
  const items = await exportMenuItems(tauriPage);
  expect(items).toContain("Export as PNG (raster image)");
  expect(items).toContain("(vector image)");
  expect(items).not.toContain("Export as Word");
  expect(items).not.toContain("Export as PowerPoint");
  expect(items).not.toContain("Export as EPUB");
});
