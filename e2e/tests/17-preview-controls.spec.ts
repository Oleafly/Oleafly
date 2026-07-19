import { test, expect } from "../fixtures";
import { openProject, openRailTab } from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 180_000,
  });
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toBeEnabled({ timeout: 60_000 });
});

test("zoom controls change the zoom level", async ({ tauriPage }) => {
  const zoom = () =>
    tauriPage.evaluate<string>(
      `(document.body.innerText.match(/(\\d+)%/) || ["", "?"])[1]`,
    );
  const before = await zoom();
  await tauriPage.click('[aria-label="Zoom in"]');
  const after = await zoom();
  expect(Number(after)).toBeGreaterThan(Number(before));
  await tauriPage.click('[aria-label="Zoom out"]');
  expect(await zoom()).toBe(before);
});

test("zoom menu applies presets and calculated fit scales", async ({ tauriPage }) => {
  const trigger = tauriPage.locator('[aria-haspopup="menu"][aria-label^="Zoom "]');

  await trigger.focus();
  await trigger.press("Enter");
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  await tauriPage.getByRole("menu").getByText("400%", { exact: true }).click();
  await expect(trigger).toHaveText(/400%/);
  await expect(tauriPage.locator('button[aria-label="Zoom in"]')).toBeDisabled();

  await trigger.focus();
  await trigger.press("Enter");
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  await tauriPage.getByRole("menu").getByText("25%", { exact: true }).click();
  await expect(trigger).toHaveText(/25%/);
  await expect(tauriPage.locator('button[aria-label="Zoom out"]')).toBeDisabled();

  await trigger.focus();
  await trigger.press("Enter");
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  await tauriPage.getByRole("menu").getByText("Fit to width", { exact: true }).click();
  const widthScale = Number((await trigger.textContent())?.match(/\d+/)?.[0]);
  expect(widthScale).toBeGreaterThanOrEqual(25);
  expect(widthScale).toBeLessThan(400);

  await trigger.focus();
  await trigger.press("Enter");
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  await tauriPage.getByRole("menu").getByText("Fit to height", { exact: true }).click();
  const heightScale = Number((await trigger.textContent())?.match(/\d+/)?.[0]);
  expect(heightScale).toBeGreaterThanOrEqual(25);
  expect(heightScale).toBeLessThan(400);
});

test("one-page documents hide two-page layout and bound page navigation", async ({
  tauriPage,
}) => {
  await expect(tauriPage.locator('[aria-label="Two-page view"]')).not.toBeVisible();
  await expect(tauriPage.locator('[aria-label="Single page view"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tauriPage.locator('[aria-label="Previous page"]')).toBeDisabled();
  await expect(tauriPage.locator('[aria-label="Next page"]')).toBeDisabled();
  await expect(tauriPage.locator('[aria-label="Page number"]')).toHaveValue("1");
});

test("invert colors toggles on and off", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Invert PDF preview colors"]');
  await tauriPage.click('[aria-label="Invert PDF preview colors"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible();
});

test("save PDF into the project creates a real project file", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Save PDF to project"]');
  const name = `e2e-saved-${Date.now().toString(36)}.pdf`;
  await tauriPage.fill('input[placeholder="document.pdf"]', name);
  await tauriPage.getByText("Save", { exact: true }).click();
  await openRailTab(tauriPage, "Source Tree");
  await expect(tauriPage.getByText(name)).toBeVisible({ timeout: 15_000 });
});

test("copy log gives feedback", async ({ tauriPage }) => {
  await tauriPage.getByText("Logs").click();
  await tauriPage.getByText("Copy log").click();
  await expect(tauriPage.getByText("Copied")).toBeVisible();
});
