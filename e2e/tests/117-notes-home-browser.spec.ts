import type { Page } from "@playwright/test";
import { expect, test } from "../notes-page";

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

  test("shows every note as a card with a small live copy of its start", async ({ notes }) => {
    const { page } = await notes.open();
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
  });

  test("on hover, tints a card's frame, shows bookmark and More beside the title, and zooms only the preview", async ({
    notes,
  }) => {
    const { page } = await notes.open();
    const abstract = card(page, "abstract");
    const more = abstract.getByRole("button", { name: "More" });
    const bookmark = abstract.getByRole("button", { name: "Add to favorites" });
    const sheet = abstract.locator("[data-note-preview] > .wysiwyg-content");
    const before = await abstract.evaluate((element) => getComputedStyle(element).backgroundColor);
    const frame = await abstract.boundingBox();
    await expect(more).toBeHidden();
    await expect(bookmark).toBeHidden();
    await expect(sheet).toHaveCSS("scale", "none");

    await abstract.hover();
    await expect(more).toHaveCSS("opacity", "1");
    await expect(sheet).toHaveCSS("scale", "1.04");
    await expect.poll(() => abstract.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before);
    expect(await abstract.boundingBox()).toEqual(frame);
    const [mark, info] = await Promise.all([bookmark.boundingBox(), more.boundingBox()]);
    expect(mark && info && mark.x < info.x).toBe(true);
    expect(Math.abs((mark?.y ?? 0) + (mark?.height ?? 0) / 2 - ((info?.y ?? 0) + (info?.height ?? 0) / 2))).toBeLessThan(1);
  });

  test("opens a note from its card in place of Home", async ({ notes }) => {
    const { page } = await notes.open();
    await home(page).getByRole("button", { name: "Abstract draft", exact: true }).click();
    await expect(page.locator('main [data-tab-view] [role="tab"]')).toHaveText(["Abstract draft"]);
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Abstract draft");
  });

  test("puts the note opened last first, and starts a new note from the header", async ({ notes }) => {
    const { page } = await notes.open();
    await page.locator("aside").getByRole("button", { name: /Dataloader rewrite: what changed/ }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Dataloader rewrite: what changed");
    await page.getByRole("tab", { name: "Home" }).click();
    await expect
      .poll(() => cardTitles(page).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
      .toEqual(["Dataloader rewrite: what changed", "Masking strategy report", "Abstract draft", "Reading notes: masked autoencoders"]);

    await home(page).getByRole("button", { name: "New note" }).click();
    await expect(page.locator('main [data-tab-view] [role="tab"]')).toHaveText(["Untitled", /Dataloader rewrite: what changed$/]);
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Untitled");
  });

  test("stars a note into Favorites and keeps the sidebar menu in step", async ({ notes }) => {
    const { page } = await notes.open();
    const reading = card(page, "reading");
    await reading.hover();
    await reading.getByRole("button", { name: "Add to favorites" }).click();
    await home(page).getByRole("tab", { name: "Favorites", exact: true }).click();
    await expect(home(page).locator("[data-note-card]")).toHaveCount(1);
    await expect(card(page, "reading")).toBeVisible();

    const row = page.locator("aside [data-note-row]", { hasText: "Reading notes: masked autoencoders" });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove from favorites" }).click();
    await expect(home(page).getByText("No favorites yet. Add a note to favorites to keep it here.")).toBeVisible();
    await expect(home(page).locator("[data-note-card]")).toHaveCount(0);
  });

  test("searches notes, sorts them, and keeps the sort and layout after a reload", async ({ notes }) => {
    const { page } = await notes.open();
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

    await notes.reload();
    await expect(home(page).locator("[data-note-list-row]")).toHaveCount(4);
    await expect(home(page).getByRole("button", { name: "Title", exact: true }).first()).toBeVisible();
    await expect(home(page).locator("[data-note-list-row]").first()).toHaveAttribute("data-note-list-row", "abstract");
  });

  test("renames and deletes a note from its card menus", async ({ notes }) => {
    const { page } = await notes.open();
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
  });

  test("draws Home in dark mode without errors", async ({ notes }) => {
    const { page } = await notes.open("?theme=dark");
    await expect(card(page, "masking").locator('.note-drawn[data-block="mermaid"] svg')).toBeVisible();
    const colors = await card(page, "masking").evaluate((element) => ({
      frame: getComputedStyle(element).backgroundColor,
      page: getComputedStyle(element.firstElementChild as HTMLElement).backgroundColor,
    }));
    expect(colors.frame).not.toBe(colors.page);
  });
});
