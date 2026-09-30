import { test, expect } from "../fixtures";
import type { Page } from "../helpers";

// Issue #169: after sleep with a HiDPI display, the main webview could end up
// at half the window's width and height, pinned top-left, while the window
// itself stayed full size. On macOS the app now lets AppKit size the webview,
// and focus, scale and resize events put a drifted frame back. These tests
// break the frame natively through the e2e-only `debug_webview_frame` command
// and then check what the page itself sees.
//
// On macOS Tauri computes a single-webview window's innerSize() from the
// webview's own frame, so innerSize() cannot tell a small webview from a small
// window. The tests also compare against the native content view and the size
// they asked the window to be.

const macOS = process.platform === "darwin";
test.skip(!macOS, "The webview frame fix is macOS-only.");

type Frame = { x: number; y: number; width: number; height: number };
type FrameProbe = { frame: Frame; container: Frame; scale: number; autoresizes: boolean };
type Viewport = {
  innerWidth: number;
  innerHeight: number;
  logicalWidth: number;
  logicalHeight: number;
};

function frameStep(page: Page, step: "measure" | "shrink" | "resync" | "resize-window") {
  return page.evaluate<FrameProbe>(
    `window.__TAURI_INTERNALS__.invoke("debug_webview_frame", { label: "main", step: ${JSON.stringify(step)} })`,
  );
}

function viewport(page: Page) {
  return page.evaluate<Viewport>(`(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const [size, scale] = await Promise.all([
      invoke("plugin:window|inner_size", { label: "main" }),
      invoke("plugin:window|scale_factor", { label: "main" }),
    ]);
    return {
      innerWidth,
      innerHeight,
      logicalWidth: size.width / scale,
      logicalHeight: size.height / scale,
    };
  })()`);
}

async function resizeWindow(page: Page, width: number, height: number) {
  await page.evaluate(
    `import("/src/lib/e2e-probe.ts").then(w => w.resizeCurrentWindow(${width}, ${height}))`,
  );
}

function appLog(page: Page) {
  return page.evaluate<string>(
    `window.__TAURI_INTERNALS__.invoke("read_app_log", { maxBytes: 65536 })`,
  );
}

// Largest gap, in points, between the webview frame and the content view.
function frameGap({ frame, container }: FrameProbe) {
  return Math.max(
    Math.abs(frame.x - container.x),
    Math.abs(frame.y - container.y),
    Math.abs(frame.width - container.width),
    Math.abs(frame.height - container.height),
  );
}

// Waits until the page's viewport is width x height CSS px (innerWidth and
// innerHeight are whole numbers, so allow 1 px of rounding).
async function expectViewport(page: Page, width: number, height: number) {
  await expect
    .poll(
      async () => {
        const { innerWidth, innerHeight } = await viewport(page);
        return Math.max(Math.abs(innerWidth - width), Math.abs(innerHeight - height));
      },
      { message: `page viewport should be ${width}x${height}`, timeout: 10_000 },
    )
    .toBeLessThanOrEqual(1);
}

// Sizes the window and waits until the content view, the webview and the
// page all agree on the new size.
async function settleWindow(page: Page, width: number, height: number) {
  await resizeWindow(page, width, height);
  await expect
    .poll(async () => {
      const { container } = await frameStep(page, "measure");
      return [Math.round(container.width), Math.round(container.height)];
    })
    .toEqual([width, height]);
  await expect.poll(async () => frameGap(await frameStep(page, "measure"))).toBeLessThanOrEqual(0.5);
  await expectViewport(page, width, height);
}

async function expectLogicalSizeMatchesPage(page: Page) {
  const { innerWidth, innerHeight, logicalWidth, logicalHeight } = await viewport(page);
  expect(Math.abs(logicalWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(logicalHeight - innerHeight)).toBeLessThanOrEqual(1);
}

test.afterEach(async ({ tauriPage }) => {
  if (!macOS) return;
  // Never hand a half-size webview to the next spec.
  await frameStep(tauriPage, "resync");
  await settleWindow(tauriPage, 1200, 800);
});

test("AppKit keeps the main webview filling its window as the window resizes", async ({
  tauriPage: page,
}) => {
  await settleWindow(page, 1200, 800);
  const measured = await frameStep(page, "measure");
  expect(measured.autoresizes).toBe(true);
  await expectLogicalSizeMatchesPage(page);

  // Resize natively and measure in the same main-thread turn. tao's Resized
  // event has not reached Tauri yet, so only AppKit can have sized the
  // webview. Before the fix it still had the old size at this point.
  const resized = await frameStep(page, "resize-window");
  expect(Math.round(resized.container.width)).toBe(1160);
  expect(Math.round(resized.container.height)).toBe(760);
  expect(frameGap(resized)).toBeLessThanOrEqual(0.5);
  await expectViewport(page, 1160, 760);
  await expectLogicalSizeMatchesPage(page);

  // A resize through the Tauri window API ends with the page at the size
  // that was asked for.
  await settleWindow(page, 1000, 700);
  await expectLogicalSizeMatchesPage(page);
});

test("a webview stuck at half the window's size is put back over the whole window", async ({
  tauriPage: page,
}) => {
  await settleWindow(page, 1200, 800);

  const shrunk = await frameStep(page, "shrink");
  expect(Math.round(shrunk.frame.width)).toBe(600);
  expect(Math.round(shrunk.frame.height)).toBe(400);
  // The page lays itself out for the half-size viewport, as in the
  // screenshots attached to #169.
  await expectViewport(page, 600, 400);

  const repaired = await frameStep(page, "resync");
  expect(frameGap(repaired)).toBeLessThanOrEqual(0.5);
  await expectViewport(page, 1200, 800);
  await expectLogicalSizeMatchesPage(page);
  await expect
    .poll(() => appLog(page))
    .toMatch(
      /Webview frame corrected in the main window on an e2e request: 600x400 at \(0, \d+\) -> 1200x800 at \(0, 0\) points, backing scale \d/,
    );

  // The same repair runs on window events: a resize puts the frame back.
  // AppKit alone would only have shrunk the half-size frame by the same
  // amount as the window.
  await frameStep(page, "shrink");
  await expectViewport(page, 600, 400);
  await resizeWindow(page, 1100, 760);
  await expectViewport(page, 1100, 760);
  expect(frameGap(await frameStep(page, "measure"))).toBeLessThanOrEqual(0.5);
  await expectLogicalSizeMatchesPage(page);
  await expect
    .poll(() => appLog(page))
    .toMatch(
      /Webview frame corrected in the main window on resize: \S+ at \(0, \d+\) -> 1100x760 at \(0, 0\) points, backing scale \d/,
    );
});
