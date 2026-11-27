import { existsSync } from "node:fs";
import { chromium, expect, type Page, test, webkit } from "@playwright/test";
import enPreview from "../../src/i18n/locales/en/preview.json" with { type: "json" };

async function expectPaintedPage(page: Page, number: number) {
  const wrap = page.locator(`[data-page="${number}"]`);
  await expect(wrap.locator("canvas.pdf-canvas")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => wrap.evaluate((element) => {
    const canvas = element.querySelector<HTMLCanvasElement>("canvas.pdf-canvas");
    const scroller = element.closest("[data-pdf-scroll-root]");
    if (!canvas || !scroller) return false;
    const rect = canvas.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    const context = canvas.getContext("2d");
    if (!context || rect.bottom <= viewport.top || rect.top >= viewport.bottom) return false;
    // A mounted canvas alone is not evidence that the PDF actually painted.
    // Require both opaque paper and non-white ink in its backing store.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let paper = false;
    let ink = false;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] !== 255) continue;
      if (pixels[offset] > 240 && pixels[offset + 1] > 240 && pixels[offset + 2] > 240) paper = true;
      if (pixels[offset] < 100 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100) ink = true;
      if (paper && ink) return true;
    }
    return false;
  }), { timeout: 30_000 }).toBe(true);
  await expect(page.getByRole("textbox", { name: enPreview.pages.number })).toHaveValue(String(number));
}

for (const browserType of [chromium, webkit]) {
  test(`PDF page input commits once and paints after Enter and Tab in ${browserType.name()}`, async () => {
    test.skip(browserType === webkit && !existsSync(webkit.executablePath()), "Playwright WebKit is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const pdfPath = process.env.OLEAFLY_PDF_NAVIGATION_FIXTURE;
      if (pdfPath) {
        await page.route("**/e2e/navigation-fixture.pdf", (route) =>
          route.fulfill({ path: pdfPath, contentType: "application/pdf" }),
        );
      }
      // Observe actual scroll commands from the production toolbar and viewer,
      // not a mock gotoPage implementation. Record only synchronous commands
      // issued during this input's trusted keydown/blur event sequence.
      await page.addInitScript(() => {
        let commands: number | null = null;
        const scrollTo = Element.prototype.scrollTo;
        Element.prototype.scrollTo = function (...args: Parameters<Element["scrollTo"]>) {
          if (commands !== null && this.hasAttribute("data-pdf-scroll-root")) commands++;
          return scrollTo.apply(this, args);
        };
        document.addEventListener("keydown", (event) => {
          if (!(event.target instanceof HTMLInputElement) || event.key !== "Enter") return;
          delete document.body.dataset.navigationCommands;
          delete document.body.dataset.navigationDefaultPrevented;
          commands = 0;
          setTimeout(() => {
            document.body.dataset.navigationCommands = String(commands);
            document.body.dataset.navigationDefaultPrevented = String(event.defaultPrevented);
            commands = null;
          }, 0);
        }, true);
      });
      const base = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";
      await page.goto(`${base}/e2e/pdf-navigation-harness.html${pdfPath ? "?external" : ""}`);
      await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
      await expect(page.getByTestId("pdf-renderer")).toHaveAttribute("data-pdf-state", "ready", { timeout: 30_000 });
      await expectPaintedPage(page, 1);
      const input = page.getByRole("textbox", { name: enPreview.pages.number });
      const total = Number(await page.getByTestId("pdf-renderer").getAttribute("data-pdf-page-count"));
      expect(total).toBeGreaterThanOrEqual(3);

      for (const target of [2, total - 1, 1, Math.ceil(total / 2)]) {
        await input.fill(String(target));
        await input.press("Enter");
        await expect(page.locator("body")).toHaveAttribute("data-navigation-commands", "1");
        await expect(page.locator("body")).toHaveAttribute("data-navigation-default-prevented", "true");
        await expect(input).not.toBeFocused();
        await expectPaintedPage(page, target);
      }
      await input.fill(String(total));
      await input.press("Tab");
      await expectPaintedPage(page, total);
      await page.getByRole("button", { name: enPreview.pages.previous, exact: true }).click();
      await expectPaintedPage(page, total - 1);
      await page.getByRole("button", { name: enPreview.pages.next, exact: true }).click();
      await expectPaintedPage(page, total);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
}
