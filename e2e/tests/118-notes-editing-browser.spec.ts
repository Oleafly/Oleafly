import { expect, INFO_PLACES, type NotesPage, test } from "../notes-page";

const ABSTRACT_ID = "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3e02";
const MASKING_ID = "8d3f2a61-4b7c-4e9d-a1f0-5c6b7d8e9f01";
const FENCE = "```";

const CHECKLIST = `---
title: Abstract draft
kind: note
id: ${ABSTRACT_ID}
status: draft
---

Results so far are tagged #results for the weekly review.

- [ ] Rerun the sweep
- [ ] Write the abstract

## Methods

The encoder masks patches.

## Findings

The lower ratio helps.
`;

async function openChecklist(notes: NotesPage): Promise<void> {
  await notes.open();
  await notes.writeFromDisk("abstract", CHECKLIST);
  await notes.openNote("Abstract draft");
}

const SLASH_BLOCKS: readonly [string, string | RegExp, RegExp][] = [
  ["table", "Table", /\n\| +\| +\| +\|\n\| -+ \| -+ \| -+ \|\n/u],
  ["callout", "Callout", /\n> \[!note\]/u],
  ["task", "Task list", /\n- \[ \]\n/u],
  ["math", "Math", /\n\$\$x\^2\$\$\n/u],
  ["code", "Code", new RegExp(`\n${FENCE}\n`, "u")],
  ["chart", /Chart/u, new RegExp(`\n${FENCE}chart\n\\{`, "u")],
  ["mermaid", /Mermaid/u, new RegExp(`\n${FENCE}mermaid\n`, "u")],
  ["divider", "Divider", /\n---\n/u],
];

test.describe("Notes editing", () => {
  test("draws Mermaid, chart and math blocks and shows their source on request", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Masking strategy report");
    const drawn = async (block: string) => {
      const view = notes.drawn(block);
      await view.scrollIntoViewIfNeeded();
      return view.locator(".note-drawn-preview");
    };
    await expect((await drawn("mermaid")).locator("svg").first()).toBeVisible();
    await expect((await drawn("chart")).getByRole("img", { name: "Validation by run" })).toBeVisible();
    await expect((await drawn("latex")).locator(".katex")).toBeVisible();
    await expect(await drawn("typst")).toContainText("Typst previews need the desktop app.");

    const chart = notes.drawn("chart");
    await expect(chart.locator("pre")).toBeHidden();
    await chart.getByRole("button", { name: "Source" }).click();
    await expect(chart.locator("pre")).toBeVisible();
    await expect(chart.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
  });

  test("renders in dark mode without errors", async ({ notes }) => {
    await notes.open("?theme=dark");
    await notes.openNote("Masking strategy report");
    const chart = notes.drawn("chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.getByRole("img", { name: "Validation by run" })).toBeVisible();
  });

  test("sets an emoji and a line icon on a note", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await page.getByRole("button", { name: "Choose icon" }).click();
    await page.getByRole("searchbox", { name: "Search emoji" }).fill("rocket");
    await page.getByRole("gridcell", { name: /rocket/i }).first().click();
    await expect(page.getByRole("button", { name: "Choose icon" })).toHaveText("🚀");

    await page.getByRole("button", { name: "Choose icon" }).click();
    await page.getByRole("tab", { name: "Icons" }).click();
    await page.getByRole("textbox", { name: "Search icons" }).fill("flask");
    await page.getByRole("button", { name: "Flask" }).click();
    const tile = page.getByRole("button", { name: "Choose icon" });
    await expect(tile.locator("svg")).toBeVisible();
    const chip = await tile.locator("[data-note-color]").boundingBox();
    const glyph = await tile.locator("svg").boundingBox();
    if (!chip || !glyph) throw new Error("no geometry");
    expect(glyph.width / chip.width).toBeCloseTo(0.5, 1);
  });

  test("saves typing, the title and the icon to the note's Markdown, and keeps them after a reload", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" We report three runs.");
    await expect.poll(() => notes.text("abstract")).toContain("up to a point. We report three runs.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await notes.title.fill("Abstract: second draft");
    await notes.title.press("Enter");
    await expect.poll(() => notes.text("abstract")).toContain('title: "Abstract: second draft"');
    await expect(notes.sidebar.getByRole("button", { name: /Abstract: second draft/ })).toBeVisible();

    await page.getByRole("button", { name: "Choose icon" }).click();
    await page.getByRole("tab", { name: "Icons" }).click();
    await page.getByRole("button", { name: "Flask" }).click();
    await expect.poll(() => notes.text("abstract")).toContain("icon: lucide:flask-conical");
    expect(await notes.text("abstract")).toMatch(
      new RegExp(`^---\ntitle: "Abstract: second draft"\nkind: note\nid: ${ABSTRACT_ID}\nicon: lucide:flask-conical\n---\n\nWe study`, "u"),
    );

    await notes.reload();
    await notes.openNote("Abstract: second draft");
    await expect(notes.firstParagraph).toContainText("up to a point. We report three runs.");
  });

  for (const [query, option, markdown] of SLASH_BLOCKS) {
    test(`inserts a ${query} block from the slash menu by keyboard and saves its Markdown`, async ({ notes }) => {
      await notes.open();
      await notes.openNote("Abstract draft");
      await notes.newParagraph();
      await notes.slash(query, option);
      await expect.poll(() => notes.text("abstract")).toMatch(markdown);
    });
  }

  test("applies every text mark from the toolbar, highlights in several colours, and writes its Markdown", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Abstract draft");
    const marks: readonly [string, string, string][] = [
      ["study", "Bold", "**study**"],
      ["mask", "Italic", "*mask*"],
      ["ratio", "Underline", "<u>ratio</u>"],
      ["changes", "Strikethrough", "~~changes~~"],
      ["encoder", "Inline code", "`encoder`"],
    ];
    for (const [word, mark, written] of marks) {
      await notes.selectText(word);
      await notes.tool(mark);
      await expect.poll(() => notes.text("abstract")).toContain(written);
    }
    const highlights: readonly [string, RegExp, string][] = [
      ["learns", /^Yellow/u, "==learns=="],
      ["small datasets", /^Green/u, '<mark data-color="green">small datasets</mark>'],
      ["point", /^Purple/u, '<mark data-color="purple">point</mark>'],
    ];
    for (const [words, color, written] of highlights) {
      await notes.selectText(words);
      await notes.tool("Highlight");
      await notes.page.getByRole("menuitemcheckbox", { name: color }).click();
      await expect.poll(() => notes.text("abstract")).toContain(written);
    }
    await expect(notes.editor.locator('mark.note-highlight[data-color="green"]')).not.toHaveCSS(
      "background-color",
      await notes.editor.locator('mark.note-highlight[data-color="purple"]').evaluate((mark) => getComputedStyle(mark).backgroundColor),
    );
  });

  test("resizes an image by dragging its handle, saves the width, and resets it on double-click", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.page.getByRole("button", { name: "Artifacts, 4" }).click();
    await notes.page.getByRole("complementary", { name: "Artifacts" }).getByRole("button", { name: "Insert in note" }).click();
    const figure = notes.editor.locator("figure.note-image");
    const frame = figure.locator(".note-image-frame");
    await expect(frame.locator("img")).toBeVisible();
    await frame.hover();
    const handle = frame.locator(".note-image-handle");
    await expect(handle).toHaveCSS("opacity", "0.85");
    const column = await figure.boundingBox();
    const grip = await handle.boundingBox();
    if (!column || !grip) throw new Error("the image has no size");
    await notes.page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await notes.page.mouse.down();
    await notes.page.mouse.move(column.x + column.width / 2, grip.y + grip.height / 2, { steps: 6 });
    await notes.page.mouse.up();
    await expect.poll(() => notes.text("masking")).toMatch(/\(assets\/loss-curve\.svg\)\{width=(4[5-9]|5[0-5])%\}/u);
    const sized = await frame.boundingBox();
    expect(Math.abs((sized?.width ?? 0) - column.width / 2)).toBeLessThan(column.width * 0.06);
    await handle.dblclick();
    await expect.poll(() => notes.text("masking")).not.toContain("(assets/loss-curve.svg){width");
  });

  test("asks whether to embed a pasted video link, then shows its preview and plays it inline", async ({ notes }) => {
    const { page } = await notes.open();
    await page.route(/https:\/\/(?:i\.ytimg\.com|www\.youtube-nocookie\.com)\//u, (route) =>
      route.request().resourceType() === "image"
        ? route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#345"/></svg>' })
        : route.fulfill({ contentType: "text/html", body: "<title>player</title><p>player</p>" }),
    );
    await notes.openNote("Abstract draft");
    await notes.newParagraph();
    await notes.editor.evaluate((editor) => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://youtu.be/dQw4w9WgXcQ");
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const choice = page.getByRole("group", { name: "How to show this video link" });
    await expect(choice).toBeVisible();
    await expect.poll(() => notes.text("abstract")).toContain("https://youtu.be/dQw4w9WgXcQ");
    await choice.getByRole("button", { name: "Embed video" }).click();
    const card = notes.editor.locator('figure.note-media[data-provider="youtube"]');
    await expect(card.locator("img.note-media-thumb")).toBeVisible();
    await expect.poll(() => notes.text("abstract")).toContain("![](https://youtu.be/dQw4w9WgXcQ)");
    const play = card.getByRole("button", { name: "Play the video from YouTube" });
    const bar = card.locator("figcaption");
    const watch = bar.getByRole("link", { name: "Watch on YouTube" });
    await expect(bar.getByRole("img", { name: "YouTube" })).toBeVisible();
    await expect(watch).toHaveText("Watch");
    await expect(watch).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.mouse.move(0, 0);
    await expect(bar).toHaveCSS("opacity", "0");
    const height = (await card.boundingBox())?.height;
    await card.hover();
    await expect(bar).toHaveCSS("opacity", "1");
    expect((await card.boundingBox())?.height).toBe(height);
    const bottom = (box: { y: number; height: number } | null) => (box ? box.y + box.height : Number.NaN);
    expect(bottom(await play.boundingBox()) - bottom(await bar.boundingBox())).toBeCloseTo(1, 0);
    await page.mouse.move(0, 0);
    await expect(bar).toHaveCSS("opacity", "0");
    await play.focus();
    await expect(bar).toHaveCSS("opacity", "1");
    await page.context().route("https://www.youtube.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>watch</title>" }));
    const site = page.waitForEvent("popup");
    await watch.click();
    const opened = await site;
    expect(opened.url()).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await opened.close();
    await expect(card.locator("iframe")).toHaveCount(0);
    await expect(play).toBeEnabled();
    const border = () =>
      card.evaluate(async (figure) => {
        await Promise.all(figure.getAnimations({ subtree: true }).map((animation) => animation.finished));
        return getComputedStyle(figure.firstElementChild as Element).borderTopColor;
      });
    const unselected = await border();
    await bar.getByRole("img", { name: "YouTube" }).click();
    await expect(card).toHaveClass(/ProseMirror-selectednode/u);
    await page.mouse.move(0, 0);
    const selected = await border();
    expect(selected).not.toBe(unselected);
    await expect(bar).toHaveCSS("opacity", "1");
    await play.click();
    await expect(card.locator("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1");
    await expect.poll(border).toBe(selected);
    await expect(card.locator("figcaption")).toHaveCount(0);
    await expect(page.frameLocator("figure.note-media iframe").getByText("player")).toBeVisible();
  });

  test("turns typed pairs like -> into symbols, and Backspace right after puts the typed text back", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Abstract draft");
    await notes.caretAtEnd();
    await notes.page.keyboard.type(" Then -> done... a -- b");
    await expect.poll(() => notes.text("abstract")).toContain("Then → done… a — b");
    await notes.page.keyboard.type(" x ->");
    await notes.page.keyboard.press("Backspace");
    await expect.poll(() => notes.text("abstract")).toContain("a — b x ->");
  });

  test("turns a line into a task, adds a divider, and works on a table's rows, columns and alignment", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.newParagraph();
    await page.keyboard.type("Check the seeds");
    await notes.tool("List", "Task list");
    await expect.poll(() => notes.text("abstract")).toContain("\n- [ ] Check the seeds\n");

    await notes.newParagraph();
    await notes.tool("Divider");
    await expect.poll(() => notes.text("abstract")).toMatch(/\n---\n/u);

    await notes.newParagraph();
    await notes.slash("table", "Table");
    await page.keyboard.type("Run");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Score");
    await notes.tool("Table tools", "Insert row below");
    await notes.tool("Table tools", "Insert column right");
    await notes.tool("Table tools", "Align column center");
    await expect
      .poll(() => notes.text("abstract"))
      .toMatch(/\| Run +\| Score +\| +\| +\|\n\| -+ \| :-+: \| -+ \| -+ \|\n(\|( +\|){4}\n){3}/u);
    await notes.tool("Table tools", "Delete column");
    await expect.poll(() => notes.text("abstract")).toMatch(/\| Run +\|( +\|){2}\n\| -+ \|( -+ \|){2}\n(\|( +\|){3}\n){3}/u);
    await page.keyboard.press("ArrowDown");
    await notes.tool("Table tools", "Delete row");
    await expect.poll(() => notes.text("abstract")).toMatch(/\| Run +\|( +\|){2}\n\| -+ \|( -+ \|){2}\n(\|( +\|){3}\n){2}(?!\|)/u);
  });

  test("finds and replaces every match, saves it, and gives focus back to the note on Escape", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.firstParagraph.click();
    await page.keyboard.press("ControlOrMeta+f");
    const bar = page.getByRole("search", { name: "Find and replace" });
    await bar.getByRole("textbox", { name: "Find" }).fill("mask ratio");
    await expect(bar.locator("output")).toHaveText("4 results");
    await bar.getByRole("button", { name: "Toggle Replace" }).click();
    await bar.getByRole("textbox", { name: "Replace" }).fill("masking ratio");
    await bar.getByRole("button", { name: "All", exact: true }).click();
    await expect.poll(() => notes.text("masking")).not.toContain("mask ratio");
    expect((await notes.text("masking")).match(/masking ratio/gu)).toHaveLength(4);
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(notes.editor).toBeFocused();
  });

  for (const place of INFO_PLACES) {
    test(`ticks a task, edits a property (${place}), follows a tag and jumps to a heading from the outline`, async ({ notes }) => {
      await notes.placeInfo(place);
      await openChecklist(notes);
      const { page } = notes;
      await page.getByRole("checkbox", { name: "Task: Rerun the sweep" }).click();
      await expect.poll(() => notes.text("abstract")).toContain("- [x] Rerun the sweep\n- [ ] Write the abstract");
      await notes.caretAtEnd();
      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(() => notes.text("abstract")).toContain("- [ ] Rerun the sweep");

      const status = (await notes.showInfo()).locator('input[aria-label="Value of status"]');
      await status.fill("final");
      await status.press("Enter");
      await expect.poll(() => notes.text("abstract")).toContain("\nstatus: final\n");

      await notes.tool("Outline", "Findings");
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest("h2")?.textContent ?? ""))
        .toBe("Findings");

      const chip = notes.editor.locator('.note-tag[data-tag="results"]');
      await chip.click();
      await expect(notes.sidebar.getByRole("option", { name: /Abstract draft/ })).toBeVisible();
      await expect(notes.sidebar.getByRole("option", { name: /Masking strategy report/ })).toHaveCount(0);

      const paint = (element: Element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor };
      };
      const filter = notes.sidebar.getByRole("button", { name: "Stop filtering by results" });
      await page.mouse.move(0, 0);
      const editorPaint = await chip.evaluate(paint);
      expect(editorPaint.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(await filter.evaluate(paint)).toEqual(editorPaint);
      const badge = notes.sidebar.getByRole("button", { name: "Show notes tagged results" });
      await expect(badge).toHaveAttribute("aria-pressed", "true");
      expect(await badge.evaluate(paint)).toEqual(editorPaint);
      expect(await badge.getByText("#results").evaluate(paint)).toMatchObject({ color: editorPaint.color });
      await expect.poll(() => badge.evaluate((element) => getComputedStyle(element).borderColor)).toBe(editorPaint.color);
    });
  }

  test("draws links to notes and projects as chips and opens a linked note", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Reading notes: masked autoencoders");
    const noteLink = notes.editor.locator('[data-note-link="note"]', { hasText: "Masking strategy report" });
    await expect(noteLink).toBeVisible();
    await expect(notes.editor.locator('[data-note-link="project"]', { hasText: "SSL masking" })).toBeVisible();
    await noteLink.click();
    await expect(notes.title).toHaveValue("Masking strategy report");
  });

  for (const place of INFO_PLACES) {
    test(`lists the notes that link here, keeps them folded after a reload and opens one (${place})`, async ({ notes }) => {
      await notes.placeInfo(place);
      const { page } = await notes.open();
      await notes.openNote("Masking strategy report");
      const linked = (await notes.showInfo()).getByRole("region", { name: "Linked from" });
      await expect(linked).toContainText("Reading notes: masked autoencoders");
      await expect(linked).toContainText("Dataloader rewrite: what changed");
      const item = linked.getByRole("button", { name: /Dataloader rewrite/ });
      const toggle = linked.getByRole("button", { name: "Linked from 2", exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(item).toHaveCount(0);

      await notes.reload();
      await notes.openNote("Masking strategy report");
      if (place === "side") await expect(notes.infoPanel).toBeVisible();
      await toggle.scrollIntoViewIfNeeded();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(item).toHaveCount(0);
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await item.click();
      await expect(notes.title).toHaveValue("Dataloader rewrite: what changed");
      if (place === "side") await expect(notes.infoPanel.getByRole("region", { name: "Linked from" })).toContainText("No notes link here");
      else await expect(page.getByRole("region", { name: "Linked from" }).filter({ visible: true })).toHaveCount(0);
    });
  }

  for (const place of INFO_PLACES) {
    test(`folds the notes that mention this one and keeps them folded after a reload (${place})`, async ({ notes }) => {
      await notes.placeInfo(place);
      const { page } = await notes.open();
      await notes.writeFromDisk(
        "abstract",
        `---\ntitle: Abstract draft\nkind: note\nid: ${ABSTRACT_ID}\n---\n\nThe Masking strategy report has the sweep numbers.\n`,
      );
      await notes.openNote("Masking strategy report");
      const info = await notes.showInfo();
      await info.getByRole("region", { name: "Linked from" }).scrollIntoViewIfNeeded();
      const mentions = info.getByRole("region", { name: "Mentioned in" });
      const item = mentions.getByRole("button", { name: "Abstract draft", exact: true });
      await expect(item).toBeVisible();
      await expect(mentions).not.toContainText("Reading notes: masked autoencoders");
      const toggle = mentions.getByRole("button", { name: "Mentioned in 1", exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(item).toHaveCount(0);

      await notes.reload();
      await notes.openNote("Masking strategy report");
      const folded = mentions.getByRole("button", { name: "Mentioned in", exact: true });
      await folded.scrollIntoViewIfNeeded();
      await expect(folded).toHaveAttribute("aria-expanded", "false");
      await expect(item).toHaveCount(0);
      await folded.focus();
      await page.keyboard.press("Enter");
      await expect(item).toBeVisible();
      await expect(mentions.getByRole("button", { name: "Mentioned in 1", exact: true })).toHaveAttribute("aria-expanded", "true");
    });
  }

  test("offers notes and projects after [[ and saves the chosen link by id", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.newParagraph();
    await page.keyboard.type("See [[mask");
    const menu = page.getByRole("listbox", { name: "Link to a note or project" });
    await expect(menu.getByRole("option", { name: /Masking strategy report/ })).toBeVisible();
    await menu.getByRole("option", { name: /Masking strategy report/ }).click();
    await expect(menu).toHaveCount(0);
    await expect(notes.editor.locator('[data-note-link="note"]', { hasText: "Masking strategy report" })).toBeVisible();
    await expect.poll(() => notes.text("abstract")).toContain(`See [Masking strategy report](oleafly://note/${MASKING_ID})`);
    await page.keyboard.type(" and [[ssl");
    await expect(menu.getByRole("option", { name: /SSL masking/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("moves toolbar groups that do not fit a docked panel into More and back", async ({ notes }) => {
    const { page } = notes;
    await page.setViewportSize({ width: 1100, height: 800 });
    await notes.open();
    await notes.openNote("Abstract draft");
    await notes.openNote("Dataloader rewrite: what changed");
    await notes.dockRight("Dataloader rewrite: what changed");
    const panel = page.getByRole("tabpanel", { name: "Abstract draft" });
    const toolbar = panel.getByRole("toolbar", { name: "Formatting" });
    const more = toolbar.getByRole("button", { name: "More", exact: true });
    await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Block type" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Quote", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Code block", exact: true })).toBeVisible();
    await expect(more).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Chart", exact: true })).toHaveCount(0);
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const bar = await toolbar.boundingBox();
    const button = await more.boundingBox();
    if (!bar || !button) throw new Error("no geometry");
    expect(button.x + button.width).toBeLessThanOrEqual(bar.x + bar.width);
    expect(bar.x + bar.width - (button.x + button.width)).toBeLessThan(16);

    await panel.locator(".ProseMirror > p").first().click();
    await more.click();
    await page.getByRole("menuitem", { name: "Chart", exact: true }).click();
    await expect(panel.locator('[data-block="chart"]')).toHaveCount(1);
    await expect(toolbar.getByRole("button", { name: "List", exact: true })).toBeVisible();
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    await page.setViewportSize({ width: 2600, height: 800 });
    await expect(more).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "Chart", exact: true })).toBeVisible();
  });

  test("turns a line into a quote or a code block from the bar and sets the code language", async ({ notes }) => {
    await notes.page.setViewportSize({ width: 1600, height: 900 });
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.newParagraph();
    await page.keyboard.type("print(1)");
    const toolbar = notes.shown.getByRole("toolbar", { name: "Formatting" });
    const quote = toolbar.getByRole("button", { name: "Quote", exact: true });
    const code = toolbar.getByRole("button", { name: "Code block", exact: true });
    const language = toolbar.getByRole("button", { name: "Code language", exact: true });
    const list = toolbar.getByRole("button", { name: "List", exact: true });
    await expect(language).toHaveCount(0);
    const listAt = (await list.boundingBox())?.x;
    await quote.click();
    await expect(quote).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => notes.text("abstract")).toContain("\n> print(1)");
    await quote.click();
    await expect(quote).toHaveAttribute("aria-pressed", "false");
    await code.click();
    await expect(code).toHaveAttribute("aria-pressed", "true");
    await expect(language).toBeVisible();
    expect((await list.boundingBox())?.x).toBe(listAt);
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await language.click();
    await page.getByRole("menuitemcheckbox", { name: "python", exact: true }).click();
    await expect.poll(() => notes.text("abstract")).toContain(`\n${FENCE}python\nprint(1)\n${FENCE}`);
  });

  test("widens every open note from the toolbar and remembers the width", async ({ notes }) => {
    const { page } = notes;
    await page.setViewportSize({ width: 1600, height: 900 });
    await notes.open();
    await notes.openNote("Masking strategy report");
    const article = notes.shown.locator("article");
    const widthOf = async () => (await article.boundingBox())?.width ?? 0;
    const standard = await widthOf();
    await notes.shown.getByRole("button", { name: "Note width" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Standard" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "Wide" }).click();
    await expect.poll(widthOf).toBeGreaterThan(standard + 150);
    const wide = await widthOf();

    await notes.shown.getByRole("button", { name: "Note width" }).click();
    await page.getByRole("menuitemradio", { name: "Full width" }).click();
    await expect.poll(widthOf).toBeGreaterThan(wide + 100);
    expect((await notes.firstParagraph.boundingBox())?.width ?? 0).toBeGreaterThan(wide);

    await notes.openNote("Abstract draft");
    await expect(notes.shown.locator("[data-note-width]")).toHaveAttribute("data-note-width", "full");
    await notes.reload();
    await notes.openNote("Masking strategy report");
    await expect(notes.shown.locator("[data-note-width]")).toHaveAttribute("data-note-width", "full");
  });
});
