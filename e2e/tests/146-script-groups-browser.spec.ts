import { existsSync } from "node:fs";
import { type Browser, expect, type Page, test, webkit } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

type Engine = "latex" | "typst";
type Snapshot = { doc: string; head: number };
type Harness = {
  mount(engine: Engine, doc: string, caret: number): void;
  snapshot(): Snapshot;
};

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/e2e/script-groups-harness.html`);
  await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  return errors;
}

async function mount(page: Page, engine: Engine, marked: string): Promise<void> {
  const caret = marked.indexOf("|");
  const doc = marked.slice(0, caret) + marked.slice(caret + 1);
  await page.evaluate(
    ([kind, text, at]) =>
      (window as unknown as { __scriptGroups: Harness }).__scriptGroups.mount(kind as Engine, text as string, at as number),
    [engine, doc, caret] as const,
  );
}

async function marked(page: Page): Promise<string> {
  const { doc, head } = await page.evaluate(() =>
    (window as unknown as { __scriptGroups: Harness }).__scriptGroups.snapshot(),
  );
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

async function typeKeys(page: Page, text: string): Promise<void> {
  for (const character of text) await page.keyboard.type(character);
}

async function scriptsGroupAsTyped(page: Page): Promise<void> {
  const errors = await open(page);

  await mount(page, "latex", "|");
  await typeKeys(page, "$x^10 + y_ij = e^-x$ done");
  expect(await marked(page)).toBe("$x^{10} + y_{ij} = e^{-x}$ done|");

  await mount(page, "latex", "$|$");
  await typeKeys(page, "x_iy_i + X^TX + x^2y + \\sum_{i=1}^nx_i");
  expect(await marked(page)).toBe("$x_iy_i + X^TX + x^2y + \\sum_{i=1}^nx_i|$");

  await mount(page, "latex", "\\begin{equation}\n  |\n\\end{equation}");
  await typeKeys(page, "\\label{eq_ab} \\text{a_bc} x_ab}");
  expect(await marked(page)).toBe("\\begin{equation}\n  \\label{eq_ab} \\text{a_bc} x_{ab}|\n\\end{equation}");

  await mount(page, "typst", "$|$");
  await typeKeys(page, "x^-1 + e^-pi + x^10");
  expect(await marked(page)).toBe("$x^(-1) + e^(-pi) + x^10|$");

  expect(errors).toEqual([]);
}

async function keysShapeTheGroup(page: Page): Promise<void> {
  await open(page);

  await mount(page, "latex", "$|$");
  await typeKeys(page, "x^ab");
  await page.keyboard.press("Backspace");
  expect(await marked(page)).toBe("$x^a|$");
  await typeKeys(page, "c");
  expect(await marked(page)).toBe("$x^{ac|}$");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await marked(page)).toBe("$x^ac|$");

  await mount(page, "latex", "\\[\n  |\n\\]");
  await typeKeys(page, "x^ab");
  await page.keyboard.press("Enter");
  await typeKeys(page, "y");
  expect(await marked(page)).toBe("\\[\n  x^{ab}\n  y|\n\\]");
}

test.describe("subscript and superscript groups in Chromium", () => {
  test("groups multi-character scripts as they are typed", async ({ page }) => {
    await scriptsGroupAsTyped(page);
  });

  test("Backspace, undo and Enter shape the group", async ({ page }) => {
    await keysShapeTheGroup(page);
  });
});

test.describe("subscript and superscript groups in WebKit", () => {
  test.skip(!existsSync(webkit.executablePath()), "WebKit is not installed for Playwright on this machine");

  let browser: Browser;
  test.beforeAll(async () => {
    browser = await webkit.launch();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  async function inWebKit(run: (page: Page) => Promise<void>): Promise<void> {
    const page = await browser.newPage();
    try {
      await run(page);
    } finally {
      await page.close();
    }
  }

  test("groups multi-character scripts as they are typed", async () => {
    await inWebKit(scriptsGroupAsTyped);
  });

  test("Backspace, undo and Enter shape the group", async () => {
    await inWebKit(keysShapeTheGroup);
  });
});
