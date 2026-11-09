import { expect, type Page, test } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

async function open(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/e2e/notes-harness.html${query}`);
  await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  return errors;
}

function home(page: Page) {
  return page.locator('[role="tabpanel"][data-shown="true"]');
}

function card(page: Page, id: string) {
  return home(page).locator(`[data-note-card="${id}"]`);
}

function cardTitles(page: Page) {
  return home(page).locator("[data-card-open]");
}

test.describe("Notes Home", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("shows every note as a card with a small live copy of its start", async ({ page }) => {
    const errors = await open(page);
    await expect(home(page).getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(home(page).locator("[data-note-card]")).toHaveCount(4);

    const masking = card(page, "masking");
    await expect(masking.locator("[data-note-preview] h2").first()).toHaveText("Where things stand");
    await expect(masking.locator('.note-drawn[data-block="mermaid"] svg')).toBeVisible();
    await expect(card(page, "reading").locator("[data-note-preview] table tr")).toHaveCount(4);
    await expect(card(page, "dataloader").locator("[data-note-preview] figure.note-image img")).toHaveAttribute(
      "src",
      /^data:image\/svg\+xml/u,
    );
    await expect(card(page, "abstract").locator("[data-note-preview] li")).toHaveCount(2);

    const geometry = await masking.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const sheet = element.querySelector<HTMLElement>("[data-note-preview] > .wysiwyg-content");
      const frame = element.querySelector<HTMLElement>("[data-note-preview]");
      return {
        ratio: box.height / box.width,
        radius: getComputedStyle(element).borderTopLeftRadius,
        borderLeft: getComputedStyle(element).borderLeftWidth,
        sheet: sheet ? sheet.getBoundingClientRect().width / (frame?.getBoundingClientRect().width ?? 1) : 0,
        transform: sheet ? getComputedStyle(sheet).transform : "",
      };
    });
    expect(geometry.ratio).toBeCloseTo(264 / 236, 2);
    expect(geometry.radius).toBe("20px");
    expect(geometry.borderLeft).toBe("0px");
    expect(geometry.sheet).toBeCloseTo(1, 2);
    expect(geometry.transform).toBe("matrix(0.28, 0, 0, 0.28, 0, 0)");

    const tops = await home(page)
      .locator("[data-note-card]")
      .evaluateAll((cards) => cards.map((element) => Math.round(element.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(errors).toEqual([]);
  });

  test("tints a card's frame on hover and shows its More button", async ({ page }) => {
    await open(page);
    const abstract = card(page, "abstract");
    const before = await abstract.evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(abstract.getByRole("button", { name: "More" })).toHaveCSS("opacity", "0");
    await abstract.hover();
    await expect(abstract.getByRole("button", { name: "More" })).toHaveCSS("opacity", "1");
    await expect.poll(() => abstract.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before);
  });

  test("opens a note from its card in place of Home", async ({ page }) => {
    const errors = await open(page);
    await home(page).getByRole("button", { name: "Abstract draft", exact: true }).click();
    await expect(page.locator("main").getByRole("tab")).toHaveText(["Abstract draft"]);
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Abstract draft");
    expect(errors).toEqual([]);
  });

  test("puts the note opened last first, and starts a new note from the header", async ({ page }) => {
    await open(page);
    await page.locator("aside").getByRole("button", { name: /Dataloader rewrite: what changed/ }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Dataloader rewrite: what changed");
    await page.getByRole("tab", { name: "Home" }).click();
    await expect
      .poll(() => cardTitles(page).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
      .toEqual(["Dataloader rewrite: what changed", "Masking strategy report", "Abstract draft", "Reading notes: masked autoencoders"]);

    await home(page).getByRole("button", { name: "New note" }).click();
    await expect(page.locator("main").getByRole("tab")).toHaveText(["Untitled", /Dataloader rewrite: what changed$/]);
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Untitled");
  });

  test("stars a note into Favorites and keeps the sidebar menu in step", async ({ page }) => {
    const errors = await open(page);
    const reading = card(page, "reading");
    await reading.hover();
    await reading.getByRole("button", { name: "Add to favorites" }).click();
    await home(page).getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(home(page).locator("[data-note-card]")).toHaveCount(1);
    await expect(card(page, "reading")).toBeVisible();

    const row = page.locator("aside [data-note-row]", { hasText: "Reading notes: masked autoencoders" });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove from favorites" }).click();
    await expect(home(page).getByText("No favorites yet. Star a note to keep it here.")).toBeVisible();
    await expect(home(page).locator("[data-note-card]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("searches notes, sorts them, and keeps the sort and layout after a reload", async ({ page }) => {
    await open(page);
    const search = home(page).getByRole("combobox", { name: "Search notes" });
    await search.fill("shards");
    await expect(home(page).locator("[data-note-card]")).toHaveCount(1);
    await expect(card(page, "dataloader")).toBeVisible();
    await search.fill("zebra");
    await expect(home(page).getByText('No notes match "zebra".')).toBeVisible();
    await search.press("Escape");
    await expect(home(page).locator("[data-note-card]")).toHaveCount(4);

    await home(page).getByRole("button", { name: "Last opened" }).click();
    await page.getByRole("menuitem", { name: "Title" }).click();
    await expect
      .poll(() => cardTitles(page).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
      .toEqual(["Abstract draft", "Dataloader rewrite: what changed", "Masking strategy report", "Reading notes: masked autoencoders"]);

    await home(page).getByRole("button", { name: "List view" }).click();
    await expect(home(page).locator("[data-note-list-row]")).toHaveCount(4);
    const row = home(page).locator('[data-note-list-row="masking"]');
    await expect(row).toContainText("SSL masking");
    await expect(row).toContainText("Claude Code");
    await expect(row).toContainText("2 hours ago");

    await page.reload();
    await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
    await expect(home(page).locator("[data-note-list-row]")).toHaveCount(4);
    await expect(home(page).getByRole("button", { name: "Title", exact: true }).first()).toBeVisible();
    await expect(home(page).locator("[data-note-list-row]").first()).toHaveAttribute("data-note-list-row", "abstract");
  });

  test("renames and deletes a note from its card menus", async ({ page }) => {
    const errors = await open(page);
    await card(page, "abstract").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const field = home(page).getByRole("textbox", { name: "Rename note" });
    await expect(field).toBeFocused();
    await field.fill("Abstract, second pass");
    await field.press("Enter");
    await expect(home(page).getByRole("button", { name: "Abstract, second pass", exact: true })).toBeVisible();
    await expect(page.locator("aside").getByRole("button", { name: /Abstract, second pass/ })).toBeVisible();

    const dataloader = card(page, "dataloader");
    await dataloader.hover();
    await dataloader.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Move to Recycle Bin" }).click();
    await expect(card(page, "dataloader")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("draws Home in dark mode without errors", async ({ page }) => {
    const errors = await open(page, "?theme=dark");
    await expect(card(page, "masking").locator('.note-drawn[data-block="mermaid"] svg')).toBeVisible();
    const colors = await card(page, "masking").evaluate((element) => ({
      frame: getComputedStyle(element).backgroundColor,
      page: getComputedStyle(element.firstElementChild as HTMLElement).backgroundColor,
    }));
    expect(colors.frame).not.toBe(colors.page);
    expect(errors).toEqual([]);
  });
});
