import { expect, test } from "@playwright/test";

interface SharedOutput {
  kind: string;
  compiledBy: string;
  mainFile: string;
}

test("an owner compiles in the browser, clicks between source and PDF, and shares the PDF", async ({ browser, page }) => {
  await page.goto("/auth/start?flow=web&as=olive");
  await expect(page).toHaveURL(/\/web\/\?project=demo$/u);
  const pdfPane = page.getByRole("region", { name: "PDF" }).first();
  const compile = pdfPane.getByTestId("compile");
  await expect(compile).toBeEnabled();
  await expect(page.locator('[data-active-file="f-main"] .cm-content')).toContainText("We model sea ice drift");

  await compile.click();
  await expect(pdfPane.getByTestId("pdf-label")).toContainText("Compiled in your browser in");
  await expect(pdfPane.locator("canvas").first()).toBeVisible();

  await pdfPane.locator(".textLayer span", { hasText: "Sea ice moves with wind" }).first().click();
  const intro = page.locator('[data-active-file="f-intro"]');
  const selected = intro.locator(".cm-selectionBackground").first();
  await expect(selected).toBeVisible();
  const line = await intro.locator(".cm-line", { hasText: "Sea ice moves with wind" }).boundingBox();
  const selection = await selected.boundingBox();
  expect(line && selection && selection.y >= line.y - 1 && selection.y < line.y + line.height).toBe(true);

  await page.getByTestId("show-in-pdf").click();
  await expect(pdfPane.locator(".ll-synctex-hl")).toBeVisible();

  await expect
    .poll(async () => {
      const response = await page.request.get("/web/api/projects/demo/output");
      const body = (await response.json()) as { items: SharedOutput[] };
      return body.items.map((item) => `${item.kind}:${item.compiledBy}:${item.mainFile}`).sort();
    })
    .toEqual(["pdf:olive:main.tex", "synctex:olive:main.tex"]);

  const other = await browser.newContext();
  const coauthor = await other.newPage();
  await coauthor.goto("/auth/start?flow=web&as=rita");
  const theirPdf = coauthor.getByRole("region", { name: "PDF" }).first();
  await expect(theirPdf.getByTestId("pdf-label")).toContainText("Compiled by Olive Owner");
  await theirPdf.locator(".textLayer span", { hasText: "Previous work used grids" }).first().click();
  await expect(coauthor.locator('[data-active-file="f-intro"] .cm-selectionBackground').first()).toBeVisible();
  await other.close();
});

test("a viewer compiles for themself and shares nothing", async ({ page }) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT") uploads.push(request.url());
  });
  await page.goto("/auth/start?flow=web&as=vic");
  const pdfPane = page.getByRole("region", { name: "PDF" }).first();
  await pdfPane.getByTestId("compile").click();
  await expect(pdfPane.getByTestId("pdf-label")).toContainText("Compiled in your browser in");
  await expect(pdfPane.locator("canvas").first()).toBeVisible();
  expect(uploads).toEqual([]);
});

test("a compile error lists the line in the log and opens it", async ({ page }) => {
  await page.goto("/auth/start?flow=web&as=eddie");
  const editor = page.locator('[data-active-file="f-main"] .cm-content');
  await expect(editor).toContainText("\\maketitle");
  await editor.getByText("\\maketitle").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" \\fakeerror");
  await page.keyboard.press("ControlOrMeta+s");
  const pdfPane = page.getByRole("region", { name: "PDF" }).first();
  await pdfPane.getByTestId("compile-log-toggle").click();
  const log = pdfPane.getByTestId("compile-log");
  await expect(log).toContainText("Errors: 1");
  await log.getByRole("button", { name: /Undefined control sequence/u }).click();
  await expect(page.locator('[data-active-file="f-main"] .cm-activeLine')).toContainText("\\fakeerror");
});
