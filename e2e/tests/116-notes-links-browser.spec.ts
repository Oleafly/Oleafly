import { expect, type Page, test } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/e2e/notes-harness.html`);
  await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  return errors;
}

function title(page: Page) {
  return page.locator('input[aria-label="Note title"]:visible');
}

function body(page: Page) {
  return page.locator(".ProseMirror:visible");
}

async function openNote(page: Page, name: string): Promise<void> {
  await page.locator("aside").getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(title(page)).toHaveValue(name);
  await expect(body(page)).toBeVisible();
}

test.describe("Notes links", () => {
  test("draws links to notes and projects as chips and opens a linked note", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Reading notes: masked autoencoders");
    const noteLink = body(page).locator('[data-note-link="note"]', { hasText: "Masking strategy report" });
    await expect(noteLink).toBeVisible();
    await expect(body(page).locator('[data-note-link="project"]', { hasText: "SSL masking" })).toBeVisible();
    await noteLink.click();
    await expect(title(page)).toHaveValue("Masking strategy report");
    expect(errors).toEqual([]);
  });

  test("lists the notes that link here and opens one", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    const linked = page.getByRole("region", { name: "Linked from" }).filter({ visible: true });
    await expect(linked).toContainText("Reading notes: masked autoencoders");
    await expect(linked).toContainText("Dataloader rewrite: what changed");
    await linked.getByRole("button", { name: /Dataloader rewrite/ }).click();
    await expect(title(page)).toHaveValue("Dataloader rewrite: what changed");
    await expect(page.getByRole("region", { name: "Linked from" }).filter({ visible: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("offers notes and projects after [[ and inserts the chosen link", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Abstract draft");
    await body(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("See [[mask");
    const menu = page.getByRole("listbox", { name: "Link to a note or project" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option", { name: /Masking strategy report/ })).toBeVisible();
    await menu.getByRole("option", { name: /Masking strategy report/ }).click();
    await expect(menu).toHaveCount(0);
    await expect(body(page).locator('[data-note-link="note"]', { hasText: "Masking strategy report" })).toBeVisible();
    await page.keyboard.type(" and [[ssl");
    await expect(menu.getByRole("option", { name: /SSL masking/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
