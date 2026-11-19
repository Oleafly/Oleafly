import { expect, test } from "@playwright/test";

async function openHarness(page: import("@playwright/test").Page, pages: 1 | 2 | 3, figure = false) {
  await page.goto(
    `${process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420"}/e2e/preview-window-harness.html?pages=${pages}${figure ? "&figure=1" : ""}`,
  );
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
  await expect(page.getByTestId("pdf-renderer")).toHaveAttribute(
    "data-pdf-state",
    "ready",
    { timeout: 30_000 },
  );
  await expect(page.getByLabel("Page number")).toHaveValue("1");
}

test("detached preview one-page controls stay bounded and zoom/invert work", async ({
  page,
}) => {
  await openHarness(page, 1);
  await expect(page.getByLabel("Two-page view")).toBeHidden();
  await expect(page.getByLabel("Single page view")).toBeHidden();
  await expect(page.getByLabel("Previous page")).toBeDisabled();
  await expect(page.getByLabel("Next page")).toBeDisabled();

  const zoom = page.getByTestId("detached-preview-zoom");
  const fitted = Number((await zoom.textContent())?.replace("%", ""));
  expect(Number.isFinite(fitted)).toBe(true);
  await page.getByLabel("Zoom in").click();
  await expect(zoom).toHaveText(`${fitted + 20}%`);
  await page.getByLabel("Zoom out").click();
  await expect(zoom).toHaveText(`${fitted}%`);

  const scroll = page.getByTestId("detached-preview-scroll");
  await page.getByLabel("Invert PDF preview colors").click();
  await expect(page.getByLabel("Invert PDF preview colors")).toHaveAttribute("aria-pressed", "true");
  const renderer = page.getByTestId("pdf-renderer");
  await expect(renderer).toHaveAttribute("data-pdf-colors", "dark");
  await expect(scroll).toHaveCSS("filter", "none");
  await expect(renderer.locator("[data-page] canvas").first()).toHaveCSS(
    "filter",
    "invert(1) hue-rotate(180deg)",
  );
  await page.getByLabel("Invert PDF preview colors").click();
  await expect(page.getByLabel("Invert PDF preview colors")).toHaveAttribute("aria-pressed", "false");
  await expect(renderer).not.toHaveAttribute("data-pdf-colors");
  await expect(renderer.locator("[data-page] canvas").first()).toHaveCSS("filter", "none");
});

test("inverted pages keep a figure in its own colours, edge to edge", async ({ page }) => {
  await openHarness(page, 1, true);
  const renderer = page.getByTestId("pdf-renderer");
  await page.getByLabel("Invert PDF preview colors").click();
  await expect(renderer).toHaveAttribute("data-pdf-colors", "dark");
  const figure = renderer.locator("[data-page] canvas.pdf-figure");
  await expect(figure).toHaveCount(1);
  await expect(figure).toHaveCSS("filter", "none");
  await expect(renderer.locator("[data-page] canvas.pdf-canvas")).toHaveCSS(
    "filter",
    "invert(1) hue-rotate(180deg)",
  );
  const corners = await figure.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return [];
    const at = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    return [at(0, 0), at(canvas.width - 1, 0), at(0, canvas.height - 1), at(canvas.width - 1, canvas.height - 1)];
  });
  expect(corners).toEqual([
    [214, 40, 40],
    [42, 157, 143],
    [38, 77, 228],
    [244, 162, 97],
  ]);
  const placed = await figure.evaluate((canvas) => {
    const wrap = canvas.parentElement?.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    if (!wrap) return null;
    return {
      left: (box.left - wrap.left) / wrap.width,
      top: (box.top - wrap.top) / wrap.height,
      width: box.width / wrap.width,
      height: box.height / wrap.height,
    };
  });
  expect(placed?.left).toBeCloseTo(156 / 612, 2);
  expect(placed?.top).toBeCloseTo(196 / 792, 2);
  expect(placed?.width).toBeCloseTo(300 / 612, 2);
  expect(placed?.height).toBeCloseTo(200 / 792, 2);
  await page.getByLabel("Invert PDF preview colors").click();
  await expect(figure).toBeHidden();
});

test("detached preview two-page layout, previous/input/next, and invalid bounds work", async ({
  page,
}) => {
  await openHarness(page, 3);
  const input = page.getByLabel("Page number");
  await expect(page.getByLabel("Two-page view")).toBeVisible();

  await page.getByLabel("Two-page view").click();
  await expect(page.getByLabel("Two-page view")).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Next page").click();
  await expect(input).toHaveValue("3");
  await expect(page.getByLabel("Next page")).toBeDisabled();
  await page.getByLabel("Previous page").click();
  await expect(input).toHaveValue("1");

  await input.fill("3");
  await input.press("Enter");
  await expect(input).toHaveValue("3");
  for (const invalid of ["", "0", "99", "letters"]) {
    await input.fill(invalid);
    await input.press("Enter");
    await expect(input).toHaveValue("3");
  }

  await expect(page.getByTestId("detached-preview-window")).toHaveAttribute(
    "data-preview-layout",
    "double",
  );
  await page.getByLabel("Single page view").click();
  await expect(page.getByLabel("Single page view")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("detached-preview-window")).toHaveAttribute(
    "data-preview-layout",
    "single",
  );
});

test("the document outline slides in and back out", async ({ page }) => {
  await openHarness(page, 1);
  const outline = page.locator("#detached-pdf-outline");
  const left = async () => Math.round((await outline.boundingBox())!.x);
  const panelWidth = async () => Math.round((await outline.boundingBox())!.width);

  const hidden = await left();
  expect(hidden).toBeLessThanOrEqual(-(await panelWidth()));
  await expect(outline).toHaveAttribute("inert", "");
  await expect(outline).toHaveCSS("transition-duration", "0.2s");

  await page.getByRole("button", { name: "Document outline", exact: true }).click();
  await expect(outline).not.toHaveAttribute("inert", "");
  await expect.poll(left).toBeGreaterThanOrEqual(0);

  await page
    .getByRole("button", { name: "Close document outline" })
    .click();
  await expect.poll(left).toBeLessThanOrEqual(-(await panelWidth()));
  await expect(outline).toHaveAttribute("inert", "");
});

test("paging scrolls the preview pane, not the page around it", async ({ page }) => {
  await openHarness(page, 3);
  await page.evaluate(() => {
    document.body.style.minHeight = "300vh";
    window.scrollTo(0, 0);
  });

  const scroller = page.getByTestId("detached-preview-scroll");
  const paneTop = async () => scroller.evaluate((el) => el.scrollTop);
  const initialTop = await paneTop();

  await page.getByLabel("Next page").click();
  await expect(page.getByLabel("Page number")).toHaveValue("2");

  await expect.poll(paneTop).toBeGreaterThan(initialTop);
  // ...and `scrollIntoView` did not drag every scrollable ancestor with it.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
