import { existsSync } from "node:fs";
import {
  expect,
  firefox,
  type BrowserType,
  type Page,
  test,
  webkit,
} from "@playwright/test";

const VITE_CLIENT_WITHOUT_TRANSPORT = String.raw`
const styles = new Map();
export class ErrorOverlay extends HTMLElement {}
export function createHotContext() {
  return {
    accept() {},
    acceptExports() {},
    decline() {},
    dispose() {},
    invalidate() {},
    on() {},
    off() {},
    prune() {},
    send() {},
  };
}
export function updateStyle(id, content) {
  let style = styles.get(id);
  if (!style) {
    style = document.createElement("style");
    style.dataset.viteDevId = id;
    document.head.appendChild(style);
    styles.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  styles.get(id)?.remove();
  styles.delete(id);
}
export function injectQuery(url) { return url; }
`;

async function dragAcrossProductionPdf(page: Page) {
  // This fixture verifies Oleafly's production PDF renderer, not Vite's
  // development transport. Playwright Firefox can receive Vite's HMR socket
  // events out of order and abort inside its adapter. Keep Vite's CSS module
  // contract while removing only that unrelated WebSocket.
  await page.context().route("**/@vite/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: VITE_CLIENT_WITHOUT_TRANSPORT,
    }),
  );
  await page.goto(
    "http://localhost:1420/e2e/pdf-viewer-selection-harness.html",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-fixture-state",
    "mounted",
  );
  const renderer = page.getByTestId("pdf-renderer");
  await expect(renderer).toHaveAttribute("data-pdf-state", "ready", {
    timeout: 30_000,
  });
  await expect(
    page.locator(".textLayer span").filter({ hasText: "Cross-span start" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(".textLayer span").filter({
      hasText: "and reaches another line",
    }),
  ).toBeVisible();

  const first = await page
    .locator(".textLayer span")
    .filter({ hasText: "Cross-span start" })
    .first()
    .boundingBox();
  const last = await page
    .locator(".textLayer span")
    .filter({ hasText: "and reaches another line" })
    .first()
    .boundingBox();
  expect(first).not.toBeNull();
  expect(last).not.toBeNull();
  if (!first || !last) throw new Error("Production text spans have no geometry");

  // Playwright mouse input is browser-trusted input. Native WKWebView evidence
  // remains a separate platform limitation: the Tauri and Orca bridges expose
  // only synthetic DOM events, not a safe deterministic CGEvent injection path.
  await page.mouse.move(first.x + 0.5, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 0.5, last.y + last.height / 2, {
    steps: 24,
  });
  await page.mouse.up();
  await page.waitForTimeout(50);

  const result = await page.evaluate(() => {
    const layer = document.querySelector(".textLayer");
    const pdfPage = document.querySelector<HTMLElement>("[data-page='1']");
    const canvas = pdfPage?.querySelector("canvas");
    const renderer = document.querySelector<HTMLElement>(
      "[data-testid='pdf-renderer']",
    );
    const sentinel = layer?.querySelector(".endOfContent");
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const layerRect = layer?.getBoundingClientRect();
    const pageRect = pdfPage?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const rects = range ? Array.from(range.getClientRects()) : [];
    const glyphRects = rects.filter(
      (rect) => rect.width > 0.5 && rect.height > 0.5,
    );
    const outsideRects = pageRect
      ? glyphRects
          .filter(
            (rect) =>
              rect.left < pageRect.left - 1 ||
              rect.top < pageRect.top - 1 ||
              rect.right > pageRect.right + 1 ||
              rect.bottom > pageRect.bottom + 1,
          )
          .map((rect) => ({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          }))
      : [];
    return {
      text: selection?.toString() ?? "",
      engine: navigator.userAgent,
      rendererState: renderer?.dataset.pdfState,
      geometryState: pdfPage?.dataset.pdfGeometry,
      canvasScaling: pdfPage?.dataset.pdfCanvasScaling,
      hasCanvasPixels:
        canvas instanceof HTMLCanvasElement &&
        canvas.width > 0 &&
        canvas.height > 0,
      sentinelInsideLayer: sentinel?.parentElement === layer,
      rectCount: rects.length,
      glyphRectCount: glyphRects.length,
      layerRect: layerRect
        ? {
            left: layerRect.left,
            top: layerRect.top,
            right: layerRect.right,
            bottom: layerRect.bottom,
          }
        : null,
      pageRect: pageRect
        ? {
            left: pageRect.left,
            top: pageRect.top,
            right: pageRect.right,
            bottom: pageRect.bottom,
          }
        : null,
      canvasRect: canvasRect
        ? {
            left: canvasRect.left,
            top: canvasRect.top,
            right: canvasRect.right,
            bottom: canvasRect.bottom,
          }
        : null,
      outsideRects,
    };
  });

  expect(result.text).toContain("Cross-span start");
  expect(result.text).toContain("continues here");
  expect(result.text).toContain("and reaches another line");
  expect(result.rendererState).toBe("ready");
  expect(result.geometryState).toBe("exact");
  expect(result.canvasScaling).toMatch(/^(native|restricted)$/);
  expect(result.hasCanvasPixels).toBe(true);
  expect(result.sentinelInsideLayer).toBe(true);
  expect(result.rectCount).toBeGreaterThanOrEqual(3);
  expect(result.glyphRectCount).toBeGreaterThanOrEqual(3);
  expect(result.layerRect).not.toBeNull();
  expect(result.pageRect).not.toBeNull();
  expect(result.canvasRect).not.toBeNull();
  if (result.layerRect && result.pageRect && result.canvasRect) {
    for (const edge of ["left", "top", "right", "bottom"] as const) {
      expect(
        Math.abs(result.layerRect[edge] - result.pageRect[edge]),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(result.canvasRect[edge] - result.pageRect[edge]),
      ).toBeLessThanOrEqual(1);
    }
  }
  expect(result.outsideRects).toEqual([]);
  return result;
}

test("production PdfViewer selects real PDF text with trusted Chromium pointer input", async ({
  page,
}) => {
  await dragAcrossProductionPdf(page);
});

// Playwright Firefox on macOS can abort inside its worker-WebSocket adapter
// before any product assertion runs. Oleafly's macOS runtime is WebKit, which
// remains mandatory below; Linux keeps the independent Firefox evidence.
const crossBrowserTargets: ReadonlyArray<readonly [string, BrowserType]> = [
  ...(process.platform === "darwin"
    ? []
    : ([
        ["Firefox", firefox],
      ] as const)),
  ["WebKit", webkit],
];

for (const [name, browserType] of crossBrowserTargets) {
  test(`production PdfViewer keeps trusted selection exact in ${name}`, async () => {
    const executable = browserType.executablePath();
    test.skip(
      !existsSync(executable),
      `${name} Playwright browser is not installed on this runner`,
    );
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage();
      await dragAcrossProductionPdf(page);
    } finally {
      await browser.close();
    }
  });
}

test("low-level selection sentinel fixture remains bounded in Chromium", async ({
  page,
}) => {
  await page.goto("http://localhost:1420/e2e/pdf-selection-harness.html");
  const first = await page.locator('[data-token="first"]').boundingBox();
  const last = await page.locator('[data-token="last"]').boundingBox();
  expect(first).not.toBeNull();
  expect(last).not.toBeNull();
  if (!first || !last) return;

  await page.mouse.move(first.x + 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 2, last.y + last.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  const result = await page.evaluate(() => {
    const layer = document.querySelector(".textLayer");
    const layerRect = layer?.getBoundingClientRect();
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const glyphRects = range
      ? Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0.5 && rect.height > 0.5,
        )
      : [];
    return {
      text: selection?.toString() ?? "",
      sentinelInsideLayer:
        layer?.querySelector(".endOfContent")?.parentElement === layer,
      outside:
        layerRect &&
        glyphRects.some(
          (rect) =>
            rect.left < layerRect.left - 0.5 ||
            rect.top < layerRect.top - 0.5 ||
            rect.right > layerRect.right + 0.5 ||
            rect.bottom > layerRect.bottom + 0.5,
        ),
    };
  });
  expect(result.text).toContain("Cross-span start");
  expect(result.text).toContain("and reaches another line");
  expect(result.sentinelInsideLayer).toBe(true);
  expect(result.outside).toBe(false);
});
