import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";
const SIZE = { width: 460, height: 220 };

async function openCapture(page: Page, query = "") {
  await page.setViewportSize(SIZE);
  await page.goto(`${BASE_URL}/e2e/quick-capture-harness.html${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
  await expect(page.getByTestId("quick-capture")).toBeVisible();
}

type Harness = { __captures?: unknown[]; __hidden?: number; __openedNotes?: number; __windowButtons?: boolean[] };

function harness<K extends keyof Harness>(page: Page, key: K) {
  return page.evaluate((name) => (window as typeof window & Harness)[name], key);
}

function field(page: Page) {
  return page.getByRole("textbox", { name: "Text to capture" });
}

function opacity(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => getComputedStyle(element).opacity);
}

test("starts as an untitled blank note and shows its controls only on hover", async ({ page }) => {
  await openCapture(page);
  await expect(field(page)).toBeFocused();
  await expect(page.getByTestId("quick-capture-title")).toHaveText("Untitled");
  await expect(page.getByText("0 characters")).toBeVisible();
  const placeholder = await field(page).evaluate((element) => getComputedStyle(element, "::before").content);
  expect(placeholder).toBe('"Start writing…"');
  expect(await opacity(page, "[data-capture-controls]")).toBe("0");
  await page.mouse.move(220, 100);
  await page.mouse.move(230, 110);
  await expect.poll(() => opacity(page, "[data-capture-controls]")).toBe("1");
  expect(await harness(page, "__windowButtons")).toContain(true);
  await page.getByRole("button", { name: "Open Notes" }).click();
  expect(await harness(page, "__openedNotes")).toBe(1);
});

test("turns a slash command into a heading, follows it as the title and adds it to today's note", async ({ page }) => {
  await openCapture(page);
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Insert" });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box && box.y >= 0 && box.y + box.height <= SIZE.height).toBe(true);
  await page.keyboard.type("heading 1");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await page.keyboard.type("Lab meeting");
  await expect(page.getByTestId("quick-capture-title")).toHaveText("Lab meeting");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Move to Thursday");
  await expect(page.getByText("27 characters")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
  await expect.poll(() => harness(page, "__hidden")).toBe(1);
  expect(await harness(page, "__captures")).toEqual([
    expect.objectContaining({ text: "# Lab meeting\n\nMove to Thursday", target: "today" }),
  ]);
  await expect(page.getByTestId("quick-capture-title")).toHaveText("Untitled");
});

test("keeps the draft across a reload and after a failed save, and hides on Escape", async ({ page }) => {
  await openCapture(page, "?fail=1");
  await page.keyboard.type("An idea worth keeping");
  await page.reload();
  await expect(page.getByTestId("quick-capture")).toBeVisible();
  await expect(field(page)).toHaveText("An idea worth keeping");
  await field(page).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("alert")).toHaveText("Couldn't save this. Your text is still here, so you can try again.");
  await expect(field(page)).toHaveText("An idea worth keeping");
  expect(await harness(page, "__hidden")).toBe(0);
  await page.keyboard.press("Escape");
  await expect.poll(() => harness(page, "__hidden")).toBe(1);
});

test("opens the actions with the keyboard, and Escape closes only the menu", async ({ page }) => {
  await openCapture(page);
  await page.keyboard.type("Grant idea");
  await page.keyboard.press("ControlOrMeta+K");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Save as new note/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Add to today's note/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Copy as Markdown/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Discard draft/ })).toBeVisible();
  await expect.poll(() => opacity(page, "[data-capture-controls]")).toBe("1");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  expect(await harness(page, "__hidden")).toBe(0);
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("menuitem", { name: /^Save as new note/ }).click();
  await expect.poll(() => harness(page, "__hidden")).toBe(1);
  expect(await harness(page, "__captures")).toEqual([expect.objectContaining({ text: "Grant idea", target: "new" })]);
});

test("New note saves the draft and starts a blank one without closing", async ({ page }) => {
  await openCapture(page);
  await page.keyboard.type("First thought");
  await page.mouse.move(220, 100);
  await page.mouse.move(230, 110);
  await page.getByRole("button", { name: "New note" }).click();
  await expect.poll(async () => (await harness(page, "__captures"))?.length).toBe(1);
  await expect(page.getByTestId("quick-capture-title")).toHaveText("Untitled");
  await page.keyboard.type("Second");
  await expect(page.getByTestId("quick-capture-title")).toHaveText("Second");
  expect(await harness(page, "__hidden")).toBe(0);
});

test("formats from the floating bar and fits the small window in both themes", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await openCapture(page, `?theme=${theme}`);
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth > window.innerWidth,
      y: document.documentElement.scrollHeight > window.innerHeight,
    }));
    expect(overflow).toEqual({ x: false, y: false });
    await page.mouse.move(220, 100);
    await page.mouse.move(230, 110);
    await page.getByRole("button", { name: "Show formatting" }).click();
    const toolbar = page.getByRole("toolbar", { name: "Formatting" });
    await expect(toolbar).toBeVisible();
    const bar = await toolbar.boundingBox();
    expect(bar && bar.x >= 0 && bar.x + bar.width <= SIZE.width && bar.y + bar.height <= SIZE.height).toBe(true);
    await expect(toolbar.getByRole("button", { name: "Block type" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Quote", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Code block", exact: true })).toBeVisible();
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Hide formatting" }).click();
    await expect(toolbar).toBeHidden();
  }
  await field(page).click();
  await page.keyboard.type("bold");
  await page.keyboard.press("ControlOrMeta+A");
  await page.mouse.move(220, 100);
  await page.mouse.move(230, 110);
  await page.getByRole("button", { name: "Show formatting" }).click();
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" }).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(() => harness(page, "__captures")).toEqual([expect.objectContaining({ text: "**bold**" })]);
});
