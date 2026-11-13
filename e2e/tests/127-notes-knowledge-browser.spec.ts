import { expect, INFO_PLACES, test } from "../notes-page";

const MISSING_ID = "00000000-0000-4000-8000-0000000000a1";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

test.describe("Notes knowledge", () => {
  test("creates a note from a template with its title and properties filled in", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.sidebar.getByRole("button", { name: "New from template" }).click();
    const picker = page.getByRole("dialog", { name: "New note from a template" });
    await picker.getByRole("combobox").fill("lab notebook");
    await picker.getByRole("option", { name: /Lab notebook entry/ }).click();
    await expect(picker).toHaveCount(0);
    await expect(notes.title).toHaveValue(`Lab notebook entry ${today()}`);
    const text = await notes.text("new-1");
    expect(text).toContain(`title: Lab notebook entry ${today()}`);
    expect(text).toContain("kind: note");
    expect(text).toMatch(/tags: \[lab-notebook\]/u);
    expect(text).toContain(`date: ${today()}`);
  });

  test("opens the same daily note every time it is asked for today", async ({ notes }) => {
    await notes.open();
    const daily = notes.sidebar.getByRole("button", { name: "Today's note" });
    await daily.click();
    await expect(notes.title).toHaveValue(today());
    await notes.page.getByRole("tab", { name: "Home" }).click();
    await daily.click();
    await expect(notes.title).toHaveValue(today());
    expect(await notes.has("new-1")).toBe(true);
    expect(await notes.has("new-2")).toBe(false);
    await expect(notes.sidebar.getByRole("button", { name: new RegExp(today()) })).toHaveCount(1);
  });

  test("finds a note by part of its title in the quick switcher and lists recent notes first", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.sidebar.getByRole("button", { name: "Go to note", exact: true }).click();
    const switcher = page.getByRole("dialog", { name: "Go to note" });
    await switcher.getByRole("combobox").fill("dataload");
    await expect(switcher.getByRole("option").first()).toContainText("Dataloader rewrite: what changed");
    await page.keyboard.press("Enter");
    await expect(switcher).toHaveCount(0);
    await expect(notes.title).toHaveValue("Dataloader rewrite: what changed");

    await notes.sidebar.getByRole("button", { name: "Go to note", exact: true }).click();
    await expect(switcher.getByRole("group", { name: "Recent" }).getByRole("option").first()).toContainText(
      "Dataloader rewrite: what changed",
    );
    await page.keyboard.press("Escape");
  });

  test("creates the note a broken link names and points the link at it", async ({ notes }) => {
    await notes.open();
    const before = await notes.text("abstract");
    await notes.writeFromDisk(
      "abstract",
      before.replace("## Contributions", `Next comes the [Ablation plan](oleafly://note/${MISSING_ID}).\n\n## Contributions`),
    );
    await notes.openNote("Abstract draft");
    const broken = notes.editor.locator('[data-note-link="note"][data-missing="true"]', { hasText: "Ablation plan" });
    await expect(broken).toBeVisible();
    await broken.click();
    await expect(notes.title).toHaveValue("Ablation plan");
    const created = await notes.text("new-1");
    const id = /\nid: ([\w-]+)\n/u.exec(created)?.[1];
    expect(id).toBeTruthy();
    await expect.poll(() => notes.text("abstract")).toContain(`[Ablation plan](oleafly://note/${id})`);
    expect(await notes.text("abstract")).not.toContain(MISSING_ID);
  });

  test("previews a linked note on hover", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Reading notes: masked autoencoders");
    await notes.editor.locator('[data-note-link="note"]', { hasText: "Masking strategy report" }).hover();
    const preview = notes.page.getByRole("tooltip").filter({ hasText: "Where things stand" });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("The encoder trains on patches");
  });

  test("opens a note from the graph with the keyboard", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.sidebar.getByRole("button", { name: "Graph view" }).click();
    const canvas = page.getByRole("application", { name: /^Graph of \d+ notes$/u }).or(page.getByLabel(/^Graph of \d+ notes$/u));
    await expect(canvas.first()).toBeVisible();
    await canvas.first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(notes.title).toBeVisible();
    expect(["Masking strategy report", "Abstract draft", "Reading notes: masked autoencoders", "Dataloader rewrite: what changed"]).toContain(
      await notes.title.inputValue(),
    );
  });

  test("lists the project's references when citing from a note", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.newParagraph();
    await notes.tool("Citation");
    await page.getByRole("menuitem", { name: /He et al\. 2022, Masked autoencoders/u }).click();
    await expect.poll(() => notes.text("abstract")).toContain("[@he2022mae]");
  });

  for (const place of INFO_PLACES) {
    test(`shows known citations with their labels and lists their references (${place}), and leaves the Markdown as written`, async ({ notes }) => {
      await notes.placeInfo(place);
      await notes.open();
      const before = await notes.text("abstract");
      const cited = before.replace("Lower ratios help up to a point.", "Lower ratios help up to a point [@he2022mae; @nobody2020].");
      await notes.writeFromDisk("abstract", cited);
      await notes.openNote("Abstract draft");
      await expect(notes.editor.locator('[data-tooltip="Not in the linked project\'s bibliography: nobody2020"]')).toBeVisible();
      const references = (await notes.showInfo()).locator("[data-note-references]");
      await expect(references).toContainText("He et al. 2022, Masked autoencoders");
      const toggle = references.getByRole("button", { name: "References 1", exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(references).not.toContainText("He et al. 2022, Masked autoencoders");
      await toggle.press("Enter");
      await expect(references).toContainText("He et al. 2022, Masked autoencoders");
      await notes.caretAtEnd();
      await notes.page.keyboard.type(" Done.");
      await expect.poll(() => notes.text("abstract")).toContain("[@he2022mae; @nobody2020]. Done.");
    });
  }

  test("creates a reading note from a reference in the template picker", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.sidebar.getByRole("button", { name: "New from template" }).click();
    const picker = page.getByRole("dialog", { name: "New note from a template" });
    await picker.getByRole("combobox").fill("masked autoencoders");
    await picker.getByRole("group", { name: "From a reference" }).getByRole("option", { name: /He et al\. 2022/u }).click();
    await expect(picker).toHaveCount(0);
    await expect.poll(() => notes.text("new-1")).toContain("citekey: he2022mae");
  });
});
