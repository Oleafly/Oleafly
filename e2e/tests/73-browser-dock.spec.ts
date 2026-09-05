import { test, expect } from "../fixtures";
import { openProject, openSettings, type Page } from "../helpers";

const BROWSER = '[data-testid="dock-browser"]';
const TERMINAL = '[data-testid="dock-terminal"]';
const TERMINAL_TOGGLE = '[data-testid="rail-terminal-toggle"]';

async function selectAppearanceTab(
  page: Page,
  tab: "terminal" | "browser",
): Promise<void> {
  const selector = `[data-testid="appearance-tab-${tab}"]`;
  await page.waitForFunction(`!!document.querySelector(${JSON.stringify(selector)})`, 15_000);
  // Radix tab triggers activate on focus or keydown, never on a synthetic
  // click, so drive both on every poll tick until the tab reports active.
  await page.waitForFunction(
    `(() => {
      const tab = document.querySelector(${JSON.stringify(selector)});
      if (!(tab instanceof HTMLElement)) return false;
      if (tab.getAttribute("data-state") !== "active") {
        tab.focus();
        tab.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      }
      return tab.getAttribute("data-state") === "active";
    })()`,
    10_000,
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
    // The widened settings modal fits every tab at rest, so constrain the
    // strip to exercise the overflow, hidden-scrollbar, and auto-scroll
    // behavior this test exists to verify.
    strip.style.maxWidth = "320px";
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

  // Release the forced width so the remaining tab selections see every tab.
  await tauriPage.evaluate(`(() => {
    const strip = document.querySelector('[data-testid="appearance-tab-strip"]');
    if (strip instanceof HTMLElement) {
      strip.style.maxWidth = "";
      strip.scrollLeft = 0;
    }
    return true;
  })()`);

  await tauriPage.click('[role="combobox"][aria-label="Default search engine"]');
  for (const engine of ["google", "duckduckgo", "bing"]) {
    await expect(tauriPage.getByTestId(`search-engine-option-${engine}`)).toBeVisible();
    await expect(tauriPage.getByTestId(`search-engine-icon-${engine}`)).toBeVisible();
  }
  // Close the dropdown by selecting an option; Escape routing across the
  // stacked Radix select and dialog layers is not deterministic here.
  await tauriPage.click('[data-testid="search-engine-option-google"]');
  await expect(tauriPage.getByTestId("search-engine-option-google")).toHaveCount(0, {
    timeout: 5_000,
  });

  await selectAppearanceTab(tauriPage, "terminal");
  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Terminal font size"]',
    "18px",
  );
  await pickOption(
    tauriPage,
    '[role="combobox"][aria-label="Terminal color theme"]',
    "Light · light",
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
    "Dark · dark",
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
