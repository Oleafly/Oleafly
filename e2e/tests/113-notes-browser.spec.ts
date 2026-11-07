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

async function openNote(page: Page, title: string): Promise<void> {
  await page.locator("aside").getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(title);
  await expect(page.locator(".ProseMirror")).toBeVisible();
}

function noteText(page: Page, id: string): Promise<string> {
  return page.evaluate((noteId) => (window as unknown as { __notes: { text(id: string): string } }).__notes.text(noteId), id);
}

function prompt(page: Page) {
  return page.getByRole("combobox", { name: "Ask the agent" });
}

function firstParagraph(page: Page) {
  return page.locator(".ProseMirror > p").first();
}

async function runAction(page: Page, filter: string): Promise<void> {
  await prompt(page).fill(`/${filter}`);
  await expect(page.getByRole("option").first()).toBeVisible();
  await prompt(page).press("Enter");
}

test.describe("Notes", () => {
  test("lists notes, artifacts and experiments on Home", async ({ page }) => {
    const errors = await open(page);
    await expect(page.getByRole("heading", { name: "Your research notes" })).toBeVisible();
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("heading", { name: "SSL masking" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Masking strategy report/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Run 3, mask ratio 0.60/ })).toBeVisible();
    await expect(page.locator("main").getByText("3 runs · 4 figures · 2 reports", { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("filters the sidebar by kind, author and search", async ({ page }) => {
    await open(page);
    const sidebar = page.locator("aside");
    await sidebar.getByRole("tab", { name: "Runs" }).click();
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
    await runAction(page, "latest");

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
    await expect(page.locator(".ProseMirror > p", { hasText: "Run 3 is the first run" })).toBeVisible();
    await expect.poll(() => noteText(page, "masking")).toContain("\n\nRun 3 is the first run with the lower ratio");

    await runAction(page, "latest");
    await page.getByRole("button", { name: "Accept all" }).click();
    await expect(firstParagraph(page)).toContainText("0.60. The first run");
    await expect(firstParagraph(page)).toContainText("after the ratio dropped to 0.60");
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

  test("inserts an artifact into the note from the panel", async ({ page }) => {
    await open(page);
    await openNote(page, "Masking strategy report");
    await page.getByRole("button", { name: "Artifacts, 4" }).click();
    const panel = page.getByRole("complementary", { name: "Artifacts" });
    await expect(panel.getByText("From chat: Review run 3")).toBeVisible();
    await expect(page.locator('.note-drawn[data-block="chart"]')).toHaveCount(1);
    await panel.getByRole("button", { name: "Insert in note" }).click();
    await expect(page.locator('.note-drawn[data-block="chart"]')).toHaveCount(2);
    await panel.getByRole("button", { name: /Mask sampler explorer/ }).click();
    await expect(panel.getByText("Interactive figures can't run in Oleafly yet.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Insert in note" })).toHaveCount(0);
  });

  test("saves typing, the title and the icon to the note's Markdown", async ({ page }) => {
    await open(page);
    await openNote(page, "Abstract draft");
    await page.locator(".ProseMirror > p").first().click();
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
    expect(await noteText(page, "abstract")).toMatch(/^---\ntitle: "Abstract: second draft"\nicon: lucide:flask-conical\n---\n\nWe study/u);
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
    await expect(page.locator(".ProseMirror")).toContainText("per pixel");
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
    await expect(page.locator(".ProseMirror")).toContainText("per patch");
    await page.waitForTimeout(1200);
    expect(await noteText(page, "masking")).toBe(after);
  });

  test("starts a new note", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "New note" }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Untitled");
    await expect(page.locator("aside").getByRole("button", { name: /Untitled/ })).toBeVisible();
  });

  test("renders in dark mode without errors", async ({ page }) => {
    const errors = await open(page, "?theme=dark");
    await openNote(page, "Masking strategy report");
    await expect(page.locator('.note-drawn[data-block="chart"] svg')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
