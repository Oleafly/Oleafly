import { test, expect } from "../fixtures";
import {
  createBlankProject,
  openProject,
  openSettings,
  pressGlobal,
  paletteItems,
  type Page,
} from "../helpers";

const PROJECT = "E2E Settings";

async function openSettingsProject(page: Page & { getByText(t: string): { click(): Promise<void> } }) {
  const exists = await page.evaluate<boolean>(
    `Array.from(document.querySelectorAll('button')).some((el) => el.textContent?.includes(${JSON.stringify(PROJECT)}))`,
  );
  if (exists) await openProject(page, PROJECT);
  else await createBlankProject(page, PROJECT);
}

// The test fixture reloads the whole frontend before every test, so the
// two-test pair below proves persistence across a renderer restart, not merely
// React component state.

test("settings modal opens with all sections", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage);
  for (const s of ["appearance", "general", "ai", "github", "mcp"]) {
    await expect(tauriPage.locator(`[data-testid="settings-section-${s}"]`)).toBeVisible();
  }
  // The "Show advanced" toggle persists (localStorage), so only click it when
  // advanced sections are currently hidden.
  const dictionary = tauriPage.locator('[data-testid="settings-section-dictionary"]');
  if (!(await dictionary.isVisible())) {
    await tauriPage.click('[data-testid="settings-toggle-advanced"]');
  }
  for (const s of ["dictionary", "engine", "downloads", "data"]) {
    await expect(tauriPage.locator(`[data-testid="settings-section-${s}"]`)).toBeVisible();
  }
  await tauriPage.click('[data-testid="settings-section-help"]');
  await expect(tauriPage.locator('[data-testid="about-oleafly-logo"]')).toBeVisible();
  await expect(tauriPage.getByText("About Oleafly", { exact: true })).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');
});

test("keyboard shortcuts opens above settings without closing it", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage);
  await tauriPage.click('[data-testid="settings-section-general"]');
  await tauriPage.getByText("Shortcuts:", { exact: false }).click();
  await expect(tauriPage.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(
    tauriPage.getByRole("dialog", { name: "Keyboard Shortcuts" }),
  ).toBeVisible();
  await tauriPage.click('[aria-label="Close keyboard shortcuts"]');
  await expect(tauriPage.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');
});

test("keyboard shortcuts opens above settings from the home view", async ({ tauriPage }) => {
  const back = tauriPage.locator('[title="Back to library"]');
  if (await back.isVisible()) await back.click();
  await openSettings(tauriPage);
  await tauriPage.click('[data-testid="settings-section-general"]');
  await tauriPage.getByText("Shortcuts:", { exact: false }).click();
  await expect(tauriPage.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(
    tauriPage.getByRole("dialog", { name: "Keyboard Shortcuts" }),
  ).toBeVisible();
  await tauriPage.click('[aria-label="Close keyboard shortcuts"]');
  await expect(tauriPage.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');
});

test("home tour opens from Help and About", async ({ tauriPage }) => {
  const back = tauriPage.locator('[title="Back to library"]');
  if (await back.isVisible()) await back.click();
  await openSettings(tauriPage);
  await tauriPage.click('[data-testid="settings-section-help"]');
  await tauriPage.getByText("Start tour", { exact: true }).click();
  await expect(tauriPage.getByRole("alertdialog")).toBeVisible();
  await expect(tauriPage.getByText("Home", { exact: true })).toBeVisible();
  await tauriPage.getByRole("button", { name: "Skip" }).click();
  await expect(tauriPage.getByRole("alertdialog")).toBeHidden();
});

test("compile button becomes recompile after the first result", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  const initialLabel = await tauriPage.evaluate<string>(
    `document.querySelector('[data-testid="compile-button"]')?.textContent?.trim() ?? ''`,
  );
  if (initialLabel === "Compile") {
    await tauriPage.click('[data-testid="compile-button"]');
  }
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toContainText("Recompile", {
    timeout: 120_000,
  });
});

test("vim mode: enable via the palette (persistence part 1)", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "k", { meta: true });
  await tauriPage.fill("[cmdk-input]", "vim");
  const alreadyEnabled = await tauriPage.evaluate<boolean>(
    `document.body.innerText.includes('Disable vim mode')`,
  );
  if (alreadyEnabled) {
    await tauriPage.press("[cmdk-input]", "Enter");
    await expect(tauriPage.locator("[cmdk-input]")).toBeHidden();
    await pressGlobal(tauriPage, "k", { meta: true });
    await tauriPage.fill("[cmdk-input]", "vim");
  }
  await expect(tauriPage.getByText("Enable vim mode")).toBeVisible();
  await tauriPage.press("[cmdk-input]", "Enter");
});

test("vim mode survived the app restart, then disable it (part 2)", async ({ tauriPage }) => {
  // The fixture reloaded the entire app between these two tests.
  await pressGlobal(tauriPage, "k", { meta: true });
  await tauriPage.fill("[cmdk-input]", "vim");
  await expect(tauriPage.getByText("Disable vim mode")).toBeVisible();
  await tauriPage.press("[cmdk-input]", "Enter"); // restore off
  await pressGlobal(tauriPage, "k", { meta: true });
  await tauriPage.fill("[cmdk-input]", "vim");
  await expect(tauriPage.getByText("Enable vim mode")).toBeVisible();
  await tauriPage.press("[cmdk-input]", "Escape");
});

test("palette lists every registered core command", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "k", { meta: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  const items = await paletteItems(tauriPage);
  for (const label of [
    "New project…",
    "Recompile",
    "Go to PDF (SyncTeX)",
    "Export PDF…",
    "Word count",
    "History",
    "Add citation",
    "Bold",
    "Italic",
    "Section",
    "Bulleted list",
    "Figure",
    "Table",
    "Equation",
    "Label",
  ]) {
    expect(items.some((t) => t.includes(label))).toBe(true);
  }
  expect(items.some((t) => /vim mode/.test(t))).toBe(true);
  expect(items.some((t) => /spellcheck/.test(t))).toBe(true);
  expect(items.some((t) => /theme/.test(t))).toBe(true);
  expect(items.some((t) => /auto-compile/.test(t))).toBe(true);
  expect(items.some((t) => /line mode|Offline|Online/.test(t))).toBe(true);
  await tauriPage.press("[cmdk-input]", "Escape");
});
