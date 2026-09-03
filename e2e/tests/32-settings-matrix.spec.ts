import { test, expect } from "../fixtures";
import {
  compileAndWait,
  createBlankProject,
  openProject,
  openSettings,
  type Page,
} from "../helpers";

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

async function openAppearanceTab(
  page: Page,
  tab: "app" | "editor" | "pdf" | "files",
) {
  await openSettings(page, "appearance");
  const selector = `[data-testid="appearance-tab-${tab}"]`;
  await page.press(selector, "Enter");
  await page.waitForFunction(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("data-state") === "active"`,
    5_000,
  );
}

async function setOfflineMode(page: Page, enabled: boolean) {
  await openSettings(page, "general");
  const selector = '[role="switch"][aria-label="Offline mode"]';
  const checked = await page.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-checked") === "true"`,
  );
  if (checked !== enabled) await page.click(selector);
  await page.waitForFunction(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-checked") === ${JSON.stringify(String(enabled))}`,
    5_000,
  );
  await page.click('[aria-label="Close settings"]');
}

test("every editor font size option restyles the editor", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openAppearanceTab(tauriPage, "editor");
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
  await openAppearanceTab(tauriPage, "app");
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
  await openAppearanceTab(tauriPage, "app");
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
  await openAppearanceTab(tauriPage, "editor");
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
  await openAppearanceTab(tauriPage, "app");
  const accents = [
    ["Green", "#0b8842"],
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
    await openAppearanceTab(tauriPage, "files");
    await pickOption(tauriPage, "Open projects in", label);
    await tauriPage.click('[aria-label="Close settings"]');
  };
  const reopen = async () => {
    await tauriPage.click('[title="Back to library"]');
    await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 10_000 });
    await openProject(tauriPage, "E2E Doc");
  };

  await setDefaultView("Preview Only");
  await reopen();
  await tauriPage.waitForFunction(`!document.querySelector('.cm-content')`, 10_000);

  await setDefaultView("Editor Only");
  await reopen();
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
  await tauriPage.waitForFunction(`!document.querySelector('.pdf-canvas')`, 10_000);

  await setDefaultView("Editor + Preview");
  await reopen();
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
});

test("show-file-tree-on-open controls the sidebar", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openAppearanceTab(tauriPage, "files");
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
    `!!document.querySelector('[aria-label^="Show sidebar"]')`,
    10_000,
  );
  // With the setting off the sidebar panel is not rendered at all.
  await expect(tauriPage.locator('[aria-label="Source Tree"]')).toHaveCount(0);

  await openAppearanceTab(tauriPage, "files");
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
    `!!document.querySelector('[aria-label^="Hide sidebar"]')`,
    10_000,
  );
  // The panel must actually be on screen, not merely reported open: a zero
  // width sidebar (a collapsed panel) fails this even though the toggle label
  // says "Hide sidebar".
  await expect(tauriPage.locator('[aria-label="Source Tree"]')).toBeVisible();
});

test("offline mode compiles from the local cache", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  // This is a compiler-policy test, so give it a fresh immutable fixture
  // instead of inheriting the shared E2E Doc after earlier editing specs.
  await createBlankProject(
    tauriPage,
    `E2E Offline Cache ${Date.now().toString(36)}`,
  );
  await setOfflineMode(tauriPage, false);
  // First compile online to populate exactly the resources used by this
  // document, then require a new verified output while Tectonic is
  // constrained to --only-cached.
  await compileAndWait(tauriPage, 120_000);
  await setOfflineMode(tauriPage, true);
  try {
    await compileAndWait(tauriPage, 120_000);
  } finally {
    await setOfflineMode(tauriPage, false);
  }
});

test("the shortcuts settings section exposes configurable app shortcuts", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "shortcuts");
  await expect(tauriPage.getByText("Command palette", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Reset to defaults", { exact: true })).toBeVisible();
});

test("reset to defaults restores factory preferences", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openAppearanceTab(tauriPage, "editor");
  await pickOption(tauriPage, "Editor font size", "20px");
  await tauriPage.press('[data-testid="appearance-tab-app"]', "Enter");
  await tauriPage.click('button[title="Teal"]');
  await tauriPage.waitForFunction(
    `getComputedStyle(document.querySelector('.cm-content')).fontSize === '20px'`,
    5_000,
  );

  await openSettings(tauriPage, "appearance");
  await tauriPage.getByText("Reset to defaults").click();
  // The confirm button shares its label with the section button behind the
  // dialog, so resolve it strictly inside the alertdialog.
  await tauriPage.waitForFunction(
    `!!document.querySelector('[role="alertdialog"]')`,
    5_000,
  );
  await tauriPage.evaluate(
    `(() => {
      const dialog = document.querySelector('[role="alertdialog"]');
      const button = dialog && Array.from(dialog.querySelectorAll("button"))
        .find((b) => b.textContent?.trim() === "Reset to defaults");
      if (!(button instanceof HTMLElement)) throw new Error("confirm button not found");
      button.click();
      return true;
    })()`,
  );

  await tauriPage.waitForFunction(
    `getComputedStyle(document.querySelector('.cm-content')).fontSize === '13px'
      && document.documentElement.style.getPropertyValue('--primary') === '#2563eb'`,
    10_000,
  );
  await tauriPage.click('[aria-label="Close settings"]');
});

test("appearance choice in settings sets the real theme", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const isDark = () =>
    tauriPage.evaluate<boolean>(`document.documentElement.classList.contains('dark')`);
  const option = (value: "system" | "light" | "dark") =>
    `[data-testid="settings-appearance-${value}"]`;
  const before = await isDark();
  await openAppearanceTab(tauriPage, "app");
  await tauriPage.click(option("light"));
  await expect(tauriPage.locator(option("light"))).toHaveAttribute("aria-pressed", "true");
  expect(await isDark()).toBe(false);
  await tauriPage.click(option("dark"));
  await expect(tauriPage.locator(option("dark"))).toHaveAttribute("aria-pressed", "true");
  expect(await isDark()).toBe(true);
  await tauriPage.click(option("system"));
  await expect(tauriPage.locator(option("system"))).toHaveAttribute("aria-pressed", "true");
  const systemDark = await tauriPage.evaluate<boolean>(
    `!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches)`,
  );
  expect(await isDark()).toBe(systemDark);
  await tauriPage.click(option(before ? "dark" : "light"));
  expect(await isDark()).toBe(before);
  await tauriPage.click('[aria-label="Close settings"]');
});
