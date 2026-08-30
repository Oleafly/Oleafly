import { test, expect } from "../fixtures";
import { openProject, openSettings, pressGlobal, type Page } from "../helpers";

const BROWSER = '[data-testid="dock-browser"]';
const BROWSER_ADDRESS = '[data-testid="dock-browser-address"]';
const BROWSER_OPEN = '[data-testid="dock-browser-open"]';
const BROWSER_TOGGLE = '[data-testid="rail-browser-toggle"]';
const TERMINAL = '[data-testid="dock-terminal"]';
const TERMINAL_TOGGLE = '[data-testid="rail-terminal-toggle"]';

async function selectAppearanceTab(
  page: Page,
  tab: "terminal" | "browser",
): Promise<void> {
  const selector = `[data-testid="appearance-tab-${tab}"]`;
  await page.evaluate(
    `(() => {
      const tab = document.querySelector(${JSON.stringify(selector)});
      if (!(tab instanceof HTMLButtonElement)) throw new Error("appearance tab is unavailable");
      tab.click();
      return true;
    })()`,
  );
  await page.waitForFunction(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("data-state") === "active"`,
    5_000,
  );
}

async function pickOption(
  page: Page,
  triggerSelector: string,
  optionText: string,
): Promise<void> {
  await page.click(triggerSelector);
  const optionSelector = `[role="option"][data-label=${JSON.stringify(optionText)}]`;
  await page.waitForFunction(
    `!!document.querySelector(${JSON.stringify(optionSelector)})`,
    5_000,
  );
  await page.evaluate(
    `document.querySelector(${JSON.stringify(optionSelector)})?.scrollIntoView({ block: "nearest" })`,
  );
  await page.click(optionSelector);
}

async function triggerBrowserShortcut(page: Page): Promise<void> {
  const nativeMenu = await page.evaluate<boolean>(
    `Boolean(window.__TAURI_INTERNALS__) && /Mac|Linux/.test(navigator.platform)`,
  );
  if (nativeMenu) {
    await page.evaluate(
      `window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
        event: "menu://toggle-browser",
        payload: null,
      }).then(() => true)`,
    );
    return;
  }
  await pressGlobal(page, "b", { ctrl: true, shift: true });
}

test("browser chrome navigates full URLs and configured searches", async ({
  tauriPage,
}) => {
  test.setTimeout(90_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await tauriPage.click(BROWSER_TOGGLE);
  await expect(tauriPage.locator(BROWSER)).toBeVisible();
  await expect(tauriPage.locator(BROWSER_ADDRESS)).toBeVisible();
  await expect(tauriPage.locator(BROWSER_OPEN)).toBeVisible();

  const enteredUrl = "https://example.com/e2e?via=enter";
  await tauriPage.fill(BROWSER_ADDRESS, enteredUrl);
  await tauriPage.press(BROWSER_ADDRESS, "Enter");
  await expect(tauriPage.locator(BROWSER_ADDRESS)).toHaveValue(enteredUrl);

  const openedUrl = "https://example.org/e2e?via=button";
  await tauriPage.fill(BROWSER_ADDRESS, openedUrl);
  await tauriPage.click(BROWSER_OPEN);
  await expect(tauriPage.locator(BROWSER_ADDRESS)).toHaveValue(openedUrl);

  await openSettings(tauriPage, "appearance");
  await selectAppearanceTab(tauriPage, "browser");
  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Default search engine"]',
    "Google",
  );
  await tauriPage.click('[aria-label="Close settings"]');

  await tauriPage.fill(BROWSER_ADDRESS, "hybrid beamforming");
  await tauriPage.click(BROWSER_OPEN);
  await expect(tauriPage.locator(BROWSER_ADDRESS)).toHaveValue(
    "https://www.google.com/search?q=hybrid%20beamforming",
  );

  await openSettings(tauriPage, "appearance");
  await selectAppearanceTab(tauriPage, "browser");
  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Default search engine"]',
    "DuckDuckGo",
  );
  await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `import("/src/store/settings.ts").then(({ useSettingsStore }) => useSettingsStore.getState().browserSearchEngine)`,
        ),
      { timeout: 5_000 },
    )
    .toBe("duckduckgo");
  await tauriPage.click('[aria-label="Close settings"]');

  await tauriPage.fill(BROWSER_ADDRESS, "hybrid beamforming");
  await tauriPage.press(BROWSER_ADDRESS, "Enter");
  await expect(tauriPage.locator(BROWSER_ADDRESS)).toHaveValue(
    "https://duckduckgo.com/?q=hybrid%20beamforming",
  );

  await openSettings(tauriPage, "appearance");
  await selectAppearanceTab(tauriPage, "browser");
  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Default search engine"]',
    "Google",
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.click(BROWSER_TOGGLE);
  await expect(tauriPage.locator(BROWSER)).not.toBeVisible();
});

test("the browser remains mounted while collapsed and its configured toggle route works", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  const browserLabel = await tauriPage.getAttribute(BROWSER_TOGGLE, "aria-label");
  expect(browserLabel).toMatch(/^Show browser \(Ctrl(?:\+Shift\+|⇧)B\)$/u);

  await tauriPage.click(BROWSER_TOGGLE);
  await expect(tauriPage.locator(BROWSER)).toBeVisible();
  const persistedUrl = "https://example.com/persisted-browser-state";
  await tauriPage.fill(BROWSER_ADDRESS, persistedUrl);
  await tauriPage.click(BROWSER_OPEN);
  await expect(tauriPage.locator(BROWSER_ADDRESS)).toHaveValue(persistedUrl);

  await tauriPage.click(BROWSER_TOGGLE);
  await expect(tauriPage.locator(BROWSER)).not.toBeVisible();
  await expect(tauriPage.locator(BROWSER)).toHaveCount(1);
  await expect(tauriPage.locator(BROWSER)).toHaveAttribute("aria-hidden", "true");
  await tauriPage.click(BROWSER_TOGGLE);
  await expect(tauriPage.locator(BROWSER)).toBeVisible();
  await expect(tauriPage.locator(BROWSER_ADDRESS)).toHaveValue(persistedUrl);
  await expect(tauriPage.getByTestId("dock-browser-error")).toHaveCount(0);

  await triggerBrowserShortcut(tauriPage);
  await expect(tauriPage.locator(BROWSER)).not.toBeVisible({ timeout: 10_000 });
  await triggerBrowserShortcut(tauriPage);
  await expect(tauriPage.locator(BROWSER)).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator(BROWSER_ADDRESS)).toHaveValue(persistedUrl);
  await tauriPage.click(BROWSER_TOGGLE);
  await expect(tauriPage.locator(BROWSER)).not.toBeVisible();
});

test("Appearance exposes scrollable dock tabs, search icons, and live terminal styles", async ({
  tauriPage,
}) => {
  test.setTimeout(90_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click(TERMINAL_TOGGLE);
  await expect(tauriPage.locator(TERMINAL)).toBeVisible();
  await expect(tauriPage.locator(`${TERMINAL} .xterm`)).toHaveCount(1, {
    timeout: 30_000,
  });

  await openSettings(tauriPage, "appearance");
  await expect(tauriPage.getByTestId("appearance-tab-terminal")).toBeVisible();
  await expect(tauriPage.getByTestId("appearance-tab-browser")).toBeVisible();
  const initialStrip = await tauriPage.evaluate<{
    clientWidth: number;
    scrollWidth: number;
    scrollbarWidth: string;
    webkitDisplay: string;
    webkitHeight: string;
  }>(`(() => {
    const strip = document.querySelector('[data-testid="appearance-tab-strip"]');
    if (!(strip instanceof HTMLElement)) throw new Error("appearance tab strip is unavailable");
    const style = getComputedStyle(strip);
    const webkit = getComputedStyle(strip, "::-webkit-scrollbar");
    strip.scrollLeft = 0;
    return {
      clientWidth: strip.clientWidth,
      scrollWidth: strip.scrollWidth,
      scrollbarWidth: style.scrollbarWidth,
      webkitDisplay: webkit.display,
      webkitHeight: webkit.height,
    };
  })()`);
  expect(initialStrip.scrollWidth).toBeGreaterThan(initialStrip.clientWidth);
  expect(
    initialStrip.scrollbarWidth === "none" ||
      initialStrip.webkitDisplay === "none" ||
      initialStrip.webkitHeight === "0px",
  ).toBe(true);

  await selectAppearanceTab(tauriPage, "browser");
  await expect
    .poll(
      () =>
        tauriPage.evaluate<boolean>(`(() => {
          const strip = document.querySelector('[data-testid="appearance-tab-strip"]');
          const tab = document.querySelector('[data-testid="appearance-tab-browser"]');
          if (!(strip instanceof HTMLElement) || !(tab instanceof HTMLElement)) return false;
          const stripRect = strip.getBoundingClientRect();
          const tabRect = tab.getBoundingClientRect();
          return strip.scrollLeft > 0 &&
            tabRect.left >= stripRect.left - 1 &&
            tabRect.right <= stripRect.right + 1;
        })()`),
      { timeout: 5_000 },
    )
    .toBe(true);

  await tauriPage.click('[role="combobox"][aria-label="Default search engine"]');
  for (const engine of ["google", "duckduckgo", "bing"]) {
    await expect(tauriPage.getByTestId(`search-engine-option-${engine}`)).toBeVisible();
    await expect(tauriPage.getByTestId(`search-engine-icon-${engine}`)).toBeVisible();
  }
  await tauriPage.press("body", "Escape");

  await selectAppearanceTab(tauriPage, "terminal");
  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Terminal font size"]',
    "18px",
  );
  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Terminal color theme"]',
    "Light",
  );
  await expect
    .poll(
      () =>
        tauriPage.evaluate<{ fontSize: number; theme: string }>(
          `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
            const state = useSettingsStore.getState();
            return { fontSize: state.terminalFontSize, theme: state.terminalColorTheme };
          })`,
        ),
      { timeout: 5_000 },
    )
    .toEqual({ fontSize: 18, theme: "light" });
  await expect(tauriPage.locator(TERMINAL)).toHaveAttribute(
    "data-terminal-font-size",
    "18",
  );
  await expect(tauriPage.locator(TERMINAL)).toHaveAttribute(
    "data-terminal-color-theme",
    "light",
  );
  const terminalBackground = await tauriPage.evaluate<string>(
    `getComputedStyle(document.querySelector(${JSON.stringify(TERMINAL)})).backgroundColor`,
  );
  expect(terminalBackground).toBe("rgb(255, 255, 255)");

  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Terminal font size"]',
    "14px",
  );
  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Terminal color theme"]',
    "Dark",
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.click(TERMINAL_TOGGLE);
  await expect(tauriPage.locator(TERMINAL)).not.toBeVisible();
  await expect(tauriPage.locator(BROWSER)).not.toBeVisible();
});

test.skip(
  "native browser page text and branding cannot be inspected through the app bridge",
  async () => {},
);
