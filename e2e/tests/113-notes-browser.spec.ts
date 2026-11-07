import { expect, type Page, test } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";
const ABSTRACT_ID = "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3e02";

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

async function openNote(page: Page, title: string): Promise<void> {
  await page.locator("aside").getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(title);
  await expect(page.locator(".ProseMirror:visible")).toBeVisible();
}

function noteText(page: Page, id: string): Promise<string> {
  return page.evaluate((noteId) => (window as unknown as { __notes: { text(id: string): string } }).__notes.text(noteId), id);
}

function prompt(page: Page) {
  return page.getByRole("combobox", { name: "Ask the agent" });
}

function firstParagraph(page: Page) {
  return page.locator(".ProseMirror:visible > p").first();
}

async function runAction(page: Page, filter: string): Promise<void> {
  await prompt(page).fill(`/${filter}`);
  await expect(page.getByRole("option").first()).toBeVisible();
  await prompt(page).press("Enter");
}

async function dockRight(page: Page, title: string): Promise<void> {
  const tab = page.getByRole("tab", { name: title });
  const slot = page.locator("[data-slot]").first();
  const from = await tab.boundingBox();
  const area = await slot.boundingBox();
  if (!from || !area) throw new Error("no geometry");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.7, area.y + area.height / 2, { steps: 4 });
  await page.mouse.move(area.x + area.width - 12, area.y + area.height / 2, { steps: 4 });
  await expect(page.locator('[data-drop-indicator="right"]')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator("[data-slot]")).toHaveCount(2);
}

function shownView(page: Page) {
  return page.locator('[role="tabpanel"][data-shown="true"]');
}

test.describe("Notes", () => {
  test("lists notes, artifacts and experiments on Home", async ({ page }) => {
    const errors = await open(page);
    await expect(page.getByRole("heading", { name: "Your research notes" })).toBeVisible();
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("heading", { name: "SSL masking" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Masking strategy report/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Run 3, mask ratio 0.60/ })).toBeVisible();
    await expect(page.locator("main").getByText("3 tasks · 2 figures · 2 reports", { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("filters the sidebar by kind, author and search", async ({ page }) => {
    await open(page);
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Filters" }).click();
    await sidebar.getByRole("tab", { name: "Data" }).click();
    await expect(sidebar.getByRole("button", { name: /Run 3, mask ratio 0.60/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Masking strategy report/ })).toHaveCount(0);
    await sidebar.getByRole("tab", { name: "All" }).click();
    await sidebar.getByRole("tab", { name: "You" }).click();
    await expect(sidebar.getByRole("button", { name: /Abstract draft/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Masking strategy report/ })).toHaveCount(0);
    await sidebar.getByRole("tab", { name: "Anyone" }).click();
    await sidebar.getByRole("textbox", { name: "Search notes and artifacts" }).fill("zzz");
    await expect(sidebar.getByText("Nothing matches these filters.")).toBeVisible();
  });

  test("draws Mermaid, chart and math blocks and shows their source on request", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    await expect(page.locator('.note-drawn[data-block="mermaid"] .note-drawn-preview svg')).toBeVisible();
    await expect(page.locator('.note-drawn[data-block="chart"] .note-drawn-preview svg')).toBeVisible();
    await expect(page.locator('.note-drawn[data-block="latex"] .note-drawn-preview .katex')).toBeVisible();
    await expect(page.locator('.note-drawn[data-block="typst"] .note-drawn-preview')).toContainText("No preview");

    const chart = page.locator('.note-drawn[data-block="chart"]');
    await expect(chart.locator("pre")).toBeHidden();
    await chart.getByRole("button", { name: "Source" }).click();
    await expect(chart.locator("pre")).toBeVisible();
    await expect(chart.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("reviews an agent's changes one at a time before they reach the note", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    await runAction(page, "rewr");

    const bar = page.getByRole("button", { name: "Reject all" });
    await expect(bar).toBeVisible();
    await expect(page.getByText("Change 1 of 2")).toBeAttached();
    await expect(firstParagraph(page)).toContainText("mask ratio of 0.75");
    await expect(page.locator(".note-diff-delete").first()).toContainText("0.75");

    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.locator(".note-diff-delete")).toHaveText(["64.1%."]);
    await expect(firstParagraph(page)).toContainText("mask ratio of 0.60");

    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(prompt(page)).toBeVisible();
    await expect(firstParagraph(page)).not.toContainText("after the ratio dropped");
  });

  test("accepts every change at once, including a new paragraph", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    await runAction(page, "paragraph");
    await expect(page.locator(".note-diff-block")).toContainText("Run 3 is the first run");
    await expect(page.getByRole("button", { name: "Reject all" })).toHaveCount(0);
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.locator(".ProseMirror:visible > p", { hasText: "Run 3 is the first run" })).toBeVisible();
    await expect.poll(() => noteText(page, "masking")).toContain("\n\nRun 3 is the first run with the lower ratio");

    await runAction(page, "rewr");
    await page.getByRole("button", { name: "Accept all" }).click();
    await expect(firstParagraph(page)).toContainText("0.60. The first run");
    await expect(firstParagraph(page)).toContainText("after the ratio dropped to 0.60");
  });

  test("offers the latest run only when the note's project has one, and never the code check", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    await prompt(page).fill("/");
    await expect(page.getByRole("option", { name: "Proofread selection" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Update from the latest run" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Check claims against the code" })).toHaveCount(0);
    await prompt(page).fill("");
    await openNote(page, "Reading notes: masked autoencoders");
    await prompt(page).fill("/");
    await expect(page.getByRole("option", { name: "Proofread selection" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Update from the latest run" })).toHaveCount(0);
  });

  test("updates the note from the latest research task", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    await runAction(page, "latest");
    await expect(page.locator(".note-diff-insert, .note-diff-delete").first()).toBeVisible();
  });

  test("sends to the agent picked in the model menu and remembers it", async ({ page }) => {
    await open(page);
    await openNote(page, "Abstract draft");
    const picker = page.getByRole("combobox", { name: "AI model" });
    await expect(picker).toContainText("Default model");
    await picker.click();
    await page.getByTestId("ai-model-option-openai-gpt-5").click();
    await expect(picker).toContainText("GPT-5");
    await runAction(page, "proof");
    await expect(page.getByText("GPT-5 has no changes for this note.")).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted");
    await openNote(page, "Abstract draft");
    await expect(page.getByRole("combobox", { name: "AI model" })).toContainText("GPT-5");
  });

  test("says when an agent has nothing to change", async ({ page }) => {
    await open(page);
    await openNote(page, "Abstract draft");
    await runAction(page, "proof");
    await expect(page.getByText("Claude Code has no changes for this note.")).toBeVisible();
  });

  test("stops a running request", async ({ page }) => {
    await open(page, "?delay=10000");
    await openNote(page, "Masking strategy report");
    await prompt(page).fill("Tighten the second paragraph");
    await prompt(page).press("Enter");
    const stop = page.getByRole("button", { name: /Stop/ });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    await expect(page.locator(".note-diff-insert, .note-diff-block")).toHaveCount(0);
  });

  test("sends a selection to the prompt", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    await firstParagraph(page).dblclick({ position: { x: 20, y: 12 } });
    await page.getByRole("button", { name: "Ask agent" }).click();
    await expect(page.getByRole("button", { name: "Remove selection" })).toBeVisible();
    await expect(prompt(page)).toBeFocused();
  });

  test("sets an emoji and a line icon on a note", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    await page.getByRole("button", { name: "Choose icon" }).click();
    await page.getByRole("searchbox", { name: "Search emoji" }).fill("rocket");
    await page.getByRole("gridcell", { name: /rocket/i }).first().click();
    await expect(page.getByRole("button", { name: "Choose icon" })).toHaveText("🚀");

    await page.getByRole("button", { name: "Choose icon" }).click();
    await page.getByRole("tab", { name: "Icons" }).click();
    await page.getByRole("textbox", { name: "Search icons" }).fill("flask");
    await page.getByRole("button", { name: "Flask" }).click();
    await expect(page.getByRole("button", { name: "Choose icon" }).locator("svg")).toBeVisible();
  });

  test("previews task files and copies one into the note", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    await page.getByRole("button", { name: "Artifacts, 4" }).click();
    const panel = page.getByRole("complementary", { name: "Artifacts" });
    await expect(panel.getByText("From the task Review run 3")).toBeVisible();
    await expect(panel.getByText("figures/loss-curve.svg")).toBeVisible();
    await expect(panel.getByRole("img", { name: "Validation curve, runs 1 to 3" })).toBeVisible();
    await panel.getByRole("button", { name: "Insert in note" }).click();
    await expect(page.locator(".ProseMirror:visible .note-image img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
    await expect
      .poll(() => noteText(page, "masking"))
      .toContain("![Validation curve, runs 1 to 3](assets/loss-curve.svg)");

    await panel.getByRole("button", { name: /Run 3, mask ratio 0.60/ }).click();
    await expect(panel.getByRole("cell", { name: "64.1%" })).toBeVisible();
    await panel.getByRole("button", { name: /Weekly progress report/ }).click();
    await expect(panel.getByText("Three runs finished.", { exact: false })).toBeVisible();
    await panel.getByRole("button", { name: /Mask sampler explorer/ }).click();
    await expect(panel.getByText("Interactive figures can't run in Oleafly yet.")).toBeVisible();
    await panel.getByRole("button", { name: "Insert in note" }).click();
    await expect.poll(() => noteText(page, "masking")).toContain("[Mask sampler explorer](assets/mask-sampler.html)");
    expect(errors).toEqual([]);
  });

  test("changes the note's project from the title bar", async ({ page }) => {
    await open(page);
    await openNote(page, "Reading notes: masked autoencoders");
    await page.getByRole("button", { name: /^Artifacts/ }).click();
    const panel = page.getByRole("complementary", { name: "Artifacts" });
    await expect(panel.getByText("Files that research tasks in Literature make will show up here.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Project: Literature" }).click();
    await page.getByRole("menuitemradio", { name: "No project" }).click();
    await expect(page.getByRole("button", { name: "Project: Choose project" })).toBeVisible();
    await expect(panel.getByText("Choose the project this note is about", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Project: Choose project" }).click();
    await page.getByRole("menuitemradio", { name: "SSL masking" }).click();
    await expect(page.getByRole("button", { name: "Artifacts, 4" })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Weekly progress report/ })).toBeVisible();
  });

  test("saves typing, the title and the icon to the note's Markdown", async ({ page }) => {
    await open(page);
    await openNote(page, "Abstract draft");
    await page.locator(".ProseMirror:visible > p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" We report three runs.");
    await expect.poll(() => noteText(page, "abstract")).toContain("up to a point. We report three runs.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    const title = page.getByRole("textbox", { name: "Note title" });
    await title.fill("Abstract: second draft");
    await title.press("Enter");
    await expect.poll(() => noteText(page, "abstract")).toContain('title: "Abstract: second draft"');
    await expect(page.locator("aside").getByRole("button", { name: /Abstract: second draft/ })).toBeVisible();

    await page.getByRole("button", { name: "Choose icon" }).click();
    await page.getByRole("tab", { name: "Icons" }).click();
    await page.getByRole("button", { name: "Flask" }).click();
    await expect.poll(() => noteText(page, "abstract")).toContain("icon: lucide:flask-conical");
    expect(await noteText(page, "abstract")).toMatch(
      new RegExp(`^---\ntitle: "Abstract: second draft"\nkind: note\nid: ${ABSTRACT_ID}\nicon: lucide:flask-conical\n---\n\nWe study`, "u"),
    );
  });

  test("shows a change written on disk as a suggestion and reverts it when rejected", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    const before = await noteText(page, "masking");
    await page.evaluate((text) => {
      const notes = (window as unknown as { __notes: { writeFromDisk(id: string, text: string): void } }).__notes;
      notes.writeFromDisk("masking", text.replace("sampled per pixel", "sampled per patch"));
    }, before);
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await expect(page.locator(".ProseMirror:visible")).toContainText("per pixel");
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await expect.poll(() => noteText(page, "masking")).toContain("sampled per pixel");
    expect(await noteText(page, "masking")).toBe(before);
  });

  test("keeps a change written on disk when it is accepted", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    const before = await noteText(page, "masking");
    const after = before.replace("sampled per pixel", "sampled per patch");
    await page.evaluate((text) => {
      const notes = (window as unknown as { __notes: { writeFromDisk(id: string, text: string): void } }).__notes;
      notes.writeFromDisk("masking", text);
    }, after);
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.locator(".ProseMirror:visible")).toContainText("per patch");
    await page.waitForTimeout(1200);
    expect(await noteText(page, "masking")).toBe(after);
  });

  test("starts a new note", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "New note" }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Untitled");
    await expect(page.locator("aside").getByRole("button", { name: /Untitled/ })).toBeVisible();
  });

  test("keeps notes open as tabs, docks one beside another and restores the layout", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Abstract draft");
    await firstParagraph(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Draft two.");
    await openNote(page, "Dataloader rewrite: what changed");
    const tabs = page.locator("main").getByRole("tab");
    await expect(tabs).toHaveText(["Home", "Abstract draft", "Dataloader rewrite: what changed"]);

    await page.getByRole("tab", { name: "Abstract draft" }).click();
    await expect(firstParagraph(page)).toContainText("Draft two.");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(firstParagraph(page)).not.toContainText("Draft two.");

    const tab = page.getByRole("tab", { name: "Dataloader rewrite: what changed" });
    const slot = page.locator("[data-slot]").first();
    const from = await tab.boundingBox();
    const area = await slot.boundingBox();
    if (!from || !area) throw new Error("no geometry");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * 0.7, area.y + area.height / 2, { steps: 4 });
    await page.mouse.move(area.x + area.width - 12, area.y + area.height / 2, { steps: 4 });
    await expect(page.locator('[data-drop-indicator="right"]')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("[data-slot]")).toHaveCount(2);
    await expect(page.getByRole("tabpanel", { name: "Abstract draft" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Dataloader rewrite: what changed" })).toBeVisible();

    await page.reload();
    await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
    await expect(page.locator("[data-slot]")).toHaveCount(2);
    await expect(page.getByRole("tab", { name: "Dataloader rewrite: what changed" })).toHaveAttribute("aria-selected", "true");
    expect(errors).toEqual([]);
  });

  test("fills Home with the note background in light and dark", async ({ page }) => {
    for (const query of ["", "?theme=dark"]) {
      await open(page, query);
      const home = shownView(page);
      const fill = await home.evaluate((view) => {
        const scroller = view.firstElementChild as HTMLElement;
        return {
          view: getComputedStyle(view).backgroundColor,
          home: getComputedStyle(scroller).backgroundColor,
          gap: view.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom,
        };
      });
      expect(fill.home).toBe(fill.view);
      expect(Math.abs(fill.gap)).toBeLessThan(1);
    }
  });

  test("closes an empty panel and keeps working in the one left", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Abstract draft");
    await dockRight(page, "Abstract draft");
    await page.getByRole("button", { name: "Close Home" }).click();
    const empty = page.locator("[data-group]", { hasText: "This panel is empty." });
    await expect(empty.getByRole("button", { name: "New note" })).toBeVisible();
    await expect(empty.getByRole("button", { name: "Home" })).toBeVisible();
    await empty.getByRole("button", { name: "Close panel" }).click();
    await expect(page.getByText("This panel is empty.")).toHaveCount(0);
    await expect(page.locator("[data-slot]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Close panel" })).toHaveCount(0);
    await openNote(page, "Masking strategy report");
    await expect(page.locator("main").getByRole("tab")).toHaveText(["Abstract draft", /Masking strategy report$/]);
    expect(errors).toEqual([]);
  });

  test("opens a new Home tab and replaces it with the note picked there", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    await page.getByRole("button", { name: "New tab" }).click();
    const tabs = page.locator("main").getByRole("tab");
    await expect(tabs).toHaveText(["Home", /Masking strategy report$/, "Home"]);
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await shownView(page).getByRole("button", { name: /Abstract draft/ }).click();
    await expect(tabs).toHaveText(["Home", /Masking strategy report$/, "Abstract draft"]);
    await expect(page.getByRole("tab", { name: "Abstract draft" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Abstract draft");
    expect(errors).toEqual([]);
  });

  test("folds the filters at the bottom of the sidebar, counts the ones on and remembers the fold", async ({ page }) => {
    const errors = await open(page);
    const sidebar = page.locator("aside");
    const toggle = sidebar.getByRole("button", { name: "Filters" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar.getByRole("tab")).toHaveCount(0);
    const search = await sidebar.getByRole("textbox", { name: "Search notes and artifacts" }).boundingBox();
    const fold = await toggle.boundingBox();
    const aside = await sidebar.boundingBox();
    if (!search || !fold || !aside) throw new Error("no geometry");
    expect(fold.y).toBeGreaterThan(search.y);
    expect(fold.y + fold.height).toBeGreaterThan(aside.y + aside.height - 8);

    await toggle.click();
    await sidebar.getByRole("tab", { name: "Figures" }).click();
    await sidebar.getByRole("tab", { name: "Agents" }).click();
    const count = page.getByTestId("notes-filters").locator("output");
    await expect(count).toHaveText("2");
    await expect(count).toHaveAttribute("aria-label", "2 filters on");
    await expect(sidebar.getByRole("button", { name: /Validation curve, runs 1 to 3/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Abstract draft/ })).toHaveCount(0);

    await page.reload();
    await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar.getByRole("tab", { name: "Figures" })).toBeVisible();
    await toggle.click();
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(errors).toEqual([]);
  });

  test("opens the app settings from the gear beside the brand and keeps New note beside search", async ({ page }) => {
    await open(page);
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Settings" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __notes: { settingsOpened(): number } }).__notes.settingsOpened()))
      .toBe(1);
    const search = await sidebar.getByRole("textbox", { name: "Search notes and artifacts" }).boundingBox();
    const add = await sidebar.getByRole("button", { name: "New note" }).boundingBox();
    if (!search || !add) throw new Error("no geometry");
    expect(add.x).toBeGreaterThan(search.x + search.width - 1);
    expect(Math.abs(add.y + add.height / 2 - (search.y + search.height / 2))).toBeLessThan(2);
  });

  test("shows a note's More button on hover and renames the note in its row", async ({ page }) => {
    const errors = await open(page);
    const row = page.locator("aside [data-note-row]", { hasText: "Abstract draft" });
    const more = row.getByRole("button", { name: "More" });
    await expect(more).toHaveCSS("opacity", "0");
    await row.hover();
    await expect(more).toHaveCSS("opacity", "1");
    await more.click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const field = page.getByRole("textbox", { name: "Rename note" });
    await expect(field).toBeFocused();
    await field.fill("Abstract, second pass");
    await field.press("Enter");
    await expect(page.locator("aside").getByRole("button", { name: /Abstract, second pass/ })).toBeVisible();
    await expect(field).toHaveCount(0);

    await page.locator("aside").getByRole("button", { name: /Abstract, second pass/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Rename note" }).fill("Thrown away");
    await page.getByRole("textbox", { name: "Rename note" }).press("Escape");
    await expect(page.locator("aside").getByRole("button", { name: /Abstract, second pass/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("moves a note to another project from its row menu", async ({ page }) => {
    await open(page);
    const sidebar = page.locator("aside");
    const row = sidebar.locator("[data-note-row]", { hasText: "Reading notes: masked autoencoders" });
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Project" }).click();
    await page.getByRole("menuitem", { name: "Thesis" }).click();
    await expect(sidebar.locator("section", { has: page.getByRole("heading", { name: "Thesis" }) })).toContainText(
      "Reading notes: masked autoencoders",
    );
  });

  test("asks before moving a note to the Recycle Bin from its row menu", async ({ page }) => {
    const errors = await open(page);
    const sidebar = page.locator("aside");
    const row = sidebar.locator("[data-note-row]", { hasText: "Dataloader rewrite: what changed" });
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: 'Move "Dataloader rewrite: what changed" to the Recycle Bin?' })).toBeVisible();
    await dialog.getByRole("button", { name: /^Cancel/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: /Dataloader rewrite: what changed/ })).toBeVisible();

    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Move to Recycle Bin" }).click();
    await expect(sidebar.getByRole("button", { name: /Dataloader rewrite: what changed/ })).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __notes: { has(id: string): boolean } }).__notes.has("dataloader")),
    ).toBe(false);
    expect(errors).toEqual([]);
  });

  test("opens a note in a new tab from its row menu without replacing Home", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    await page.getByRole("button", { name: "New tab" }).click();
    const sidebar = page.locator("aside");
    const row = sidebar.locator("[data-note-row]", { hasText: "Abstract draft" });
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Open in new tab" }).click();
    const tabs = page.locator("main").getByRole("tab");
    await expect(tabs).toHaveText(["Home", /Masking strategy report$/, "Home", "Abstract draft"]);
    await expect(page.getByRole("tab", { name: "Abstract draft" })).toHaveAttribute("aria-selected", "true");

    await sidebar.locator("[data-note-row]", { hasText: "Masking strategy report" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Open in new tab" }).click();
    await expect(tabs).toHaveText(["Home", /Masking strategy report$/, "Home", "Abstract draft"]);
    await expect(page.getByRole("tab", { name: /Masking strategy report$/ })).toHaveAttribute("aria-selected", "true");
    expect(errors).toEqual([]);
  });

  test("closes the tab of an open note after it is deleted", async ({ page }) => {
    await open(page);
    await openNote(page, "Dataloader rewrite: what changed");
    const row = page.locator("aside [data-note-row]", { hasText: "Dataloader rewrite: what changed" });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Move to Recycle Bin" }).click();
    const view = shownView(page);
    await expect(view.getByText("This note is no longer in your library.")).toBeVisible();
    await view.getByRole("button", { name: "Close tab" }).click();
    await expect(page.locator("main").getByRole("tab")).toHaveText(["Home"]);
    await expect(page.getByRole("heading", { name: "Your research notes" })).toBeVisible();
  });

  test("renders in dark mode without errors", async ({ page }) => {
    const errors = await open(page, "?theme=dark");
    await openNote(page, "Masking strategy report");
    await expect(page.locator('.note-drawn[data-block="chart"] svg')).toBeVisible();
    expect(errors).toEqual([]);
  });
  test("moves toolbar groups that do not fit a docked panel into More and back", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    const errors = await open(page);
    await openNote(page, "Abstract draft");
    await openNote(page, "Dataloader rewrite: what changed");
    await dockRight(page, "Dataloader rewrite: what changed");
    const panel = page.getByRole("tabpanel", { name: "Abstract draft" });
    const toolbar = panel.getByRole("toolbar", { name: "Formatting" });
    const more = toolbar.getByRole("button", { name: "More", exact: true });
    await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Block type" })).toBeVisible();
    await expect(more).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Chart", exact: true })).toHaveCount(0);
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const bar = await toolbar.boundingBox();
    const button = await more.boundingBox();
    if (!bar || !button) throw new Error("no geometry");
    expect(button.x + button.width).toBeLessThanOrEqual(bar.x + bar.width);
    expect(bar.x + bar.width - (button.x + button.width)).toBeLessThan(16);

    await firstParagraph(page).click();
    await more.click();
    await page.getByRole("menuitem", { name: "Chart", exact: true }).click();
    await expect(panel.locator('.note-drawn[data-block="chart"]')).toHaveCount(1);
    await expect(toolbar.getByRole("button", { name: "Bold", exact: true })).toBeVisible();

    await page.setViewportSize({ width: 2600, height: 800 });
    await expect(more).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "Chart", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("widens every open note from the toolbar and remembers the width", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    const article = shownView(page).locator("article");
    const widthOf = async () => (await article.boundingBox())?.width ?? 0;
    const standard = await widthOf();
    await shownView(page).getByRole("button", { name: "Note width" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Standard" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "Wide" }).click();
    await expect.poll(widthOf).toBeGreaterThan(standard + 150);
    const wide = await widthOf();

    await shownView(page).getByRole("button", { name: "Note width" }).click();
    await page.getByRole("menuitemradio", { name: "Full width" }).click();
    await expect.poll(widthOf).toBeGreaterThan(wide + 100);
    const paragraph = await firstParagraph(page).boundingBox();
    expect(paragraph?.width ?? 0).toBeGreaterThan(wide);

    await openNote(page, "Abstract draft");
    await expect(shownView(page).locator("[data-note-width]")).toHaveAttribute("data-note-width", "full");
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
    await openNote(page, "Masking strategy report");
    await expect(shownView(page).locator("[data-note-width]")).toHaveAttribute("data-note-width", "full");
    expect(errors).toEqual([]);
  });

  test("collapses the agent prompt to a pill without moving the note and brings it back with Mod+J", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    const view = shownView(page);
    const title = view.getByRole("textbox", { name: "Note title" });
    const before = await title.boundingBox();
    await view.getByRole("button", { name: "Hide prompt" }).click();
    const pill = view.getByRole("button", { name: /^Ask the agent / });
    await expect(pill).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
    expect(await title.boundingBox()).toEqual(before);
    const area = await view.boundingBox();
    const box = await pill.boundingBox();
    if (!area || !box) throw new Error("no geometry");
    expect(area.x + area.width - (box.x + box.width)).toBeLessThan(40);
    expect(area.y + area.height - (box.y + box.height)).toBeLessThan(40);

    await firstParagraph(page).click();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(prompt(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(pill).toBeVisible();
    await expect(page.locator(".ProseMirror:visible")).toBeFocused();

    await page.reload();
    await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
    await openNote(page, "Masking strategy report");
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(prompt(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("keeps Stop in the collapsed prompt while a request runs", async ({ page }) => {
    await open(page, "?delay=10000");
    await openNote(page, "Masking strategy report");
    await prompt(page).fill("Tighten the second paragraph");
    await prompt(page).press("Enter");
    await shownView(page).getByRole("button", { name: "Hide prompt" }).click();
    const stop = shownView(page).getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(stop).toHaveCount(0);
    await shownView(page).getByRole("button", { name: /^Ask the agent / }).click();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  });

  test("snaps the prompt open and shut when motion is reduced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await openNote(page, "Masking strategy report");
    await shownView(page).getByRole("button", { name: "Hide prompt" }).click();
    const scripted = await page.evaluate(
      () =>
        document
          .querySelector("[data-prompt-state]")
          ?.getAnimations({ subtree: true })
          .filter((animation) => animation.constructor === Animation).length,
    );
    expect(scripted).toBe(0);
    await expect(shownView(page).getByRole("button", { name: /^Ask the agent / })).toBeVisible();
  });
});
