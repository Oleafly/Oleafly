import { existsSync } from "node:fs";
import { chromium, webkit, expect, test, type Page } from "@playwright/test";

async function setup(page: Page, theme: "light" | "dark" = "light") {
  page.setDefaultTimeout(15_000);
  await page.addInitScript((theme) => {
    if (!sessionStorage.getItem("notes-appearance-seeded")) {
      localStorage.clear();
      localStorage.setItem("oleafly.notes", "1");
      localStorage.setItem("oleafly.theme", theme);
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
  }, theme);
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
    const sample = root.firstElementChild as HTMLElement;
    sample.style.zoom = "1";
    const style = (selector: string) => getComputedStyle(root.querySelector(selector) as Element);
    const body = style(".ProseMirror");
    const drawn = {
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
      taskBox: style(".note-task-box").borderRadius,
      accent: style(".note-body").getPropertyValue("--primary").trim(),
      fieldStyle: root.getAttribute("data-notes-field-style"),
    };
    sample.style.removeProperty("zoom");
    return drawn;
  });
}

function chips(page: Page) {
  return page.getByTestId("settings-notes-preview-root").evaluate((root) => {
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    const luminance = (...layers: string[]) => {
      context.clearRect(0, 0, 1, 1);
      for (const layer of layers) {
        context.fillStyle = layer;
        context.fillRect(0, 0, 1, 1);
      }
      const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return [...root.querySelectorAll<HTMLElement>(".note-field")].map((chip) => {
      const style = getComputedStyle(chip);
      const behind: string[] = [];
      for (let node = chip.parentElement; node && root.contains(node); node = node.parentElement) {
        behind.unshift(getComputedStyle(node).backgroundColor);
      }
      const [lighter, darker] = [luminance(style.color), luminance(...behind, style.backgroundColor)].sort((a, b) => b - a);
      return {
        state: `${chip.dataset.fieldKey}:${chip.dataset.when}`,
        filled: style.backgroundColor !== "rgba(0, 0, 0, 0)",
        bordered: style.borderTopColor !== "rgba(0, 0, 0, 0)",
        underline: `${style.textDecorationLine} ${style.textDecorationStyle}`,
        contrast: (lighter + 0.05) / (darker + 0.05),
      };
    });
  });
}

function inlineChipOverflow(page: Page) {
  return page.getByTestId("settings-notes-preview-root").evaluate((root) => {
    const overflow: number[] = [];
    for (const family of ["inherit", '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif']) {
      for (const size of ["text-xs", "text-sm"]) {
        const line = document.createElement("span");
        line.className = `-my-0.5 block truncate py-0.5 ${size}`;
        line.style.fontFamily = family;
        line.innerHTML =
          'Ag <span class="note-field note-field-inline" data-kind="date" data-field-key="due" data-when="past"><span class="note-field-value">Nov 16</span></span>';
        root.append(line);
        const outer = line.getBoundingClientRect();
        const chip = (line.firstElementChild as HTMLElement).getBoundingClientRect();
        overflow.push(outer.top - chip.top, chip.bottom - outer.bottom);
        line.remove();
      }
    }
    return Math.max(...overflow);
  });
}

async function choose(page: Page, trigger: string, option: string) {
  await page.getByTestId(trigger).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

const SETTINGS = '[role="dialog"][aria-label="Settings"]';
const NARROW_SETTINGS = 1040;
const WIDE_SETTINGS = Math.min(1380, 1440 * 0.94);

function settingsWidth(page: Page) {
  return page.locator(SETTINGS).evaluate((dialog) => dialog.getBoundingClientRect().width);
}

function settingsTransition(page: Page) {
  return page.locator(SETTINGS).evaluate((dialog) => {
    const style = getComputedStyle(dialog);
    return { property: style.transitionProperty, duration: style.transitionDuration, easing: style.transitionTimingFunction };
  });
}

function widthFrames(page: Page, ms: number) {
  return page.evaluate(
    ({ selector, ms }) =>
      new Promise<{ width: number; sidebarOffset: number; sidebarWidth: number; headerHeight: number }[]>((resolve) => {
        const dialog = document.querySelector(selector) as HTMLElement;
        const sidebar = dialog.querySelector('nav[aria-label="Settings sections"]') as HTMLElement;
        const header = (dialog.querySelector('[data-testid="settings-close"]') as HTMLElement).parentElement as HTMLElement;
        const frames: { width: number; sidebarOffset: number; sidebarWidth: number; headerHeight: number }[] = [];
        const start = performance.now();
        const sample = () => {
          const box = dialog.getBoundingClientRect();
          const side = sidebar.getBoundingClientRect();
          frames.push({
            width: box.width,
            sidebarOffset: side.left - box.left,
            sidebarWidth: side.width,
            headerHeight: header.getBoundingClientRect().height,
          });
          if (performance.now() - start < ms) requestAnimationFrame(sample);
          else resolve(frames);
        };
        requestAnimationFrame(sample);
      }),
    { selector: SETTINGS, ms },
  );
}

function columns(page: Page) {
  return page.evaluate(() => {
    const box = (id: string) => (document.querySelector(`[data-testid="${id}"]`) as HTMLElement).getBoundingClientRect();
    const preview = box("settings-notes-preview");
    const options = box("settings-appearance-notes-options");
    return {
      preview: { x: preview.x, y: preview.y, width: preview.width },
      options: { x: options.x, width: options.width },
      previewBottom: preview.bottom,
      optionsTop: options.top,
    };
  });
}

function expectEased(widths: readonly number[], from: number, to: number) {
  expect(widths.at(-1)).toBeCloseTo(to, 0);
  const low = Math.min(from, to) + 1;
  const high = Math.max(from, to) - 1;
  expect(widths.some((width) => width > low && width < high)).toBe(true);
  for (let index = 1; index < widths.length; index++) {
    expect(Math.sign(to - from) * (widths[index] - widths[index - 1])).toBeGreaterThanOrEqual(-0.5);
  }
}

test("adds, removes and turns off text replacement pairs in the Notes tab", async ({ page }) => {
  await setup(page);
  const pairs = page.getByTestId("settings-notes-replacements");
  const list = pairs.getByRole("list", { name: "Text replacements" });
  await expect(list.getByRole("listitem")).toHaveCount(9);
  await pairs.getByRole("textbox", { name: "Type", exact: true }).fill("(c)");
  await pairs.getByRole("textbox", { name: "Becomes" }).fill("©");
  await pairs.getByRole("button", { name: "Add", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(10);
  await pairs.getByRole("button", { name: "Remove ->" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(9);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("oleafly.notes.textReplacements") ?? "{}"))).toMatchObject({ "(c)": "©" });
  await page.getByRole("switch", { name: "Replace as you type" }).click();
  await expect(pairs).toHaveCount(0);
});

for (const browserType of [chromium, webkit]) {
  test(`${browserType.name()}: the Notes tab previews every change live and keeps Notes' own look by default`, async () => {
    const installed = existsSync(browserType.executablePath());
    if (!installed && process.env.CI && browserType.name() !== "webkit") {
      throw new Error(`${browserType.name()} is not installed for Playwright on this CI runner`);
    }
    // WebKit is skipped on purpose until CI installs it next to Chromium.
    test.skip(!installed, "Browser executable is not installed");
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
        taskBox: "9999px",
        fieldStyle: null,
      });

      await page.getByTestId("settings-notes-typeface-serif").click();
      await choose(page, "settings-notes-font-size-trigger", "18px");
      await choose(page, "settings-row-notes-paragraph-spacing-trigger", "Spacious");
      await choose(page, "settings-row-notes-title-size-trigger", "32px");
      await choose(page, "settings-row-notes-code-theme-trigger", "Dracula");
      await page.getByTestId("settings-notes-callout-bar").click();
      await page.getByTestId("settings-notes-task-box-square").click();
      await page.getByTestId("settings-notes-field-style-outline").click();
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
        taskBox: "4px",
        fieldStyle: "outline",
      });
      expect(after.keyword).not.toBe(before.keyword);
      await expect(page.getByTestId("settings-row-notes-highlight")).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("oleafly.notes.fontSize"))).toBe("18");

      await expect(page.getByTestId("settings-appearance-notes")).toHaveAttribute("data-layout", "beside");
      const placement = (where: "middle" | "end") =>
        page.getByTestId("settings-body").evaluate((body, where) => {
          body.scrollTo({ top: where === "end" ? body.scrollHeight : body.scrollHeight / 2 });
          const preview = (document.querySelector('[data-testid="settings-notes-preview"]') as HTMLElement).getBoundingClientRect();
          const frame = body.getBoundingClientRect();
          const inset = Number.parseFloat(getComputedStyle(body).paddingTop);
          return { offset: preview.top - frame.top - inset, top: preview.top - frame.top, below: frame.bottom - preview.bottom };
        }, where);
      const middle = await placement("middle");
      expect(Math.abs(middle.offset)).toBeLessThan(2);
      expect(middle.below).toBeGreaterThanOrEqual(0);
      const end = await placement("end");
      expect(end.top).toBeGreaterThanOrEqual(0);
      expect(end.below).toBeGreaterThanOrEqual(0);

      await expect(page.getByTestId("settings-notes-preview").getByRole("button")).toHaveCount(0);
      await page.getByRole("button", { name: "Reset to defaults" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Reset to defaults" }).click();
      expect(await look(page)).toMatchObject({
        fontSize: "15px",
        titleSize: "24px",
        codeBackground: before.codeBackground,
        taskBox: "9999px",
        fieldStyle: null,
      });
    } finally {
      await browser.close();
    }
  });

  test(`${browserType.name()}: draws date chips as a tint, an outline or a dotted underline that read in light and dark and fit a snippet line`, async () => {
    const installed = existsSync(browserType.executablePath());
    if (!installed && process.env.CI && browserType.name() !== "webkit") {
      throw new Error(`${browserType.name()} is not installed for Playwright on this CI runner`);
    }
    // WebKit is skipped on purpose until CI installs it next to Chromium.
    test.skip(!installed, "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      for (const theme of ["light", "dark"] as const) {
        const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
        await setup(page, theme);
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`, "u"));
        const looks = {
          tint: { filled: true, bordered: false, underline: "none solid" },
          outline: { filled: false, bordered: true, underline: "none solid" },
          underline: { filled: false, bordered: false, underline: "underline dotted" },
        };
        for (const [style, look] of Object.entries(looks)) {
          await page.getByTestId(`settings-notes-field-style-${style}`).click();
          await expect(page.getByTestId(`settings-notes-field-style-${style}`)).toHaveAttribute("aria-pressed", "true");
          const drawn = await chips(page);
          expect(drawn.map((chip) => chip.state), `${theme} ${style}`).toEqual(["date:future", "due:today", "due:past"]);
          for (const chip of drawn) {
            expect(chip, `${theme} ${style} ${chip.state}`).toMatchObject(look);
            expect(chip.contrast, `${theme} ${style} ${chip.state} contrast`).toBeGreaterThanOrEqual(4.5);
          }
          expect(await inlineChipOverflow(page), `${theme} ${style} snippet chip`).toBeLessThanOrEqual(0.01);
        }
        expect(await page.evaluate(() => localStorage.getItem("oleafly.notes.fieldStyle"))).toBe("underline");
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });

  test(`${browserType.name()}: widens Settings for a preview beside the options and keeps the preview still while options change`, async () => {
    const installed = existsSync(browserType.executablePath());
    if (!installed && process.env.CI && browserType.name() !== "webkit") {
      throw new Error(`${browserType.name()} is not installed for Playwright on this CI runner`);
    }
    // WebKit is skipped on purpose until CI installs it next to Chromium.
    test.skip(!installed, "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
      await setup(page);
      await expect(page.getByTestId("settings-appearance-notes")).toHaveAttribute("data-layout", "beside");
      await expect.poll(() => settingsWidth(page)).toBeCloseTo(WIDE_SETTINGS, 0);
      expect(await settingsTransition(page)).toEqual({ property: "width", duration: "0.2s", easing: "cubic-bezier(0, 0, 0.2, 1)" });

      await page.getByTestId("appearance-tab-app").click();
      await expect.poll(() => settingsWidth(page)).toBeCloseTo(NARROW_SETTINGS, 0);
      const widening = widthFrames(page, 600);
      await page.getByTestId("appearance-tab-notes").click();
      const frames = await widening;
      expectEased(frames.map((frame) => frame.width), NARROW_SETTINGS, WIDE_SETTINGS);
      for (const frame of frames) {
        expect(frame).toMatchObject({
          sidebarOffset: frames[0].sidebarOffset,
          sidebarWidth: frames[0].sidebarWidth,
          headerHeight: frames[0].headerHeight,
        });
      }

      const start = await columns(page);
      expect(start.preview.width).toBeGreaterThanOrEqual(300);
      expect(start.preview.width).toBeLessThanOrEqual(360);
      expect(start.preview.x).toBeGreaterThan(start.options.x + start.options.width);
      expect(await page.getByTestId("settings-notes-preview-root").evaluate((root) => root.scrollHeight - root.clientHeight)).toBeLessThanOrEqual(1);
      await page.getByTestId("settings-body").evaluate((body) => body.scrollTo({ top: 240 }));
      const before = await columns(page);
      await page.getByTestId("settings-notes-typeface-serif").click();
      await choose(page, "settings-notes-font-size-trigger", "18px");
      await choose(page, "settings-row-notes-paragraph-spacing-trigger", "Spacious");
      await choose(page, "settings-row-notes-title-size-trigger", "32px");
      await page.getByTestId("settings-notes-callout-bar").click();
      await page.getByTestId("settings-notes-field-style-outline").click();
      expect(await look(page)).toMatchObject({ fontSize: "18px", titleSize: "32px", calloutLeft: "3px", fieldStyle: "outline" });
      const after = await columns(page);
      expect(after.preview).toEqual(before.preview);
      expect(after.options).toEqual(before.options);

      const narrowing = widthFrames(page, 600);
      await page.getByTestId("appearance-tab-app").click();
      expectEased((await narrowing).map((frame) => frame.width), WIDE_SETTINGS, NARROW_SETTINGS);
      await page.getByTestId("appearance-tab-notes").click();
      await expect.poll(() => settingsWidth(page)).toBeCloseTo(WIDE_SETTINGS, 0);
      await page.getByTestId("settings-section-general").click();
      await expect.poll(() => settingsWidth(page)).toBeCloseTo(NARROW_SETTINGS, 0);

      await page.getByTestId("settings-section-appearance").click();
      await page.getByTestId("appearance-tab-notes").click();
      await expect.poll(() => settingsWidth(page)).toBeCloseTo(WIDE_SETTINGS, 0);
      await page.getByTestId("settings-close").click();
      await expect(page.locator(SETTINGS)).toHaveCount(0);
      const reopened = await page.evaluate(
        (selector) =>
          new Promise<number[]>((resolve) => {
            const store = (window as unknown as { __settings: { getState(): { openSettingsAt(section: string, tab: string): void } } }).__settings;
            store.getState().openSettingsAt("appearance", "notes");
            const widths: number[] = [];
            const start = performance.now();
            const sample = () => {
              const dialog = document.querySelector(selector);
              if (dialog) widths.push(dialog.getBoundingClientRect().width);
              if (performance.now() - start < 400) requestAnimationFrame(sample);
              else resolve(widths);
            };
            requestAnimationFrame(sample);
          }),
        SETTINGS,
      );
      expect(reopened.length).toBeGreaterThan(0);
      for (const width of reopened) expect(width).toBeCloseTo(WIDE_SETTINGS, 0);
    } finally {
      await browser.close();
    }
  });

  test(`${browserType.name()}: changes the Settings width at once under reduced motion and keeps one column in a narrow window`, async () => {
    const installed = existsSync(browserType.executablePath());
    if (!installed && process.env.CI && browserType.name() !== "webkit") {
      throw new Error(`${browserType.name()} is not installed for Playwright on this CI runner`);
    }
    // WebKit is skipped on purpose until CI installs it next to Chromium.
    test.skip(!installed, "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const still = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" });
      await setup(still);
      await still.getByTestId("appearance-tab-app").click();
      await expect.poll(() => settingsWidth(still)).toBeCloseTo(NARROW_SETTINGS, 0);
      const jump = widthFrames(still, 400);
      await still.getByTestId("appearance-tab-notes").click();
      const widths = (await jump).map((frame) => frame.width);
      expect(widths.filter((width) => width > NARROW_SETTINGS + 1 && width < WIDE_SETTINGS - 1)).toEqual([]);
      expect(widths.at(-1)).toBeCloseTo(WIDE_SETTINGS, 0);
      expect((await settingsTransition(still)).property).toBe("none");
      await still.close();

      const small = await browser.newPage({ viewport: { width: 1100, height: 850 } });
      await setup(small);
      await expect(small.getByTestId("settings-appearance-notes")).toHaveAttribute("data-layout", "stacked");
      const fallback = await columns(small);
      expect(fallback.previewBottom).toBeLessThanOrEqual(fallback.optionsTop);
      expect(fallback.preview.width).toBeCloseTo(fallback.options.width + 8, 0);
      const onNotes = await settingsWidth(small);
      expect(onNotes).toBeCloseTo(1100 * 0.94, 0);
      expect((await settingsTransition(small)).duration).toBe("0s");
      await small.getByTestId("appearance-tab-app").click();
      expect(await settingsWidth(small)).toBe(onNotes);
    } finally {
      await browser.close();
    }
  });

  test(`${browserType.name()}: settings search opens the Notes tab at the row it found`, async () => {
    const installed = existsSync(browserType.executablePath());
    if (!installed && process.env.CI && browserType.name() !== "webkit") {
      throw new Error(`${browserType.name()} is not installed for Playwright on this CI runner`);
    }
    // WebKit is skipped on purpose until CI installs it next to Chromium.
    test.skip(!installed, "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
      await setup(page);
      await page.getByTestId("appearance-tab-app").click();
      await page.getByRole("searchbox", { name: "Search settings" }).fill("callout style");
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Callout style" }).click();
      await expect(page.getByTestId("appearance-tab-notes")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("settings-row-notes-callouts")).toHaveAttribute("data-settings-search-hit", "");
      await page.getByTestId("appearance-tab-app").click();
      await page.getByRole("searchbox", { name: "Search settings" }).fill("field chips");
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Date and field chips" }).click();
      await expect(page.getByTestId("appearance-tab-notes")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("settings-row-notes-field-style")).toHaveAttribute("data-settings-search-hit", "");
    } finally {
      await browser.close();
    }
  });

  test(`${browserType.name()}: saves a TikZ preamble for every drawing block and finds it in search`, async () => {
    const installed = existsSync(browserType.executablePath());
    if (!installed && process.env.CI && browserType.name() !== "webkit") {
      throw new Error(`${browserType.name()} is not installed for Playwright on this CI runner`);
    }
    // WebKit is skipped on purpose until CI installs it next to Chromium.
    test.skip(!installed, "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
      await setup(page);
      await page.getByLabel("TikZ preamble", { exact: true }).fill(String.raw`\usetikzlibrary{calc}`);
      await expect.poll(() => page.evaluate(() => localStorage.getItem("oleafly.notes.tikzPreamble"))).toBe(String.raw`\usetikzlibrary{calc}`);
      await page.getByTestId("appearance-tab-app").click();
      await page.getByRole("searchbox", { name: "Search settings" }).fill("tikz preamble");
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "TikZ preamble" }).click();
      await expect(page.getByTestId("settings-row-notes-tikz-preamble")).toHaveAttribute("data-settings-search-hit", "");
      await expect(page.getByLabel("TikZ preamble", { exact: true })).toHaveValue(String.raw`\usetikzlibrary{calc}`);
    } finally {
      await browser.close();
    }
  });
}
