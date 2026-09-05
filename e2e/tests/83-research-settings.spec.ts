import { expect, reloadNativePage, test } from "../fixtures";
import { openSettings, type Page } from "../helpers";

const THEME_STORAGE_KEY = "oleafly.theme-customization.v1";

async function fullMouseEvent(page: Page, selector: string) {
  await page.evaluate(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error("appearance tab is unavailable");
      for (const type of ["mousedown", "mouseup", "click"]) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    })()`,
  );
}

async function openAppAppearance(page: Page) {
  await openSettings(page, "appearance");
  const selector = '[data-testid="appearance-tab-app"]';
  await fullMouseEvent(page, selector);
  await page.waitForFunction(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("data-state") === "active"`,
    5_000,
  );
}

async function importTheme(page: Page, contents: string) {
  await page.evaluate(
    `(() => {
      const input = document.querySelector('input[aria-label="Import theme file"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("theme import input is unavailable");
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([${JSON.stringify(contents)}], "research-theme.json", { type: "application/json" }));
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
}

test("theme customization imports, exports, applies, and resets theme tokens", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  const originalState = await tauriPage.evaluate<{ customization: string | null; preference: string | null }>(
    `({ customization: localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}), preference: localStorage.getItem("oleafly.theme") })`,
  );
  let exportInterceptionInstalled = false;
  let testFailed = false;
  try {
    await openAppAppearance(tauriPage);
    await tauriPage.click('[data-testid="settings-appearance-dark"]');
    await tauriPage.waitForFunction(
      `document.documentElement.classList.contains("dark")`,
      5_000,
    );
    await tauriPage.getByText("Dark mode", { exact: true }).click();
    await tauriPage.waitForFunction(
      `Array.from(document.querySelectorAll('[aria-label="Theme mode to edit"] button')).some((button) => button.textContent.trim() === "Dark mode" && button.getAttribute("aria-pressed") === "true")`,
      5_000,
    );
    await tauriPage.getByText("Reset all", { exact: true }).click();
    await tauriPage.waitForFunction(
      `localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) === null`,
      5_000,
    );

    await importTheme(
      tauriPage,
      JSON.stringify({
        $schema: "https://ui.shadcn.com/schema/registry-theme.json",
        name: "research-workspace",
        cssVars: {
          light: { primary: "#2463eb" },
          dark: { primary: "#6ea8ff" },
        },
        radius: "14px",
        oleafly: { version: 1, customCss: null },
      }),
    );
    await tauriPage.waitForFunction(
      `document.documentElement.style.getPropertyValue("--primary") === "#6ea8ff"
        && document.documentElement.style.getPropertyValue("--radius") === "14px"`,
      10_000,
    );
    await tauriPage.fill('input[aria-label="Primary token for dark mode"]', "#8cc4ff");
    await tauriPage.fill('input[aria-label="Corner radius"]', "18px");
    await tauriPage.press('input[aria-label="Corner radius"]', "Tab");
    await tauriPage.waitForFunction(
      `document.documentElement.style.getPropertyValue("--primary") === "#8cc4ff"
        && document.documentElement.style.getPropertyValue("--radius") === "18px"`,
      10_000,
    );

    await tauriPage.evaluate(
      `(() => {
        window.__themeExportBlobs = [];
        window.__themeExportCreateObjectUrl = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
          window.__themeExportBlobs.push(blob);
          return window.__themeExportCreateObjectUrl.call(URL, blob);
        };
        return true;
      })()`,
    );
    exportInterceptionInstalled = true;
    await tauriPage.getByText("Export theme", { exact: true }).click();
    const exported = await tauriPage.evaluate<string>(
      `window.__themeExportBlobs.at(-1).text()`,
    );
    expect(JSON.parse(exported)).toMatchObject({
      cssVars: { dark: { primary: "#8cc4ff" } },
      radius: "18px",
    });

    await tauriPage.getByText("Reset all", { exact: true }).click();
    await tauriPage.waitForFunction(
      `localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) === null
        && document.documentElement.style.getPropertyValue("--primary") === ""
        && document.documentElement.style.getPropertyValue("--radius") === ""`,
      10_000,
    );
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    let cleanupError: unknown = null;
    try {
      if (exportInterceptionInstalled) {
        await tauriPage.evaluate(
          `(() => {
            URL.createObjectURL = window.__themeExportCreateObjectUrl;
            delete window.__themeExportCreateObjectUrl;
            delete window.__themeExportBlobs;
            return true;
          })()`,
        );
      }
      await tauriPage.evaluate(
        `(() => {
          const customization = ${JSON.stringify(originalState.customization)};
          const preference = ${JSON.stringify(originalState.preference)};
          if (customization === null) localStorage.removeItem(${JSON.stringify(THEME_STORAGE_KEY)});
          else localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, customization);
          if (preference === null) localStorage.removeItem("oleafly.theme");
          else localStorage.setItem("oleafly.theme", preference);
          return true;
        })()`,
      );
      await reloadNativePage(tauriPage);
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError && !testFailed) throw cleanupError;
  }
});
