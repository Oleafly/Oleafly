import { test, expect } from "../fixtures";
import { openProject, pressGlobal } from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
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
