import { expect, type Page, test } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

type Box = { x: number; y: number; width: number; height: number };

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${BASE_URL}/e2e/pane-layout-harness.html`);
  await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  await expect(page.locator("#sidebar")).toBeVisible();
  return errors;
}

function run(page: Page, script: string): Promise<unknown> {
  return page.evaluate(`(() => { const h = window.__layout; ${script} })()`);
}

function arrangement(page: Page): Promise<string> {
  return run(page, "return h.layoutKey(h.panes.getState().layout);") as Promise<string>;
}

async function box(page: Page, id: string): Promise<Box> {
  const found = await page.locator(`[id="${id}"]`).boundingBox();
  if (!found) throw new Error(`${id} has no box`);
  return found;
}

async function widths(page: Page, ids: readonly string[]): Promise<number[]> {
  return Promise.all(ids.map(async (id) => Math.round((await box(page, id)).width)));
}

async function heights(page: Page, ids: readonly string[]): Promise<number[]> {
  return Promise.all(ids.map(async (id) => Math.round((await box(page, id)).height)));
}

async function dragSeparator(page: Page, id: string, dx: number, dy: number) {
  const handle = await box(page, id);
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);
}

test.describe("project pane layout", () => {
  test("keeps the sizes the user dragged when a pane moves away and back", async ({ page }) => {
    const errors = await open(page);
    await dragSeparator(page, "h-tree", 80, 0);
    await dragSeparator(page, "h-mid", -100, 0);
    const band = await widths(page, ["sidebar", "editorpdf", "assistant"]);
    const editor = await widths(page, ["editor"]);
    await run(page, `h.settings.setState({ terminalOpen: true }); h.panes.getState().move("terminal", { kind: "pane", pane: "pdf", side: "bottom" });`);
    await expect(page.locator("#terminal")).toBeVisible();
    expect(await widths(page, ["sidebar", "editorpdf", "assistant"])).toEqual(band);
    expect(await widths(page, ["editor"])).toEqual(editor);
    await run(page, `h.panes.getState().move("terminal", { kind: "edge", side: "bottom" });`);
    await expect(page.locator("#v-terminal")).toBeVisible();
    expect(await widths(page, ["sidebar", "editorpdf", "assistant"])).toEqual(band);
    expect(await widths(page, ["editor"])).toEqual(editor);
    expect(errors).toEqual([]);
  });

  test("resizes the two panes on either side of a separator after a reorder in the same row", async ({ page }) => {
    const errors = await open(page);
    await run(page, `h.panes.getState().move("sidebar", { kind: "pane", pane: "assistant", side: "right" });`);
    await expect(page.locator("#sep-assistant-sidebar")).toBeVisible();
    const [document, assistant, sidebar] = await widths(page, ["editorpdf", "assistant", "sidebar"]);
    await dragSeparator(page, "sep-assistant-sidebar", 60, 0);
    const [documentAfter, assistantAfter, sidebarAfter] = await widths(page, ["editorpdf", "assistant", "sidebar"]);
    near(documentAfter ?? 0, document ?? 0);
    near(assistantAfter ?? 0, (assistant ?? 0) + 60);
    near((sidebarAfter ?? 0) + 60, sidebar ?? 0);
    expect(errors).toEqual([]);
  });

  test("lets the user resize the assistant moved below a closed terminal", async ({ page }) => {
    const errors = await open(page);
    await run(page, `h.panes.getState().move("assistant", { kind: "edge", side: "bottom" });`);
    const separator = page.locator("[data-separator]").last();
    await expect(separator).toBeVisible();
    const id = (await separator.getAttribute("id")) ?? "";
    const [before] = await heights(page, ["assistant"]);
    await dragSeparator(page, id, 0, -80);
    const [after] = await heights(page, ["assistant"]);
    near(after ?? 0, (before ?? 0) + 80);
    expect(errors).toEqual([]);
  });

  test("leaves the arrangement alone after a short drag on a pane header", async ({ page }) => {
    const errors = await open(page);
    const before = await arrangement(page);
    const bar = await box(page, "editor");
    await page.mouse.move(bar.x + bar.width / 2, bar.y + 10);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2 + 8, bar.y + 10, { steps: 4 });
    await expect(page.locator("[data-pane-reorder='dragging']")).toBeVisible();
    await expect(page.locator("[data-pane-drop]")).toHaveCount(0);
    await page.mouse.up();
    expect(await arrangement(page)).toBe(before);
    expect(errors).toEqual([]);
  });

  test("keeps an open terminal open when the arrangement is reset", async ({ page }) => {
    const errors = await open(page);
    await run(page, `h.settings.setState({ terminalOpen: true }); h.panes.getState().move("sidebar", { kind: "edge", side: "right" });`);
    await expect(page.locator("#terminal")).toBeVisible();
    await run(page, `h.panes.getState().reset();`);
    await expect(page.locator("#v-terminal")).toBeVisible();
    await expect(page.locator("#terminal")).toBeVisible();
    expect(await run(page, "return h.settings.getState().terminalOpen;")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("saves a layout, then brings back its arrangement and sizes after a rearrange", async ({ page }) => {
    const errors = await open(page);
    await run(page, `h.panes.getState().move("assistant", { kind: "pane", pane: "pdf", side: "bottom" });`);
    await dragSeparator(page, "h-tree", 120, 0);
    const saved = await arrangement(page);
    const sizes = await widths(page, ["sidebar", "editorpdf"]);
    await run(page, `h.saved.getState().save("Review");`);
    await run(page, `h.panes.getState().reset(); h.settings.setState({ showTree: false });`);
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await run(page, `h.saved.getState().apply(h.saved.getState().layouts[0].id);`);
    await expect(page.locator("#sidebar")).toBeVisible();
    expect(await arrangement(page)).toBe(saved);
    const after = await widths(page, ["sidebar", "editorpdf"]);
    near(after[0] ?? 0, sizes[0] ?? 0);
    near(after[1] ?? 0, sizes[1] ?? 0);
    expect(errors).toEqual([]);
  });
});
