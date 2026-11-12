import { existsSync } from "node:fs";
import { type Browser, expect, type Page, test, webkit } from "@playwright/test";
import { NotesPage } from "../notes-page";

const SHOTS = process.env.NOTES_SELECT_ALL_SHOTS ?? "";
const FENCE = "```";
const MASKING_ID = "8d3f2a61-4b7c-4e9d-a1f0-5c6b7d8e9f01";
const DATALOADER_ID = "4e6a8c02-3d5f-4a7b-b9c1-2e3f4a5b6c04";

const BODY = `## Every block

A paragraph with **bold**, ==a highlight==, #results and a link to the [Masking strategy report](oleafly://note/${MASKING_ID}). Inline math $a^2 + b^2 = c^2$ sits here.

> [!note] Callout title
> Callout body line.

> [!warning]- Folded callout
> Folded body line.

- [ ] Open task
- [x] Done task

1. First step
2. Second step

![Masking strategy report](oleafly://note/${MASKING_ID})

![Throughput before and after the rewrite](assets/throughput.svg)

---

${FENCE}python
print("plain code")
${FENCE}

${FENCE}mermaid
flowchart LR
  A --> B
${FENCE}

${FENCE}chart
{"title": "Runs", "categories": ["A", "B"], "series": [{"name": "Score", "values": [1, 2]}]}
${FENCE}

${FENCE}plot
y = sin(x)
${FENCE}

${FENCE}csv
sample,value
A1,61.2
A2,68.9
${FENCE}

${FENCE}{=latex}
E = mc^2
${FENCE}

${FENCE}{=typst}
$ E = m c^2 $
${FENCE}

${FENCE}svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><text x="2" y="14">AB</text></svg>
${FENCE}

${FENCE}html
<p>Hello from html</p>
${FENCE}

${FENCE}jsx
export default function Hello() { return <p>Hello from jsx</p>; }
${FENCE}

${FENCE}smiles
Ethanol: CCO
${FENCE}

${FENCE}molecule
format: xyz
3
water
O 0 0 0
H 0.76 0.59 0
H -0.76 0.59 0
${FENCE}

${FENCE}sequence
>example
ATGGCCATTGTAATG
${FENCE}

${FENCE}notebook
assets/missing.ipynb
${FENCE}

| Trial | Score |
| --- | --- |
| 1 | 61.2 |

Last paragraph.
`;

const NOTE = `---
title: "Dataloader rewrite: what changed"
agent: Codex
kind: note
id: ${DATALOADER_ID}
status: draft
---

${BODY}`;

const CHROME = [
  ".note-drawn-label",
  ".note-drawn-toggle",
  ".note-code-copy",
  ".note-callout-chrome",
  ".note-callout-chrome button",
  ".note-task-handle input",
  ".note-embed-head",
];
const WHOLE = '.note-drawn, .note-embed, .note-image, [data-type="math-inline"]';
const BUTTON_WORDS = ["Source", "Preview", "Run", "Copy", "Show data", "Filter rows", "2 rows"];

interface SelectionReport {
  ranges: number;
  outsideEditor: boolean;
  painted: string[];
  paintedChrome: string[];
  paintedOutside: string[];
  whole: number;
  tinted: number;
  stray: boolean;
}

interface Copied {
  text: string;
  html: string;
}

async function open(page: Page): Promise<string[]> {
  const notes = new NotesPage(page);
  await notes.placeInfo("inline");
  return (await notes.open()).errors;
}

function editor(page: Page) {
  return page.locator('.ProseMirror[contenteditable="true"]:visible');
}

async function openEveryBlock(page: Page): Promise<void> {
  await page.evaluate((text) => {
    (window as unknown as { __notes: { writeFromDisk(id: string, text: string): void } }).__notes.writeFromDisk("dataloader", text);
  }, NOTE);
  await page.locator("aside").getByRole("button", { name: /Dataloader rewrite/ }).first().click();
  await expect(page.locator('input[aria-label="Note title"]:visible')).toHaveValue("Dataloader rewrite: what changed");
  const body = editor(page);
  await expect(body.locator('.note-drawn[data-block="mermaid"] .note-drawn-preview svg').first()).toBeVisible();
  await expect(body.locator(".note-embed-content")).toBeVisible();
  for (const [block, drawing] of [["chart", ".note-chart"], ["csv", "table"]]) {
    const drawn = body.locator(`:scope > .note-drawn[data-block="${block}"]`);
    await drawn.scrollIntoViewIfNeeded();
    await expect(drawn.locator(drawing)).toBeVisible();
  }
  await expect(body.locator(":scope > .note-image img")).toBeVisible();
}

function inspectSelection(page: Page): Promise<SelectionReport> {
  return page.evaluate(
    ({ chrome, whole }) => {
      const root = [...document.querySelectorAll<HTMLElement>('.ProseMirror[contenteditable="true"]')].find(
        (element) => element.getClientRects().length > 0,
      );
      if (!root) throw new Error("no editor");
      const used = (element: Element | null) => {
        for (let at = element; at; at = at.parentElement) {
          const style = getComputedStyle(at);
          const value = style.userSelect || (style as unknown as { webkitUserSelect: string }).webkitUserSelect;
          if (value && value !== "auto") return value;
        }
        return "text";
      };
      const visible = (color: string) => color !== "transparent" && color !== "rgba(0, 0, 0, 0)" && !/\/ 0\)$/u.test(color);
      const paints = (element: Element) =>
        used(element) !== "none" && visible(getComputedStyle(element, "::selection").backgroundColor);
      const shown = (node: Node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects().length > 0;
      };
      const chromeSelector = [
        ...chrome,
        ".note-drawn > :not(pre)",
        ".note-embed",
        ".note-image",
        '[data-type="math-inline"]',
        ".note-diff-insert",
        ".note-diff-block",
      ].join(", ");
      const selection = window.getSelection();
      const painted: string[] = [];
      const paintedChrome: string[] = [];
      const paintedOutside: string[] = [];
      let outsideEditor = false;
      for (let index = 0; index < (selection?.rangeCount ?? 0); index += 1) {
        const range = selection?.getRangeAt(index);
        if (!range || range.collapsed) continue;
        if (!root.contains(range.commonAncestorContainer)) outsideEditor = true;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!range.intersectsNode(node)) continue;
          const element = node instanceof Element ? node : node.parentElement;
          if (!element) continue;
          const replaced = node instanceof Element && /^(img|svg|canvas|iframe|input|video)$/iu.test(node.tagName);
          const text = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").trim() : "";
          if (!replaced && !text) continue;
          if (!shown(node) || !paints(element)) continue;
          const label = replaced ? `<${element.tagName.toLowerCase()}>` : text;
          const inChrome = element.closest(chromeSelector);
          if (!root.contains(element)) paintedOutside.push(label);
          else if (inChrome) paintedChrome.push(`${label} in ${inChrome.className}`);
          else painted.push(label);
        }
      }
      const blocks = [...root.querySelectorAll(whole)].filter((element) => !element.parentElement?.closest(".note-embed"));
      const tinted = blocks.filter(
        (element) => element.classList.contains("note-in-selection") && visible(getComputedStyle(element, "::after").backgroundColor),
      );
      return {
        ranges: selection?.rangeCount ?? 0,
        outsideEditor,
        painted,
        paintedChrome,
        paintedOutside,
        whole: blocks.length,
        tinted: tinted.length,
        stray: root.hasAttribute("data-note-stray-selection"),
      };
    },
    { chrome: CHROME, whole: WHOLE },
  );
}

function chromeSelectable(page: Page): Promise<string[]> {
  return page.evaluate((selectors) => {
    const root = [...document.querySelectorAll<HTMLElement>('.ProseMirror[contenteditable="true"]')].find(
      (element) => element.getClientRects().length > 0,
    );
    const selectable: string[] = [];
    for (const selector of [...selectors, '.note-drawn:not([data-block="notebook"]) > .note-drawn-preview']) {
      const found = [...(root?.querySelectorAll(selector) ?? [])];
      if (found.length === 0) selectable.push(`${selector} missing`);
      for (const element of found) {
        const style = getComputedStyle(element);
        const value = style.userSelect || (style as unknown as { webkitUserSelect: string }).webkitUserSelect;
        if (value !== "none") selectable.push(`${selector}: ${value}`);
      }
    }
    return selectable;
  }, CHROME);
}

async function copy(page: Page): Promise<Copied> {
  await page.evaluate(() => {
    const state = window as unknown as { __copied?: Copied };
    state.__copied = undefined;
    document.addEventListener(
      "copy",
      (event) => {
        state.__copied = {
          text: event.clipboardData?.getData("text/plain") ?? "",
          html: event.clipboardData?.getData("text/html") ?? "",
        };
      },
      { once: true },
    );
  });
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __copied?: Copied }).__copied))).toBe(true);
  return page.evaluate(() => (window as unknown as { __copied: Copied }).__copied);
}

async function shoot(page: Page, name: string): Promise<void> {
  const shot = await page.screenshot();
  await test.info().attach(name, { body: shot, contentType: "image/png" });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function selectAllInEditor(page: Page, engine: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors = await open(page);
  await openEveryBlock(page);
  await editor(page).locator("p").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await expect.poll(async () => (await inspectSelection(page)).tinted).toBeGreaterThan(0);

  const report = await inspectSelection(page);
  expect(report.ranges).toBe(1);
  expect(report.outsideEditor).toBe(false);
  expect(report.stray).toBe(false);
  expect(report.paintedOutside).toEqual([]);
  expect(report.paintedChrome).toEqual([]);
  expect(report.whole).toBe(16);
  expect(report.tinted).toBe(report.whole);
  const shownText = report.painted.join(" ");
  for (const text of ["Every block", "A paragraph with", "Callout title", "Callout body line.", "Open task", "First step", "print", "Score", "Last paragraph."]) {
    expect(shownText).toContain(text);
  }
  for (const word of BUTTON_WORDS) expect(report.painted).not.toContain(word);
  expect(await chromeSelectable(page)).toEqual([]);

  await editor(page).locator(':scope > .note-drawn[data-block="chart"]').scrollIntoViewIfNeeded();
  await page.mouse.move(5, 995);
  await shoot(page, `${engine}-editor-select-all`);

  const copied = await copy(page);
  expect(copied.text).toBe(BODY.replace(/\n+$/u, ""));
  expect(copied.text).not.toMatch(/\u200b|\u200c|\u200d|\u2060|\ufeff/u);
  for (const word of ["Show data", "Running needs", "Typst previews need"]) expect(copied.text).not.toContain(word);
  expect(copied.html).not.toContain("note-drawn-label");
  expect(copied.html).not.toContain("Show data");

  const cell = editor(page).locator(':scope > .note-drawn[data-block="csv"] td span').first();
  await cell.scrollIntoViewIfNeeded();
  await cell.evaluate((element) => window.getSelection()?.selectAllChildren(element));
  await expect.poll(async () => (await inspectSelection(page)).stray).toBe(true);
  const inTable = await inspectSelection(page);
  expect(inTable.tinted).toBe(0);
  expect(inTable.painted).toEqual([]);
  expect(inTable.paintedChrome).toEqual(["A1 in note-drawn-preview"]);
  expect(errors).toEqual([]);
}

async function selectAllOutsideEditor(page: Page, engine: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors = await open(page);
  await openEveryBlock(page);
  const composer = page.getByRole("combobox", { name: "Assistant", exact: true });
  await composer.fill("What does the note say about the mask ratio?");
  await composer.press("Enter");
  await expect(page.getByRole("region", { name: "Conversation with the assistant" })).toContainText("Here is what the note says");

  await page.locator("article p.text-xs").first().click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ControlOrMeta+a");
  const fromPage = await inspectSelection(page);
  expect(fromPage.paintedOutside).toEqual([]);
  expect(fromPage.paintedChrome).toEqual([]);
  await shoot(page, `${engine}-page-select-all`);

  const title = page.locator('input[aria-label="Note title"]:visible');
  await title.click();
  await page.keyboard.press("ControlOrMeta+a");
  expect(await title.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd, input.value.length])).toEqual([0, 32, 32]);
  const fromTitle = await inspectSelection(page);
  expect(fromTitle.painted).toEqual([]);
  expect(fromTitle.paintedOutside).toEqual([]);
  expect(fromTitle.tinted).toBe(0);

  const status = page.locator('input[aria-label="Value of status"]:visible');
  await status.click();
  await page.keyboard.press("ControlOrMeta+a");
  expect(await status.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 5]);
  const fromProperty = await inspectSelection(page);
  expect(fromProperty.painted).toEqual([]);
  expect(fromProperty.paintedOutside).toEqual([]);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
}

interface TableColours {
  csvHead: number[];
  csvFoot: number[];
  csvBody: number[];
  markdownHead: number[];
  opaque: boolean;
  sticky: string[];
  labelContrast: number;
  headContrast: number;
}

const READING_ID = "7a9c1e35-6d8f-4b2a-9e4c-0f1a2b3c4d03";
const READING = `---
title: "Reading notes: masked autoencoders"
kind: note
id: ${READING_ID}
color: mint
---

${BODY}`;

function tableColours(page: Page): Promise<TableColours> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[role="tabpanel"][data-shown="true"] .ProseMirror[contenteditable="true"]');
    if (!root) throw new Error("no editor");
    const canvas = Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
    const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    const paint = (color: string, under: string) => {
      context.fillStyle = under;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const style = (selector: string) => {
      const found = root.querySelector(selector);
      if (!found) throw new Error(`missing ${selector}`);
      return getComputedStyle(found);
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const head = style('.note-drawn[data-block="csv"] thead th');
    const foot = style('.note-drawn[data-block="csv"] tfoot td');
    const csvHead = paint(head.backgroundColor, "#fff");
    const csvFoot = paint(foot.backgroundColor, "#fff");
    const contrast = (text: string, under: number[]) => {
      const [light, dark] = [luminance(under), luminance(paint(style(text).color, `rgb(${under.join(",")})`))].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    };
    return {
      csvHead,
      csvFoot,
      csvBody: paint(style('.note-drawn[data-block="csv"] tbody td').backgroundColor, "#fff"),
      markdownHead: paint(style(":scope > table th, :scope > .tableWrapper th").backgroundColor, "#fff"),
      opaque: [head, foot].every((cell) => paint(cell.backgroundColor, "#000").join() === paint(cell.backgroundColor, "#fff").join()),
      sticky: [head.position, foot.position],
      labelContrast: contrast('.note-drawn[data-block="csv"] tfoot dt', csvFoot),
      headContrast: contrast('.note-drawn[data-block="csv"] thead th button', csvHead),
    };
  });
}

async function openTables(page: Page, title: RegExp): Promise<TableColours> {
  await page.locator("aside").getByRole("button", { name: title }).first().click();
  await expect(page.locator('input[aria-label="Note title"]:visible')).toHaveValue(title);
  const drawn = editor(page).locator(':scope > .note-drawn[data-block="csv"]');
  await drawn.scrollIntoViewIfNeeded();
  await expect(drawn.locator("tfoot")).toBeVisible();
  return tableColours(page);
}

async function tablesTakeTheNoteColour(page: Page, engine: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const chroma = (rgb: number[]) => Math.max(...rgb) - Math.min(...rgb);
  for (const theme of ["light", "dark"] as const) {
    const errors = (await new NotesPage(page).open(theme === "dark" ? "?theme=dark" : "")).errors;
    await page.evaluate(
      ([dataloader, reading]) => {
        const notes = (window as unknown as { __notes: { writeFromDisk(id: string, text: string): void } }).__notes;
        notes.writeFromDisk("dataloader", dataloader);
        notes.writeFromDisk("reading", reading);
      },
      [NOTE.replace("status: draft\n", "status: draft\ncolor: sky\n"), READING],
    );
    const sky = await openTables(page, /Dataloader rewrite/);
    await shoot(page, `${engine}-${theme}-tables-sky`);
    const mint = await openTables(page, /Reading notes/);
    await shoot(page, `${engine}-${theme}-tables-mint`);
    for (const colours of [sky, mint]) {
      expect(chroma(colours.csvHead), theme).toBeGreaterThan(8);
      expect(chroma(colours.csvFoot), theme).toBeGreaterThan(4);
      expect(colours.markdownHead, theme).toEqual(colours.csvHead);
      expect(colours.csvBody, theme).toEqual([255, 255, 255]);
      expect(colours.opaque, theme).toBe(true);
      expect(colours.sticky, theme).toEqual(["sticky", "sticky"]);
      expect(colours.labelContrast, theme).toBeGreaterThanOrEqual(4.5);
      expect(colours.headContrast, theme).toBeGreaterThanOrEqual(4.5);
    }
    expect(sky.csvHead, theme).not.toEqual(mint.csvHead);
    expect(sky.csvFoot, theme).not.toEqual(mint.csvFoot);
    expect(errors).toEqual([]);
  }
}

async function inWebKit(run: (page: Page) => Promise<void>): Promise<void> {
  // WebKit is skipped on purpose until CI installs it next to Chromium.
  test.skip(!existsSync(webkit.executablePath()), "WebKit is not installed for Playwright on this machine");
  let browser: Browser | null = null;
  try {
    browser = await webkit.launch();
    await run(await browser.newPage());
  } finally {
    await browser?.close();
  }
}

test.describe("Notes select all", () => {
  test("Mod+A in a note selects only its content and copies clean Markdown in Chromium", async ({ page }) => {
    await selectAllInEditor(page, "chromium");
  });

  test("Mod+A in a note selects only its content and copies clean Markdown in WebKit", async () => {
    await inWebKit((page) => selectAllInEditor(page, "webkit"));
  });

  test("Mod+A outside the note body never selects the page chrome in Chromium", async ({ page }) => {
    await selectAllOutsideEditor(page, "chromium");
  });

  test("Mod+A outside the note body never selects the page chrome in WebKit", async () => {
    await inWebKit((page) => selectAllOutsideEditor(page, "webkit"));
  });
});

test.describe("Notes tables", () => {
  test("a table's header and summary row take the note's colour in Chromium", async ({ page }) => {
    await tablesTakeTheNoteColour(page, "chromium");
  });

  test("a table's header and summary row take the note's colour in WebKit", async () => {
    await inWebKit((page) => tablesTakeTheNoteColour(page, "webkit"));
  });
});
