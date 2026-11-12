import type { Locator } from "@playwright/test";
import { expect, test } from "../notes-page";

const MAC = process.platform === "darwin";
const BACK_KEY = MAC ? "Meta+BracketLeft" : "Alt+ArrowLeft";
const FORWARD_KEY = MAC ? "Meta+BracketRight" : "Alt+ArrowRight";

function scroller(notes: { page: { locator(selector: string): Locator } }): Locator {
  return notes.page.locator('[role="tabpanel"][data-shown="true"] [data-keep-scroll]');
}

test.describe("Notes back and forward", () => {
  test.use({ viewport: { width: 1200, height: 560 } });

  test("walks back and forward between two notes opened in one tab and brings back where the first one was scrolled to", async ({ notes }) => {
    const { page } = await notes.open();
    const back = page.getByRole("button", { name: "Back", exact: true });
    const forward = page.getByRole("button", { name: "Forward", exact: true });
    await expect(back).toBeDisabled();
    await expect(forward).toBeDisabled();

    await notes.shown.getByRole("button", { name: /Masking strategy report/ }).first().click();
    await expect(notes.title).toHaveValue("Masking strategy report");
    await expect(notes.tabs).toHaveCount(1);
    const scrolled = await scroller(notes).evaluate((element) => {
      element.scrollTop = 120;
      return element.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(60);

    await notes.sidebar.getByRole("button", { name: "Go to note", exact: true }).click();
    const switcher = page.getByRole("dialog", { name: "Go to note" });
    await switcher.getByRole("combobox").fill("dataload");
    await expect(switcher.getByRole("option").first()).toContainText("Dataloader rewrite: what changed");
    await page.keyboard.press("Enter");
    await expect(notes.title).toHaveValue("Dataloader rewrite: what changed");
    await expect(notes.tabs).toHaveCount(1);
    await expect(back).toBeEnabled();

    await notes.sidebar.getByRole("button", { name: "Go to note", exact: true }).click();
    await switcher.getByRole("combobox").fill("dataload");
    await expect(switcher.getByRole("option").first()).toContainText("Dataloader rewrite: what changed");
    await page.keyboard.press("Enter");
    await expect(switcher).toBeHidden();
    await expect(notes.tabs).toHaveCount(1);
    await expect(notes.title).toHaveValue("Dataloader rewrite: what changed");

    await back.click();
    await expect(notes.title).toHaveValue("Masking strategy report");
    await expect.poll(() => scroller(notes).evaluate((element) => element.scrollTop)).toBe(scrolled);
    await expect(forward).toBeEnabled();

    await forward.click();
    await expect(notes.title).toHaveValue("Dataloader rewrite: what changed");
    await expect(forward).toBeDisabled();

    await page.keyboard.press(BACK_KEY);
    await expect(notes.title).toHaveValue("Masking strategy report");
    await page.keyboard.press(FORWARD_KEY);
    await expect(notes.title).toHaveValue("Dataloader rewrite: what changed");

    await back.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([/Masking strategy report$/u, "Home"]);
    await menu.getByRole("menuitem", { name: "Home" }).click();
    await expect(notes.shown.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(back).toBeDisabled();

    await notes.shown.evaluate((element) => element.dispatchEvent(new MouseEvent("mouseup", { button: 4, bubbles: true, cancelable: true })));
    await expect(notes.title).toHaveValue("Masking strategy report");
    await expect.poll(() => scroller(notes).evaluate((element) => element.scrollTop)).toBe(scrolled);

    await notes.reload();
    await expect(notes.title).toHaveValue("Masking strategy report");
    await expect(back).toBeEnabled();
    await back.click();
    await expect(notes.shown.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(forward).toBeEnabled();
  });

  test("sends the Home button left of the tabs straight to the project library while the sidebar is hidden", async ({ notes }) => {
    const { page } = await notes.open("?exit=1");
    await notes.shown.getByRole("button", { name: /Abstract draft/ }).first().click();
    await expect(notes.title).toHaveValue("Abstract draft");
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    const strip = page.locator("main [data-group]").first();
    const home = strip.getByRole("button", { name: "Home", exact: true });
    const names = await strip
      .locator("button[aria-label]")
      .evaluateAll((buttons) => buttons.slice(0, 4).map((button) => button.getAttribute("aria-label")));
    expect(names).toEqual(["Home", "Show sidebar", "Back", "Forward"]);
    await home.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Go back to project library");
    await home.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __exits: { count: number } }).__exits.count)).toBe(1);
    await expect(notes.title).toHaveValue("Abstract draft");
  });
});
