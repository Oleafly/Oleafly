import { existsSync } from "node:fs";
import { type BrowserType, expect, type Locator, type Page, test, webkit } from "@playwright/test";

import { VITE_CLIENT_WITHOUT_TRANSPORT } from "../vite-client-without-transport";

type Rgb = readonly [number, number, number];
type Point = readonly [x: number, y: number];

const RED: Rgb = [200, 40, 40];
const GREEN: Rgb = [40, 160, 70];
const BLUE: Rgb = [40, 80, 200];
const YELLOW: Rgb = [220, 160, 30];

async function openFixture(page: Page) {
  await page.context().route("**/@vite/client", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: VITE_CLIENT_WITHOUT_TRANSPORT }),
  );
  await page.goto(`${process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420"}/e2e/pdf-dark-figures-harness.html`);
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
  await expect(page.getByTestId("pdf-renderer")).toHaveAttribute("data-pdf-state", "ready", { timeout: 30_000 });
}

async function showPage(page: Page, number: number): Promise<Locator> {
  const wrap = page.locator(`[data-page='${number}']`);
  await wrap.scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        wrap.evaluate((node) => {
          const canvas = node.querySelector(":scope > canvas:not(.pdf-figure)");
          return canvas instanceof HTMLCanvasElement && canvas.width > 0;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  return wrap;
}

function figureLayers(wrap: Locator) {
  return wrap.evaluate((node) =>
    Array.from(node.querySelectorAll<HTMLCanvasElement>(":scope > canvas.pdf-figure"), (layer) => ({
      left: Number.parseFloat(layer.style.left),
      top: Number.parseFloat(layer.style.top),
      width: Number.parseFloat(layer.style.width),
      height: Number.parseFloat(layer.style.height),
    })),
  );
}

async function colorsAt(page: Page, wrap: Locator, points: readonly Point[]): Promise<Rgb[]> {
  const shot = await wrap.screenshot();
  return page.evaluate(
    async ({ data, at }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D context to read the screenshot");
      context.drawImage(image, 0, 0);
      return at.map(([x, y]) => {
        const [red, green, blue] = context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data;
        return [red, green, blue] as const;
      });
    },
    { data: shot.toString("base64"), at: points },
  );
}

function expectColor(actual: Rgb, expected: Rgb) {
  actual.forEach((channel, index) => expect(Math.abs(channel - expected[index])).toBeLessThanOrEqual(30));
}

function expectDark(actual: Rgb) {
  for (const channel of actual) expect(channel).toBeLessThanOrEqual(90);
}

async function figuresKeepTheirColors(page: Page) {
  await openFixture(page);

  const vector = await showPage(page, 1);
  await expect.poll(() => figureLayers(vector)).toHaveLength(1);
  const [figure] = await figureLayers(vector);
  const placed = [figure.left, figure.top, figure.width, figure.height];
  [25.5, 24.2, 49, 25.3].forEach((percent, index) => expect(Math.abs(placed[index] - percent)).toBeLessThanOrEqual(1.5));
  const [paper, margin] = await colorsAt(page, vector, [
    [0.418, 0.419],
    [0.05, 0.95],
  ]);
  for (const channel of paper) expect(channel).toBeGreaterThanOrEqual(230);
  expectDark(margin);

  const grid = await showPage(page, 2);
  await expect.poll(() => figureLayers(grid)).toHaveLength(1);
  const [first, tenth] = await colorsAt(page, grid, [
    [0.163, 0.266],
    [0.261, 0.3245],
  ]);
  expectColor(first, RED);
  expectColor(tenth, GREEN);

  const bleed = await showPage(page, 3);
  await expect.poll(() => figureLayers(bleed)).toHaveLength(1);
  const [lower, upper] = await colorsAt(page, bleed, [
    [0.5, 0.5],
    [0.5, 0.15],
  ]);
  expectColor(lower, BLUE);
  expectColor(upper, YELLOW);

  const scanned = await showPage(page, 4);
  expect(await figureLayers(scanned)).toEqual([]);
  const [scannedPaper] = await colorsAt(page, scanned, [[0.5, 0.97]]);
  expectDark(scannedPaper);

  const faded = await showPage(page, 5);
  expect(await figureLayers(faded)).toEqual([]);
  const [fadedPaper] = await colorsAt(page, faded, [[0.418, 0.419]]);
  expectDark(fadedPaper);
}

test("PDF dark mode keeps included figures and photos in their own colors in Chromium", async ({ page }) => {
  await figuresKeepTheirColors(page);
});

const otherEngines: ReadonlyArray<readonly [string, BrowserType]> = [["WebKit", webkit]];

for (const [name, browserType] of otherEngines) {
  test(`PDF dark mode keeps included figures and photos in their own colors in ${name}`, async () => {
    // Ignored on purpose when that Playwright browser was never downloaded on this runner.
    test.skip(!existsSync(browserType.executablePath()), `${name} Playwright browser is not installed on this runner`);
    const browser = await browserType.launch();
    try {
      await figuresKeepTheirColors(await browser.newPage());
    } finally {
      await browser.close();
    }
  });
}
