import { expect, type Page, test } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

async function open(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/e2e/typst-forms-harness.html${query}`);
  await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  return errors;
}

function source(page: Page): Promise<string> {
  return page.locator("#source").inputValue();
}

function card(page: Page, title: string) {
  return page.locator(".ofl-visual-form-card").filter({ has: page.locator(".ofl-visual-form-title", { hasText: title }) });
}

test.describe("Typst function forms in Visual mode", () => {
  test("shows the fixture report's calls as cards and a chip", async ({ page }) => {
    const errors = await open(page);
    await expect(page.locator(".ofl-visual-form-card")).toHaveCount(5);
    await expect(page.locator(".ofl-visual-form-chip-button")).toHaveText(["Status: In review"]);
    await expect(card(page, "Cover page").locator(".ofl-visual-form-summary")).toHaveText("Quarterly operations report");
    expect(errors).toEqual([]);
  });

  test("edits one field of each kind and writes exactly that argument", async ({ page }) => {
    await open(page);
    const cover = card(page, "Cover page");
    await cover.getByLabel("Title", { exact: true }).fill("Annual report");
    await cover.getByLabel("Title", { exact: true }).press("Enter");
    await expect.poll(() => source(page)).toContain('  title: "Annual report",\n');

    const box = card(page, "Info box").first();
    await box.getByLabel("Tone", { exact: true }).selectOption("risk");
    await expect.poll(() => source(page)).toContain('#info-box(title: "Key result", tone: "risk")[');

    await box.getByLabel("Text", { exact: true }).fill("Deliveries rose by *15%*.");
    await box.getByLabel("Text", { exact: true }).press("ControlOrMeta+Enter");
    await expect.poll(() => source(page)).toContain("[Deliveries rose by *15%*.]");

    const signOff = card(page, "Sign-off");
    await signOff.getByLabel("Revision", { exact: true }).fill("4");
    await signOff.getByLabel("Revision", { exact: true }).press("Enter");
    await signOff.getByLabel("Final version", { exact: true }).check();
    await expect.poll(() => source(page)).toContain('#acme.sign-off(name: "Dana Smith", revision: 4, final: true)');
  });

  test("opens a chip's form in a popover and writes the choice back", async ({ page }) => {
    await open(page);
    await page.locator(".ofl-visual-form-chip-button").click();
    const popover = page.locator(".ofl-visual-form-popover");
    await expect(popover).toBeVisible();
    // Focus lands on the field, which a panel still hidden for measuring could not take.
    await expect(popover.getByLabel("Status", { exact: true })).toBeFocused();
    await popover.getByLabel("Status", { exact: true }).selectOption("approved");
    await expect.poll(() => source(page)).toContain('#badge("approved")');
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(page.locator(".ofl-visual-form-chip-button")).toBeFocused();
  });

  test("keeps keys typed after a click on a card out of the document", async ({ page }) => {
    await open(page);
    const before = await source(page);
    const signOff = card(page, "Sign-off");
    await signOff.locator(".ofl-visual-form-title").click();
    await page.keyboard.type("Z");
    // The click turns the switch on and Space, which reaches the switch and not the text, turns it off.
    await signOff.getByLabel("Final version", { exact: true }).click();
    await expect.poll(() => source(page)).toContain("final: true)");
    await page.keyboard.press("Space");
    await expect.poll(() => source(page)).toBe(before);
  });

  test("reads a number field's text itself and never clears it for bad input", async ({ page }) => {
    await open(page);
    const revision = card(page, "Sign-off").getByLabel("Revision", { exact: true });
    await revision.fill("2,5");
    await revision.press("Enter");
    await expect(card(page, "Sign-off").locator(".ofl-visual-form-problem")).toHaveText("Enter a number.");
    await revision.fill("4");
    await revision.press("ArrowUp");
    await revision.press("Enter");
    await expect.poll(() => source(page)).toContain("revision: 5,");
  });

  test("stacks labels above their controls in a narrow pane", async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 900 });
    await open(page);
    const title = card(page, "Cover page").getByLabel("Title", { exact: true });
    const box = await title.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(150);
  });

  test("scrolls a 300-card report without console errors", async ({ page }) => {
    const errors = await open(page, "?doc=large");
    const scroller = page.locator(".cm-scroller");
    for (let step = 0; step < 12; step += 1) {
      await scroller.evaluate((element) => element.scrollBy(0, 1_600));
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    await expect(page.locator(".ofl-visual-form-card").first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("renders the same editor DOM with no port and with an empty catalog", async ({ page }) => {
    const dom = async (query: string) => {
      await open(page, query);
      await expect(page.locator(".cm-content")).toContainText("#acme.cover-page(");
      return page.locator(".cm-content").evaluate((element) => element.innerHTML);
    };
    const withoutPort = await dom("?forms=off");
    expect(withoutPort).not.toContain("ofl-visual-form");
    expect(await dom("?forms=empty")).toBe(withoutPort);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`card and popover shots (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, `?theme=${theme}`);
      const shot = card(page, "Info box").nth(1);
      await expect(shot).toBeVisible();
      await shot.screenshot({ path: test.info().outputPath(`card-${theme}.png`) });
      await page.locator(".ofl-visual-form-chip-button").click();
      const popover = page.locator(".ofl-visual-form-popover");
      await expect(popover).toBeVisible();
      await popover.screenshot({ path: test.info().outputPath(`popover-${theme}.png`) });
    });
  }
});
