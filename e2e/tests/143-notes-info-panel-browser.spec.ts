import { expect, test, type NotesPage } from "../notes-page";

const ABSTRACT = `---
title: Abstract draft
kind: note
id: 2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3e02
status: draft
---

We study how the mask ratio changes what a self-supervised encoder learns.
`;

const SECTIONS = ["Properties", "Linked from", "Mentioned in", "References", "Dead links", "Attachments"];

function setInfoPlace(notes: NotesPage, place: "side" | "inline"): Promise<void> {
  return notes.page.evaluate((value) => {
    const store = (window as unknown as { __settings: { getState(): { setNotesAppearance(key: string, value: string): void } } }).__settings;
    store.getState().setNotesAppearance("notesInfo", value);
  }, place);
}

test.describe("Notes info panel", () => {
  test("opens Info beside the note, folds a section, edits a property and closes again", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.writeFromDisk("abstract", ABSTRACT);
    await notes.openNote("Abstract draft");
    const article = page.locator("article").filter({ visible: true });
    await expect(article.getByRole("region", { name: "Properties" })).toHaveCount(0);
    await expect(article.getByRole("region", { name: "Mentioned in" })).toHaveCount(0);
    await expect(notes.infoButton).toHaveAttribute("aria-pressed", "false");
    await notes.infoButton.hover();
    await expect(page.getByRole("tooltip")).toHaveText(/^Note info \(.+\)$/u);

    const info = await notes.showInfo();
    await expect(page.getByRole("tab", { name: "Info" })).toBeVisible();
    await expect(info.getByRole("heading", { name: "Abstract draft" })).toBeVisible();
    for (const stat of ["Created", "Updated", "Words", "Characters", "Lines", "Reading time"]) {
      await expect(info.getByRole("term").filter({ hasText: stat })).toBeVisible();
    }
    await expect(info.locator('[data-note-stat="reading"] dd')).toHaveText("under a minute");
    for (const section of SECTIONS) await expect(info.getByRole("region", { name: section, exact: true })).toBeVisible();
    await expect(info.getByRole("region", { name: "Attachments" })).toContainText("No files attached");

    const words = info.locator('[data-note-stat="words"] dd');
    const before = Number(await words.textContent());
    await notes.caretAtEnd();
    await page.keyboard.type(" Two more");
    await expect(words).toHaveText(String(before + 2));

    const references = info.getByRole("button", { name: "References 0", exact: true });
    await references.click();
    await expect(references).toHaveAttribute("aria-expanded", "false");
    await expect(info.getByRole("region", { name: "References" })).not.toContainText("No citations in this note");

    const status = info.locator('input[aria-label="Value of status"]');
    await status.fill("final");
    await status.press("Enter");
    await expect.poll(() => notes.text("abstract")).toContain("\nstatus: final\n");

    await page.getByRole("button", { name: "Close Info", exact: true }).click();
    await expect(notes.infoPanel).toHaveCount(0);
    await expect(notes.infoButton).toHaveAttribute("aria-pressed", "false");
    await notes.showInfo();
    await expect(info.getByRole("button", { name: "References 0", exact: true })).toHaveAttribute("aria-expanded", "false");
    await notes.infoButton.click();
    await expect(notes.infoPanel).toHaveCount(0);
  });

  test("moves the info between the side panel and the page as soon as the setting changes", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    const article = page.locator("article").filter({ visible: true });
    const info = await notes.showInfo();
    await expect(info.getByRole("region", { name: "Linked from" })).toContainText("Dataloader rewrite: what changed");
    await expect(article.getByRole("region", { name: "Linked from" })).toHaveCount(0);

    await setInfoPlace(notes, "inline");
    await expect(notes.infoPanel).toHaveCount(0);
    await expect(notes.infoButton).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Info" })).toHaveCount(0);
    await expect(article.getByRole("region", { name: "Linked from" })).toContainText("Dataloader rewrite: what changed");
    await expect(article.getByRole("region", { name: "Dead links" })).toHaveCount(0);

    await setInfoPlace(notes, "side");
    await expect(notes.infoButton).toHaveAttribute("aria-pressed", "false");
    await expect(article.getByRole("region", { name: "Linked from" })).toHaveCount(0);
    await notes.showInfo();
    await expect(notes.infoPanel.getByRole("region", { name: "Linked from" })).toContainText("Dataloader rewrite: what changed");
  });
});
