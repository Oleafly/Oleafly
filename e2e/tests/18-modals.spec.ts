import { test, expect } from "../fixtures";
import { openProject, pressGlobal } from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test("nested app and template modals honor topmost Escape ownership", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Home"]');
  await tauriPage.click('[aria-label="Settings"]');
  await expect(tauriPage.locator('[aria-label="Close settings"]')).toBeVisible();
  await tauriPage.evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'New project')?.click()`);
  await expect(tauriPage.getByTestId("template-gallery")).toBeVisible();
  await tauriPage.evaluate(`document.querySelector('[aria-label="Close settings"]')?.closest('[role="presentation"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await expect(tauriPage.getByTestId("template-gallery")).toBeVisible();
  await expect(tauriPage.locator('[aria-label="Close settings"]')).toBeVisible();
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.getByTestId("template-gallery")).not.toBeVisible();
  await expect(tauriPage.locator('[aria-label="Close settings"]')).toBeVisible();
  await tauriPage.evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'New project')?.click()`);
  await expect(tauriPage.getByTestId("template-gallery")).toBeVisible();
  await tauriPage.evaluate(`document.querySelector('[data-testid="template-gallery"]')?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await expect(tauriPage.getByTestId("template-gallery")).not.toBeVisible();
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.locator('[aria-label="Close settings"]')).not.toBeVisible();
  await expect(tauriPage.locator('[aria-label="Settings"]')).toBeFocused();
});

test("word count modal opens from the palette and closes", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "k", { meta: true });
  await tauriPage.fill("[cmdk-input]", "word"); // cmdk matches single terms
  await tauriPage.press("[cmdk-input]", "Enter");
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('Word count')`,
    10_000,
  );
  await tauriPage.getByText("Close", { exact: true }).click();
  await tauriPage.waitForFunction(
    `!document.body.innerText.includes('Word count')`,
    10_000,
  );
});

test("history modal opens from the palette", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "k", { meta: true });
  await tauriPage.fill("[cmdk-input]", "history");
  await tauriPage.press("[cmdk-input]", "Enter");
  // The modal heading renders (history may be empty for a fresh repo).
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some(h => h.textContent.trim() === 'History')`,
    10_000,
  );
  await tauriPage.getByText("Close", { exact: true }).click();
});

test("help popover leads to the About dialog", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Help"]');
  await tauriPage.getByText("Contact us").click();
  await expect(tauriPage.locator('[aria-label="Close"]')).toBeVisible();
  await tauriPage.click('[aria-label="Close"]');
});

test("shortcuts reference filters as you search", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "/", { meta: true });
  await expect(tauriPage.getByText("Keyboard Shortcuts")).toBeVisible();
  await tauriPage.fill('input[placeholder="Search shortcuts…"]', "recompile");
  await expect(tauriPage.getByText("Recompile")).toBeVisible();
  await tauriPage.fill('input[placeholder="Search shortcuts…"]', "zzzznothing");
  await expect(tauriPage.getByText("No shortcuts found.")).toBeVisible();
});
