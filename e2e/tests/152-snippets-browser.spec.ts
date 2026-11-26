import { existsSync } from "node:fs";
import { type Browser, expect, type Page, test, webkit } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

type Snapshot = { doc: string; head: number; ghost: string | null; chip: string | null; aiRequests: number; expanded: string[] };
type Options = { fastMath: boolean; ai: string | null };
type Harness = { mount(doc: string, caret: number, options: Options): Promise<void>; snapshot(): Snapshot };

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/e2e/snippets-harness.html`);
  await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  return errors;
}

async function mount(page: Page, marked: string, options: Partial<Options> = {}): Promise<void> {
  const caret = marked.indexOf("|");
  const doc = marked.slice(0, caret) + marked.slice(caret + 1);
  await page.evaluate(
    ([text, at, chosen]) =>
      (window as unknown as { __snippets: Harness }).__snippets.mount(text as string, at as number, chosen as Options),
    [doc, caret, { fastMath: false, ai: null, ...options }] as const,
  );
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as { __snippets: Harness }).__snippets.snapshot());
}

async function marked(page: Page): Promise<string> {
  const { doc, head } = await snapshot(page);
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

async function typeKeys(page: Page, text: string): Promise<void> {
  for (const character of text) await page.keyboard.type(character);
}

async function hintsAndTab(page: Page): Promise<string[]> {
  const errors = await open(page);

  await mount(page, "|");
  await typeKeys(page, "fi");
  await expect.poll(async () => (await snapshot(page)).chip).toBe("⇥ Figure");
  expect((await snapshot(page)).ghost).toBe("g");
  await page.keyboard.press("Tab");
  const inserted = await snapshot(page);
  expect(inserted.doc).toMatch(/^\\begin\{figure\}\[htbp\]\n[ \t]+\\centering/u);
  expect(inserted.doc.endsWith("\\end{figure}")).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await marked(page)).toBe("fi|");

  await mount(page, "|");
  await typeKeys(page, "remark in England, cc and sum");
  expect(await marked(page)).toBe("remark in England, cc and sum|");
  return errors;
}

async function fastMath(page: Page): Promise<string[]> {
  const errors = await open(page);

  await mount(page, "$|$", { fastMath: true });
  await typeKeys(page, "//");
  expect(await marked(page)).toBe("$\\frac{|}{}$");
  await page.keyboard.press("Backspace");
  expect(await marked(page)).toBe("$//|$");

  await mount(page, "$|$", { fastMath: true });
  await typeKeys(page, "x1 + a//b");
  expect((await snapshot(page)).doc).toContain("x_1");

  await mount(page, "The loss is | here.", { fastMath: true });
  await typeKeys(page, "remark");
  expect(await marked(page)).toBe("The loss is remark| here.");

  await mount(page, "\\begin{equation}\n  \\label{eq:|}\n\\end{equation}", { fastMath: true });
  await typeKeys(page, "sum");
  expect(await marked(page)).toBe("\\begin{equation}\n  \\label{eq:sum|}\n\\end{equation}");
  return errors;
}

async function snippetsBeatAi(page: Page): Promise<string[]> {
  const errors = await open(page);

  await mount(page, "Each node samples|", { ai: " temperature every minute." });
  await typeKeys(page, " ");
  await expect.poll(async () => (await snapshot(page)).ghost).toBe("temperature every minute.");

  await mount(page, "|", { ai: "gure out the thresholds." });
  await typeKeys(page, "fig");
  await expect.poll(async () => (await snapshot(page)).chip).toBe("⇥ Figure");
  const shown = await snapshot(page);
  await page.waitForTimeout(300);
  const blocked = await snapshot(page);
  expect(blocked.chip).toBe("⇥ Figure");
  expect(blocked.ghost).toBeNull();
  expect(blocked.aiRequests).toBe(shown.aiRequests);
  await page.keyboard.press("Tab");
  expect((await snapshot(page)).doc.startsWith("\\begin{figure}")).toBe(true);
  return errors;
}

test.describe("snippets in Chromium", () => {
  test("hints name the snippet Tab inserts, and prose never expands", async ({ page }) => {
    expect(await hintsAndTab(page)).toEqual([]);
  });

  test("Fast math expands only in math, and Backspace gives the trigger back", async ({ page }) => {
    expect(await fastMath(page)).toEqual([]);
  });

  test("a snippet hint keeps the AI from asking and wins the Tab key", async ({ page }) => {
    expect(await snippetsBeatAi(page)).toEqual([]);
  });
});

test.describe("snippets in WebKit", () => {
  // WebKit is skipped on purpose until CI installs it next to Chromium.
  test.skip(!existsSync(webkit.executablePath()), "WebKit is not installed for Playwright on this machine");

  let browser: Browser;
  test.beforeAll(async () => {
    browser = await webkit.launch();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  async function inWebKit(run: (page: Page) => Promise<string[]>): Promise<string[]> {
    const page = await browser.newPage();
    try {
      return await run(page);
    } finally {
      await page.close();
    }
  }

  test("hints name the snippet Tab inserts, and prose never expands", async () => {
    expect(await inWebKit(hintsAndTab)).toEqual([]);
  });

  test("Fast math expands only in math, and Backspace gives the trigger back", async () => {
    expect(await inWebKit(fastMath)).toEqual([]);
  });

  test("a snippet hint keeps the AI from asking and wins the Tab key", async () => {
    expect(await inWebKit(snippetsBeatAi)).toEqual([]);
  });
});
