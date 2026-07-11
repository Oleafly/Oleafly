import { test, expect } from "../fixtures";
import { openProject, openSettings, pressGlobal, paletteItems } from "../helpers";

// Settings must take effect immediately AND survive an app restart (the test
// fixture reloads the whole app before every test, so a two-test pair proves
// real persistence, not just in-memory state).

test("settings modal opens with all sections", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage);
  for (const s of ["appearance", "general", "dictionary", "ai", "engine", "downloads", "github"]) {
    await expect(tauriPage.locator(`[data-testid="settings-section-${s}"]`)).toBeVisible();
  }
  await tauriPage.click('[aria-label="Close settings"]');
});

test("compile-button label toggle takes effect immediately", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  const compileLabel = async () =>
    tauriPage.evaluate<string>(
      `document.querySelector('[aria-label="Recompile"]')?.textContent?.trim() ?? ''`,
    );
  const before = await compileLabel();

  await openSettings(tauriPage, "appearance");
  await tauriPage.click('[role="switch"][aria-label="Label the compile button"]');
  await tauriPage.click('[aria-label="Close settings"]');
  const after = await compileLabel();
  expect(after).not.toBe(before); // "Compile" text appeared or disappeared

  // Restore.
  await openSettings(tauriPage, "appearance");
  await tauriPage.click('[role="switch"][aria-label="Label the compile button"]');
  await tauriPage.click('[aria-label="Close settings"]');
  expect(await compileLabel()).toBe(before);
});

test("vim mode: enable via the palette (persistence part 1)", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "k", { meta: true });
  await tauriPage.fill("[cmdk-input]", "vim");
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
  await openProject(tauriPage, "E2E Doc");
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
  // State-dependent labels render one of their two forms.
  expect(items.some((t) => /vim mode/.test(t))).toBe(true);
  expect(items.some((t) => /spellcheck/.test(t))).toBe(true);
  expect(items.some((t) => /theme/.test(t))).toBe(true);
  expect(items.some((t) => /auto-compile/.test(t))).toBe(true);
  expect(items.some((t) => /line mode|Offline|Online/.test(t))).toBe(true);
  await tauriPage.press("[cmdk-input]", "Escape");
});
