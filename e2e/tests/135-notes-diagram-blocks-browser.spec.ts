import { expect, type NotesPage, test } from "../notes-page";

const ABSTRACT_ID = "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3e02";
const FENCE = "```";

const SKETCHES = `---
title: Abstract draft
kind: note
id: ${ABSTRACT_ID}
---

The board, drawn three ways.

${FENCE}d2
direction: right
sensor -> adc: analog
adc -> mcu: samples
${FENCE}

${FENCE}tikz
\\draw (0,0) circle (1) node {$x$};
${FENCE}

${FENCE}circuitikz
\\draw (0,0) to[R, l=$R$] (2,0);
${FENCE}

End of sketches.
`;

const SLASH: readonly [string, RegExp, RegExp][] = [
  ["d2", /^D2/u, new RegExp(`\n${FENCE}d2\ndirection: right\n`, "u")],
  ["tikz", /^TikZ/u, new RegExp(`\n${FENCE}tikz\n\\\\usetikzlibrary\\{arrows\\.meta, positioning\\}\n`, "u")],
  ["circuit", /^CircuiTikZ/u, new RegExp(`\n${FENCE}circuitikz\n\\\\begin\\{circuitikz\\}\n`, "u")],
];

async function openSketches(notes: NotesPage, query = ""): Promise<void> {
  await notes.open(query);
  await notes.writeFromDisk("abstract", SKETCHES);
  await notes.openNote("Abstract draft");
}

test.describe("Notes diagram blocks", () => {
  test("draws D2 in place and says TikZ and CircuiTikZ need the desktop app", async ({ notes }) => {
    await openSketches(notes);
    const d2 = notes.drawn("d2");
    const image = d2.locator(".note-drawn-preview img.note-d2");
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect(image).toHaveAttribute("alt", "D2 diagram");
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    await expect(notes.drawn("tikz").locator(".note-drawn-preview")).toHaveText("TikZ previews need the desktop app.");
    await expect(notes.drawn("circuitikz").locator(".note-drawn-preview")).toHaveText("CircuiTikZ previews need the desktop app.");

    await expect(d2.locator("pre")).toBeHidden();
    await d2.getByRole("button", { name: "Source" }).click();
    await expect(d2.locator("pre")).toContainText("sensor -> adc: analog");
    await expect(d2.getByRole("button", { name: "How to write a D2 block" })).toBeVisible();
    expect(notes.errors).toEqual([]);
  });

  test("redraws D2 as it is edited and points at the line of a mistake", async ({ notes }) => {
    await openSketches(notes);
    const { page } = notes;
    const d2 = notes.drawn("d2");
    await expect(d2.locator("img.note-d2")).toBeVisible({ timeout: 30_000 });
    const before = await d2.locator("img.note-d2").getAttribute("src");
    await d2.getByRole("button", { name: "Source" }).click();
    await notes.caretAtEnd(d2.locator("pre code"));
    await page.keyboard.type("\nmcu -> cloud: upload");
    await expect.poll(() => d2.locator("img.note-d2").getAttribute("src"), { timeout: 30_000 }).not.toBe(before);
    await expect.poll(() => notes.text("abstract")).toContain("adc -> mcu: samples\nmcu -> cloud: upload\n```");
    await page.keyboard.type("\nbroken -> {");
    await expect(d2.locator(".note-drawn-preview")).toContainText(/D2 couldn't draw this diagram: Line 5: /u, { timeout: 30_000 });
    expect(notes.errors).toEqual([]);
  });

  test("draws D2 with its dark theme in dark mode", async ({ notes }) => {
    await openSketches(notes, "?theme=dark");
    const image = notes.drawn("d2").locator("img.note-d2");
    await expect(image).toBeVisible({ timeout: 30_000 });
    const svg = decodeURIComponent((await image.getAttribute("src"))?.replace(/^data:image\/svg\+xml;charset=utf-8,/u, "") ?? "");
    expect(svg).toContain("<svg");
    expect(await image.evaluate((node) => getComputedStyle(node).filter)).toBe("none");
  });

  for (const [query, option, markdown] of SLASH) {
    test(`inserts a ${query} block from the slash menu and saves its fence`, async ({ notes }) => {
      await notes.open();
      await notes.openNote("Abstract draft");
      await notes.newParagraph();
      await notes.slash(query, option);
      await expect.poll(() => notes.text("abstract")).toMatch(markdown);
      expect(notes.errors).toEqual([]);
    });
  }
});
