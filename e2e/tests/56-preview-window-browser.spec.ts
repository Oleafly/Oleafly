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
  await expect(page.getByLabel("Single page view")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Previous page")).toBeDisabled();
  await expect(page.getByLabel("Next page")).toBeDisabled();

  await expect(page.getByTestId("detached-preview-zoom")).toHaveText("100%");
  await page.getByLabel("Zoom in").click();
  await expect(page.getByTestId("detached-preview-zoom")).toHaveText("120%");
  await page.getByLabel("Zoom out").click();
  await expect(page.getByTestId("detached-preview-zoom")).toHaveText("100%");

  const scroll = page.getByTestId("detached-preview-scroll");
  await page.getByLabel("Invert colors").click();
  await expect(page.getByLabel("Invert colors")).toHaveAttribute("aria-pressed", "true");
  await expect(scroll).toHaveCSS("filter", "invert(1) hue-rotate(180deg)");
  await page.getByLabel("Invert colors").click();
  await expect(page.getByLabel("Invert colors")).toHaveAttribute("aria-pressed", "false");
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
