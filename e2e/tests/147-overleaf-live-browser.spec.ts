import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

async function openHarness(page: Page, query: string) {
  await page.setViewportSize({ width: 420, height: 360 });
  await page.goto(`${BASE_URL}/e2e/overleaf-live-harness.html?${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
}

test("the toolbar says how live editing with Overleaf stands", async ({ page }) => {
  for (const [query, state, words] of [
    ["live=online", "upToDate", "Up to date"],
    ["live=connecting", "syncing", "Connecting to Overleaf…"],
    ["live=sending", "syncing", "Sending changes to Overleaf…"],
    ["live=offline", "offline", "Offline. Changes waiting: 3"],
    ["live=paused", "paused", "Paused"],
    ["live=signedout", "signedOut", "Signed out"],
  ] as const) {
    await openHarness(page, query);
    const button = page.getByTestId("overleaf-live-button");
    await expect(button).toHaveAttribute("data-sync-state", state);
    await button.click();
    await expect(page.getByTestId("overleaf-live-status")).toHaveText(words);
  }
});

test("Pause asks before leaving unsent changes behind", async ({ page }) => {
  await openHarness(page, "live=online");
  await page.getByTestId("overleaf-live-button").click();
  await page.getByRole("menuitem", { name: "Pause live editing" }).click();
  const dialog = page.getByTestId("overleaf-pause-dialog");
  await expect(dialog.getByText("Some changes haven't reached Overleaf yet")).toBeVisible();
  await expect(dialog.getByText("sections/intro.tex")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing live" }).click();
  await expect(dialog).toBeHidden();
});

test("a paused project with a Git token keeps the Git sync button, marked paused", async ({ page }) => {
  await openHarness(page, "linked=1&token=1&live=gitpaused");
  await expect(page.getByTestId("overleaf-live-paused-badge")).toHaveText("Live editing paused");
  await page.getByTestId("overleaf-sync-button").click();
  await expect(page.getByRole("menuitem", { name: "Resume live editing" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sync now" })).toBeVisible();
});

test("while offline the toolbar counts down to the next try on its own line", async ({ page }) => {
  await openHarness(page, "live=offline");
  await page.getByTestId("overleaf-live-button").click();
  await expect(page.getByTestId("overleaf-live-status")).toHaveText("Offline. Changes waiting: 3");
  await expect(page.getByTestId("overleaf-live-status-note")).toHaveText(/^Trying again in [1-4] s\.$/);
});

test("the banners show maintenance, a review, a merge and an unsteady file, and a review compares both copies", async ({
  page,
}) => {
  await openHarness(page, "live=maintenance&notice=maintenance&notice=review&notice=merged&notice=unsteady");
  await expect(page.getByTestId("overleaf-maintenance-banner")).toContainText("The server is restarting for an update.");
  await expect(page.getByTestId("overleaf-merged-row")).toContainText("main.tex");
  await expect(page.getByTestId("overleaf-unsteady-row")).toContainText("refs.bib");
  const review = page.getByTestId("overleaf-review-row");
  await expect(review).toContainText("sections/results.tex");
  await review.getByRole("button", { name: "Compare" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Red lines are yours and green lines are Overleaf's.");
  await expect(dialog.getByRole("button", { name: "Use Overleaf's" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use mine" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog).toBeHidden();
});
