import { expect, test, type NotesPage } from "../notes-page";

const ABSTRACT_ID = "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3e02";
const GONE_ID = "00000000-0000-4000-8000-0000000000b7";

async function withBody(notes: NotesPage, id: string, before: string, insert: string): Promise<void> {
  const text = await notes.text(id);
  await notes.writeFromDisk(id, text.replace(before, `${insert}${before}`));
}

test.describe("Notes block links, dead links and search", () => {
  test("copies a link to a block, links to it from another note, embeds it and jumps to it", async ({ notes }) => {
    const { page } = await notes.open();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await notes.openNote("Abstract draft");
    await notes.firstParagraph.hover();
    await page.getByRole("button", { name: "Block options" }).click();
    await page.getByRole("menuitem", { name: /Copy link to block/ }).click();
    await expect.poll(async () => /Lower ratios help up to a point\. \^([a-z0-9]{6})\n/u.exec(await notes.text("abstract"))?.[1]).toBeTruthy();
    const id = /\^([a-z0-9]{6})\n/u.exec(await notes.text("abstract"))?.[1] ?? "";
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`oleafly://note/${ABSTRACT_ID}#^${id}`);

    await notes.openNote("Reading notes: masked autoencoders");
    await notes.editor.locator("li").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[Abstract#^lower");
    const menu = page.getByRole("listbox", { name: "Link to a note or project" });
    await expect(menu.getByRole("option").first()).toContainText("We study how the mask ratio");
    await page.keyboard.press("Enter");
    await expect.poll(() => notes.text("reading")).toContain(`(oleafly://note/${ABSTRACT_ID}#^${id})`);

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("![[Abstract#^lower");
    await expect(menu.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    const embed = notes.editor.locator(".note-embed");
    await expect(embed).toContainText("We study how the mask ratio changes");
    await expect(embed).not.toContainText("Contributions");

    await notes.editor.locator(`[data-note-heading="^${id}"]`).first().click();
    await expect(notes.title).toHaveValue("Abstract draft");
    await expect(notes.editor.locator(`[data-block-id="${id}"]`)).toHaveClass(/note-block-flash/u);
    await expect(notes.editor.locator(".note-block-refs")).toHaveText("1");
    await notes.editor.locator(".note-block-refs").click();
    await expect(page.getByRole("menuitem", { name: "Open Reading notes: masked autoencoders" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("lists dead note and block links and fixes them", async ({ notes }) => {
    const { page } = await notes.open();
    await withBody(
      notes,
      "dataloader",
      "## What changed",
      `Plans moved to [Old roadmap](oleafly://note/${GONE_ID}) and [the lost claim](oleafly://note/${ABSTRACT_ID}#^nothere).\n\n`,
    );
    await notes.sidebarFooter.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Dead links" }).click();
    const view = page.locator("[data-note-dead-links]");
    await expect(view.getByRole("region", { name: "Missing notes (1)" })).toContainText("Dataloader rewrite: what changed");
    await expect(view.getByRole("region", { name: "Missing blocks (1)" })).toContainText("^nothere is no longer in Abstract draft");

    await view.getByRole("button", { name: "Link to Abstract draft instead" }).click();
    await expect.poll(() => notes.text("dataloader")).toContain(`[the lost claim](oleafly://note/${ABSTRACT_ID})`);
    await view.getByRole("button", { name: "Create note" }).click();
    await expect(page.getByText("No dead links", { exact: false })).toBeVisible();
    const created = await notes.text("new-1");
    const newId = /\nid: ([\w-]+)\n/u.exec(created)?.[1] ?? "";
    expect(created).toContain("title: Old roadmap");
    expect(await notes.text("dataloader")).toContain(`[Old roadmap](oleafly://note/${newId})`);
  });

  test("shows the blocks that carry a tag and opens the note at one", async ({ notes }) => {
    const { page } = await notes.open();
    await withBody(notes, "abstract", "## Contributions", "- [ ] Rerun the 0.6 ratio #lab/todo\n- Ask about the cable #lab\n\n");
    await notes.sidebar.getByRole("button", { name: "Tags" }).click();
    await notes.sidebar.getByRole("button", { name: "Show notes tagged lab", exact: true }).click();
    const results = notes.sidebar.getByRole("listbox", { name: "Matching notes" });
    const block = results.getByRole("option", { name: /Ask about the cable/ });
    await expect(block).toBeVisible();
    await expect(block.locator("mark")).toHaveText("#lab");
    await block.click();
    await expect(notes.title).toHaveValue("Abstract draft");
    await expect(page.locator(".note-block-flash")).toContainText("Ask about the cable");
  });

  test("switches the search mode and keeps the query language", async ({ notes }) => {
    const { page } = await notes.open();
    const box = await notes.searchBox();
    await box.fill("Masking");
    await page.getByRole("button", { name: "Search mode: Best match" }).click();
    await page.getByRole("menuitemradio", { name: /Regular expression/ }).click();
    await expect(page.getByRole("button", { name: "Search mode: Regular expression" })).toBeVisible();
    await box.fill("mask.* -abstract");
    const results = notes.sidebar.getByRole("listbox", { name: "Matching notes" });
    await expect(results.getByRole("option", { name: /Masking strategy report/ })).toBeVisible();
    await expect(results.getByRole("option", { name: /Abstract draft/ })).toHaveCount(0);
    await box.fill('"(unclosed"');
    await expect(notes.sidebar).toContainText("This pattern isn't valid");
    await page.getByRole("button", { name: "Search mode: Regular expression" }).click();
    await page.getByRole("menuitemradio", { name: /Fuzzy/ }).click();
    await box.fill("msk rprt");
    await expect(results.getByRole("option", { name: /Masking strategy report/ })).toBeVisible();
  });
});
