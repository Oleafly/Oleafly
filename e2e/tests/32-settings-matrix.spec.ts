import { test, expect } from "../fixtures";
import { openProject, openSettings, pressGlobal, type Page } from "../helpers";

async function pickOption(page: Page, rowText: string, optionText: string) {
  const rowId = rowText
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const row = page.locator(`[data-testid="settings-row-${rowId}"]`) as unknown as Parameters<
    typeof expect
  >[0];
  await expect(row).toBeVisible({ timeout: 10_000 });
  await page.click(`[data-testid="settings-row-${rowId}"] [role="combobox"]`);
  const optionSelector = `[role="option"][data-label=${JSON.stringify(optionText)}]`;
  await page.waitForFunction(`!!document.querySelector(${JSON.stringify(optionSelector)})`, 5_000);
  await page.evaluate(
    `document.querySelector(${JSON.stringify(optionSelector)}).scrollIntoView({ block: "nearest" })`,
  );
  await page.click(optionSelector);
}

test("every editor font size option restyles the editor", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "appearance");
  for (const px of [11, 12, 14, 16, 18, 20, 15, 13]) {
    // ends on 13 = default
    await pickOption(tauriPage, "Editor font size", `${px}px`);
    await tauriPage.waitForFunction(
      `getComputedStyle(document.querySelector('.cm-content')).fontSize === '${px}px'`,
      5_000,
    );
  }
  await tauriPage.click('[aria-label="Close settings"]');
});

test("every app font size option rescales the interface", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "appearance");
  for (const px of [13, 14, 15, 17, 18, 20, 16]) {
    // ends on 16 = default
    await pickOption(tauriPage, "App font size", `${px}px`);
    await tauriPage.waitForFunction(
      `document.documentElement.style.fontSize === '${px}px'`,
      5_000,
    );
  }
  await tauriPage.click('[aria-label="Close settings"]');
});

test("every app font option changes the interface font", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "appearance");
  const fonts = [
    ["Inter", "Inter"],
    ["Helvetica Neue", "Helvetica Neue"],
    ["Segoe UI", "Segoe UI"],
    ["Georgia (serif)", "Georgia"],
  ] as const;
  for (const [option, family] of fonts) {
    await pickOption(tauriPage, "App font", option);
    await tauriPage.waitForFunction(
      `document.documentElement.style.fontFamily.includes(${JSON.stringify(family)})`,
      5_000,
    );
  }
  await pickOption(tauriPage, "App font", "System default");
  await tauriPage.waitForFunction(
    `document.documentElement.style.fontFamily === ''`,
    5_000,
  );
  await tauriPage.click('[aria-label="Close settings"]');
});

test("every editor font option changes the code font", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "appearance");
  const fonts = [
    ["JetBrains Mono", "JetBrains Mono"],
    ["Fira Code", "Fira Code"],
    ["Cascadia Code", "Cascadia Code"],
    ["SF Mono", "SF Mono"],
    ["Menlo", "Menlo"],
    ["Consolas", "Consolas"],
  ] as const;
  for (const [option, family] of fonts) {
    await pickOption(tauriPage, "Editor font", option);
    await tauriPage.waitForFunction(
      `document.documentElement.style.getPropertyValue('--cm-font-family').includes(${JSON.stringify(family)})`,
      5_000,
    );
  }
  await pickOption(tauriPage, "Editor font", "System default");
  await tauriPage.waitForFunction(
    `document.documentElement.style.getPropertyValue('--cm-font-family') === ''`,
    5_000,
  );
  await tauriPage.click('[aria-label="Close settings"]');
});

test("every accent color repaints the primary color", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "appearance");
  const accents = [
    ["Green", "#16a34a"],
    ["Purple", "#7c3aed"],
    ["Rose", "#db2777"],
    ["Orange", "#ea580c"],
    ["Teal", "#0d9488"],
    ["Blue", "#2563eb"], // default last = restore
  ] as const;
  for (const [name, hex] of accents) {
    await tauriPage.click(`button[title="${name}"]`);
    await tauriPage.waitForFunction(
      `document.documentElement.style.getPropertyValue('--primary') === '${hex}'`,
      5_000,
    );
  }
  await tauriPage.click('[aria-label="Close settings"]');
});

test("open-projects-in controls the landing layout", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  const setDefaultView = async (label: string) => {
    await openSettings(tauriPage, "appearance");
    await pickOption(tauriPage, "Open projects in", label);
    await tauriPage.click('[aria-label="Close settings"]');
  };
  const reopen = async () => {
    await tauriPage.click('[title="Back to library"]');
    await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 10_000 });
    await openProject(tauriPage, "E2E Doc");
  };

  await setDefaultView("PDF only");
  await reopen();
  await tauriPage.waitForFunction(`!document.querySelector('.cm-content')`, 10_000);

  await setDefaultView("Editor only");
  await reopen();
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
  await tauriPage.waitForFunction(`!document.querySelector('.pdf-canvas')`, 10_000);

  await setDefaultView("Split view");
  await reopen();
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
});

test("show-file-tree-on-open controls the sidebar", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openSettings(tauriPage, "appearance");
  await tauriPage.evaluate(
    `(() => {
      const toggle = document.querySelector('[role="switch"][aria-label="Show file tree on open"]');
      if (toggle?.getAttribute('aria-checked') === 'true') toggle.click();
    })()`,
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.click('[title="Back to library"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 10_000 });
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.waitForFunction(
    `!!document.querySelector('[aria-label="Show sidebar"]')`,
    10_000,
  );

  await openSettings(tauriPage, "appearance");
  await tauriPage.evaluate(
    `(() => {
      const toggle = document.querySelector('[role="switch"][aria-label="Show file tree on open"]');
      if (toggle?.getAttribute('aria-checked') !== 'true') toggle?.click();
    })()`,
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.click('[title="Back to library"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 10_000 });
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.waitForFunction(
    `!!document.querySelector('[aria-label="Hide sidebar"]')`,
    10_000,
  );
});

test("offline mode compiles from the local cache", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "general");
  await tauriPage.click('[role="switch"][aria-label="Offline mode"]');
  await tauriPage.click('[aria-label="Close settings"]');

  // The document only uses already-cached packages, so --only-cached succeeds.
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });

  await openSettings(tauriPage, "general");
  await tauriPage.click('[role="switch"][aria-label="Offline mode"]');
  await tauriPage.click('[aria-label="Close settings"]');
});

test("the shortcuts settings section exposes configurable app shortcuts", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "shortcuts");
  await expect(tauriPage.getByText("Command palette", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Reset all shortcuts", { exact: true })).toBeVisible();
});

test("reset to defaults restores factory preferences", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openSettings(tauriPage, "appearance");
  await pickOption(tauriPage, "Editor font size", "20px");
  await tauriPage.click('button[title="Teal"]');
  await tauriPage.waitForFunction(
    `getComputedStyle(document.querySelector('.cm-content')).fontSize === '20px'`,
    5_000,
  );

  await tauriPage.click('[data-testid="settings-section-general"]');
  await tauriPage.getByText("Reset to defaults").click();
  await tauriPage.getByText("Reset", { exact: true }).click();

  await tauriPage.waitForFunction(
    `getComputedStyle(document.querySelector('.cm-content')).fontSize === '13px'
      && document.documentElement.style.getPropertyValue('--primary') === '#2563eb'`,
    10_000,
  );
  await tauriPage.click('[aria-label="Close settings"]');
});

test("dark mode switch in settings flips the real theme", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const theme = () =>
    tauriPage.evaluate<boolean>(`document.documentElement.classList.contains('dark')`);
  const before = await theme();
  await openSettings(tauriPage, "appearance");
  await tauriPage.click('[role="switch"][aria-label="Dark mode"]');
  expect(await theme()).toBe(!before);
  await tauriPage.click('[role="switch"][aria-label="Dark mode"]');
  expect(await theme()).toBe(before);
  await tauriPage.click('[aria-label="Close settings"]');
});
