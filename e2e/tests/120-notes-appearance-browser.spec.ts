import { existsSync } from "node:fs";
import { chromium, webkit, expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("notes-appearance-seeded")) {
      localStorage.clear();
      localStorage.setItem("oleafly.notes", "1");
      sessionStorage.setItem("notes-appearance-seeded", "1");
    }
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "get_ai_config") return { providers: [] };
          if (command === "system_integration_status") return { platform: "other", items: [] };
          if (command === "shell_command_status") return { state: "unsupported" };
          if (command === "tinytex_install_state") return { partial_download_bytes: 0 };
          if (command.startsWith("plugin:")) return 1;
          return [];
        },
      },
    });
  });
  await page.goto(
    `${process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420"}/e2e/notes-appearance-harness.html`,
    { timeout: 60_000 },
  );
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("appearance-tab-notes").click();
  await expect(page.getByTestId("settings-notes-preview")).toBeVisible();
}

function look(page: Page) {
  return page.getByTestId("settings-notes-preview-root").evaluate((root) => {
    const style = (selector: string) => getComputedStyle(root.querySelector(selector) as Element);
    const body = style(".ProseMirror");
    return {
      fontSize: body.fontSize,
      lineHeight: body.lineHeight,
      fontFamily: body.fontFamily,
      titleSize: style(".note-title").fontSize,
      headingSize: style("h2").fontSize,
      headingGap: style("h2").marginTop,
      paragraphGap: style("h2 + p").marginTop,
      calloutLeft: style(".note-callout").borderLeftWidth,
      calloutTop: style(".note-callout").borderTopWidth,
      codeBackground: style("pre").backgroundColor,
      keyword: style(".tok-keyword").color,
      highlight: style(".note-highlight").backgroundColor,
      accent: style(".note-body").getPropertyValue("--primary").trim(),
    };
  });
}

async function choose(page: Page, trigger: string, option: string) {
  await page.getByTestId(trigger).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

for (const browserType of [chromium, webkit]) {
  test(`${browserType.name()}: the Notes tab previews every change live and keeps Notes' own look by default`, async () => {
    // Ignored on purpose when that Playwright browser was never downloaded on this runner.
    test.skip(!existsSync(browserType.executablePath()), "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
      await setup(page);

      const before = await look(page);
      expect(before).toMatchObject({
        fontSize: "15px",
        lineHeight: "25.5px",
        titleSize: "24px",
        headingSize: "18.75px",
        headingGap: "18.75px",
        paragraphGap: "11.25px",
        calloutLeft: "1px",
        calloutTop: "1px",
      });

      await page.getByTestId("settings-notes-typeface-serif").click();
      await choose(page, "settings-notes-font-size-trigger", "18px");
      await choose(page, "settings-row-notes-paragraph-spacing-trigger", "Spacious");
      await choose(page, "settings-row-notes-title-size-trigger", "32px");
      await choose(page, "settings-row-notes-code-theme-trigger", "Dracula");
      await page.getByTestId("settings-notes-callout-bar").click();
      await page.getByTestId("settings-notes-highlight-green").click();
      await page.getByTestId("settings-notes-accent-rose").click();

      const after = await look(page);
      expect(after.fontFamily).toContain("ui-serif");
      expect(after).toMatchObject({
        fontSize: "18px",
        titleSize: "32px",
        paragraphGap: "27px",
        calloutLeft: "3px",
        calloutTop: "0px",
        codeBackground: "rgb(40, 42, 54)",
        accent: "#db2777",
      });
      expect(after.keyword).not.toBe(before.keyword);
      expect(after.highlight).not.toBe(before.highlight);
      expect(await page.evaluate(() => localStorage.getItem("oleafly.notes.fontSize"))).toBe("18");

      await page.getByTestId("settings-body").evaluate((body) => body.scrollTo({ top: body.scrollHeight }));
      const pinned = await page.evaluate(() => {
        const body = document.querySelector('[data-testid="settings-body"]') as HTMLElement;
        const preview = document.querySelector('[data-testid="settings-notes-preview"]') as HTMLElement;
        return Math.abs(preview.getBoundingClientRect().top - body.getBoundingClientRect().top);
      });
      expect(pinned).toBeLessThan(2);

      await page.getByTestId("settings-notes-reset-all").click();
      expect(await look(page)).toMatchObject({ fontSize: "15px", titleSize: "24px", codeBackground: before.codeBackground });
      await expect(page.getByTestId("settings-notes-reset-all")).toHaveCount(0);
    } finally {
      await browser.close();
    }
  });

  test(`${browserType.name()}: settings search opens the Notes tab at the row it found`, async () => {
    // Ignored on purpose when that Playwright browser was never downloaded on this runner.
    test.skip(!existsSync(browserType.executablePath()), "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
      await setup(page);
      await page.getByTestId("appearance-tab-app").click();
      await page.getByRole("searchbox", { name: "Search settings" }).fill("callout style");
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Callout style" }).click();
      await expect(page.getByTestId("appearance-tab-notes")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("settings-row-notes-callouts")).toHaveAttribute("data-settings-search-hit", "");
    } finally {
      await browser.close();
    }
  });
}
