import { test, expect } from "../fixtures";
import {
  createBlankProject,
  openProject,
  openRailTab,
  setEditorContent,
} from "../helpers";

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
  // The preview auto-fits to page height once, deferred a requestAnimationFrame
  // after the PDF becomes visible. Reading `before` immediately can race that
  // and capture the pre-auto-fit value, making the later zoom-out assertion
  // compare against a level the app never actually returns to. Poll until two
  // consecutive reads agree before treating it as the stable baseline.
  let before = await zoom();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const reread = await zoom();
    if (reread === before) break;
    before = reread;
  }
  await tauriPage.click('[aria-label="Zoom in"]');
  const after = await zoom();
  expect(Number(after)).toBeGreaterThan(Number(before));
  await tauriPage.click('[aria-label="Zoom out"]');
  expect(await zoom()).toBe(before);
});

test("zoom menu applies presets and calculated fit scales", async ({ tauriPage }) => {
  const trigger = tauriPage.locator('[aria-haspopup="menu"][aria-label^="Zoom "]');
  const openMenu = async () => {
    await trigger.focus();
    await trigger.press("Enter");
    await expect(tauriPage.getByRole("menu")).toBeVisible();
  };

  for (const preset of ["25%", "50%", "75%", "100%", "150%", "200%", "400%"]) {
    await openMenu();
    await tauriPage.getByRole("menu").getByText(preset, { exact: true }).click();
    await expect(trigger).toHaveText(new RegExp(preset.replace("%", "\\s*%")));
  }
  await expect(tauriPage.locator('button[aria-label="Zoom in"]')).toBeDisabled();

  await openMenu();
  await tauriPage.getByRole("menu").getByText("100%", { exact: true }).click();
  await openMenu();
  await tauriPage.getByRole("menu").getByText("Zoom in", { exact: true }).click();
  await expect(trigger).toHaveText(/120\s*%/);
  await openMenu();
  await tauriPage.getByRole("menu").getByText("Zoom out", { exact: true }).click();
  await expect(trigger).toHaveText(/100\s*%/);

  await openMenu();
  await tauriPage.getByRole("menu").getByText("Fit to width", { exact: true }).click();
  const widthScale = Number((await trigger.textContent())?.match(/\d+/)?.[0]);
  expect(widthScale).toBeGreaterThanOrEqual(25);
  expect(widthScale).toBeLessThan(400);

  await openMenu();
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

test("multi-page layout, previous/next, and direct page jump all navigate", async ({
  tauriPage,
}) => {
  await tauriPage.click('[aria-label="Home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 30_000 });
  await createBlankProject(tauriPage, `E2E Preview Pages ${Date.now().toString(36)}`);
  await setEditorContent(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
Page one
\newpage
Page two
\newpage
Page three
\end{document}
`,
  );
  await expect(tauriPage.getByTestId("compile-button")).toBeEnabled({ timeout: 30_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await tauriPage.waitForFunction(
    `(document.body.innerText || '').includes('of 3')`,
    120_000,
  );

  const page = tauriPage.locator('[aria-label="Page number"]');
  await expect(page).toHaveValue("1");
  await tauriPage.click('[aria-label="Next page"]');
  await expect(page).toHaveValue("2");
  await tauriPage.click('[aria-label="Next page"]');
  await expect(page).toHaveValue("3");
  await tauriPage.click('[aria-label="Previous page"]');
  await expect(page).toHaveValue("2");

  await tauriPage.fill('[aria-label="Page number"]', "1");
  await tauriPage.press('[aria-label="Page number"]', "Enter");
  await expect(page).toHaveValue("1");
  await tauriPage.click('[aria-label="Two-page view"]');
  await expect(tauriPage.locator('[aria-label="Two-page view"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await tauriPage.click('[aria-label="Next page"]');
  await expect(page).toHaveValue("3");
  await tauriPage.click('[aria-label="Previous page"]');
  await expect(page).toHaveValue("1");
  await tauriPage.click('[aria-label="Single page view"]');
  await expect(tauriPage.locator('[aria-label="Single page view"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("invert colors toggles on and off", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Invert PDF preview colors"]');
  await expect(
    tauriPage.locator('[aria-label="Invert PDF preview colors"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await tauriPage.click('[aria-label="Invert PDF preview colors"]');
  await expect(
    tauriPage.locator('[aria-label="Invert PDF preview colors"]'),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible();
});

test("logs control toggles back to the PDF preview", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Show compile logs"]');
  await expect(tauriPage.locator('[aria-label="Show PDF preview"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tauriPage.getByText("Copy log")).toBeVisible();
  await tauriPage.click('[aria-label="Show PDF preview"]');
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

test("fullscreen controls hide, restore, and exit the preview toolbar", async ({
  tauriPage,
}) => {
  await tauriPage.click('[aria-label="Fullscreen preview"]');
  await expect(tauriPage.locator('[aria-label="Exit fullscreen"]')).toBeVisible({
    timeout: 10_000,
  });
  await tauriPage.click('[aria-label="Hide toolbar"]');
  await expect(tauriPage.locator('[aria-label="Show toolbar"]')).toBeVisible();
  await tauriPage.click('[aria-label="Show toolbar"]');
  await expect(tauriPage.locator('[aria-label="Exit fullscreen"]')).toBeVisible();
  await tauriPage.click('[aria-label="Exit fullscreen"]');
  await expect(tauriPage.locator('[aria-label="Fullscreen preview"]')).toBeVisible();
});

test("open-in-window control creates the detached preview window", async ({
  tauriPage,
}) => {
  await tauriPage.click('[aria-label="Open preview in a new window"]');
  const preview = await tauriPage.waitForWindow((window) => window.label === "preview", {
    timeout: 20_000,
  });
  expect(preview.targetWindow).toBe("preview");
});
