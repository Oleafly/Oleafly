import { expect, test } from "@playwright/test";

async function openHarness(page: import("@playwright/test").Page, pages: 1 | 2 | 3) {
  await page.goto(
    `http://localhost:1420/e2e/preview-window-harness.html?pages=${pages}`,
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

  // The window fits the first page to the viewport on load, so the starting
  // zoom depends on the harness window size. Assert the step, not the origin.
  const zoom = page.getByTestId("detached-preview-zoom");
  const fitted = Number((await zoom.textContent())?.replace("%", ""));
  expect(Number.isFinite(fitted)).toBe(true);
  await page.getByLabel("Zoom in").click();
  await expect(zoom).toHaveText(`${fitted + 20}%`);
  await page.getByLabel("Zoom out").click();
  await expect(zoom).toHaveText(`${fitted}%`);

  const scroll = page.getByTestId("detached-preview-scroll");
  await page.getByLabel("Invert PDF colors").click();
  await expect(page.getByLabel("Invert PDF colors")).toHaveAttribute("aria-pressed", "true");
  await expect(scroll).toHaveCSS("filter", "invert(1) hue-rotate(180deg)");
  await page.getByLabel("Invert PDF colors").click();
  await expect(page.getByLabel("Invert PDF colors")).toHaveAttribute("aria-pressed", "false");
  await expect(scroll).toHaveCSS("filter", "none");
});

test("detached preview two-page layout, previous/input/next, and invalid bounds work", async ({
  page,
}) => {
  await openHarness(page, 3);
  const input = page.getByLabel("Page number");
  await expect(page.getByLabel("Two-page view")).toBeVisible();

  // Change layout first so navigation proves it reads the live spread mode
  // instead of a stale click-handler closure.
  await page.getByLabel("Two-page view").click();
  await expect(page.getByLabel("Two-page view")).toHaveAttribute("aria-pressed", "true");
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
  await expect(page.getByLabel("Single page view")).toHaveAttribute("aria-pressed", "true");
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

  // Closed: parked off the left edge, and out of reach of keyboard and pointer.
  const hidden = await left();
  expect(hidden).toBeLessThanOrEqual(-(await panelWidth()));
  await expect(outline).toHaveAttribute("inert", "");
  // An invalid arbitrary value would silently leave the panel at rest, so pin
  // the transition that carries it on and off screen.
  await expect(outline).toHaveCSS("transition-duration", "0.2s");

  // The always-mounted panel shares this accessible name, so target the button.
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
  // Give the window an outer scrollbar, as the docked preview has inside the app.
  await page.evaluate(() => {
    document.body.style.minHeight = "300vh";
    window.scrollTo(0, 0);
  });

  const scroller = page.getByTestId("detached-preview-scroll");
  const paneTop = async () => scroller.evaluate((el) => el.scrollTop);
  expect(await paneTop()).toBe(0);

  await page.getByLabel("Next page").click();
  await expect(page.getByLabel("Page number")).toHaveValue("2");

  // The pane moved to the next page...
  await expect.poll(paneTop).toBeGreaterThan(0);
  // ...and `scrollIntoView` did not drag every scrollable ancestor with it.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
