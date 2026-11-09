import { expect, type Page, test } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";
const FENCE = "```";
const SANDBOXED_FRAME_PROBE = "Blocked script execution in 'about:srcdoc'";

async function open(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith(SANDBOXED_FRAME_PROBE)) errors.push(message.text());
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

function notebookBlock(page: Page) {
  return page.locator('.ProseMirror:visible .note-drawn[data-block="notebook"]');
}

test.describe("Notes notebooks", () => {
  test("previews a task notebook and inserts it as a block that draws every kind of output", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Dataloader rewrite: what changed");
    await page.getByRole("button", { name: "Artifacts, 1" }).click();
    const panel = page.getByRole("complementary", { name: "Artifacts" });
    await expect(panel.locator("section").getByText("Notebook", { exact: true })).toBeVisible();
    const preview = panel.locator("[data-artifact-notebook]");
    await expect(preview.getByRole("heading", { name: "Mask ratio sweep" })).toBeVisible();
    await expect(preview.getByText("[4]")).toBeVisible();

    await panel.getByRole("button", { name: "Insert in note" }).click();
    await expect.poll(() => noteText(page, "dataloader")).toContain(`${FENCE}notebook\nassets/mask-sweep.ipynb\n${FENCE}`);

    const block = notebookBlock(page);
    await expect(block.locator(".note-drawn-label")).toHaveText("Jupyter notebook");
    await expect(block.getByRole("heading", { name: "Mask ratio sweep" })).toBeVisible();
    await expect(block.locator(".katex").first()).toBeVisible();
    await expect(block.getByText("[1]")).toBeVisible();
    await expect(block.locator('code[data-language="python"]').first()).toContainText("ratios = [0.75, 0.60]");
    const plot = block.getByRole("img", { name: "Output of cell 2" });
    await expect(plot).toBeVisible();
    expect(await plot.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(24);
    await expect(block.getByText("best ratio: 0.60")).toBeVisible();
    await expect(block.getByText("ZeroDivisionError: division by zero").first()).toBeVisible();
    await expect(block.locator("[data-notebook-error] pre")).not.toContainText("[0;31m");

    const frame = block.getByTitle("HTML output of cell 4");
    await expect(frame).toHaveAttribute("sandbox", "");
    const table = page.frameLocator('.ProseMirror:visible iframe[title="HTML output of cell 4"]');
    await expect(table.getByRole("cell", { name: "64.1" })).toBeVisible();
    await expect(table.locator("script")).toHaveCount(0);
    expect(await page.title()).toBe("Notes fixture");

    await block.getByRole("button", { name: "Source" }).click();
    await expect(block.locator(":scope > pre")).toBeVisible();
    await expect(block.locator(":scope > pre code")).toHaveText("assets/mask-sweep.ipynb");
    expect(errors).toEqual([]);
  });

  test("copies a notebook in from the toolbar and narrows it to the cells asked for", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Abstract draft");
    await page.locator(".ProseMirror:visible > p").first().click();
    await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Insert notebook" }).click();
    const block = notebookBlock(page);
    await expect(block.getByRole("img", { name: "Output of cell 2" })).toBeVisible();
    await expect(block.locator("[data-notebook-cell]")).toHaveCount(5);
    await expect.poll(() => noteText(page, "abstract")).toContain(`${FENCE}notebook\nassets/sweep-1a2b3c4d.ipynb\n${FENCE}`);

    await block.getByRole("button", { name: "Source" }).click();
    const source = block.locator(":scope > pre code");
    const box = await source.boundingBox();
    if (!box) throw new Error("no source geometry");
    await source.click({ position: { x: box.width - 1, y: box.height / 2 } });
    await page.keyboard.press("Enter");
    await page.keyboard.type("cells: 2-3");
    await page.keyboard.press("Enter");
    await page.keyboard.type("code: hide");
    await block.getByRole("button", { name: "Preview" }).click();
    await expect(block.locator("[data-notebook-cell]")).toHaveCount(2);
    await expect(block.getByRole("img", { name: "Output of cell 2" })).toBeVisible();
    await expect(block.getByText("best ratio: 0.60")).toBeVisible();
    await expect(block.getByText("ratios = [0.75, 0.60]")).toHaveCount(0);
    await expect.poll(() => noteText(page, "abstract")).toContain("assets/sweep-1a2b3c4d.ipynb\ncells: 2-3\ncode: hide\n");

    await block.getByRole("button", { name: "Source" }).click();
    await source.click({ position: { x: 1, y: 4 } });
    await page.keyboard.type("../");
    await expect(block.locator(".note-drawn-preview")).toContainText("Put the notebook's path on the first line");
    expect(errors).toEqual([]);
  });

  test("lists notebooks under their own tag and draws them in dark mode", async ({ page }) => {
    const errors = await open(page, "?theme=dark");
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Filters" }).click();
    await sidebar.getByRole("tab", { name: "Notebooks" }).click();
    await expect(sidebar.getByRole("button", { name: /Mask ratio sweep/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Masking strategy report/ })).toHaveCount(0);
    await expect(sidebar.locator('[data-kind-dot="notebook"]')).toBeVisible();
    await sidebar.getByRole("tab", { name: "All" }).click();

    await openNote(page, "Dataloader rewrite: what changed");
    await page.getByRole("button", { name: "Artifacts, 1" }).click();
    await page.getByRole("complementary", { name: "Artifacts" }).getByRole("button", { name: "Insert in note" }).click();
    await expect(notebookBlock(page).getByRole("img", { name: "Output of cell 2" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
