import { expect, type NotesPage, test } from "../notes-page";

const HEADINGS = [
  "Charts",
  "Function plots",
  "Tables",
  "Math and chemistry",
  "Typst",
  "Diagrams",
  "SVG",
  "HTML, press Run",
  "React, press Run",
  "Chemical structures",
  "3D molecule",
  "Sequences",
  "Code",
];

const BLOCKS = ["chart", "chart", "chart", "chart", "plot", "plot", "csv", "latex", "latex", "typst", "mermaid", "mermaid", "svg", "html", "jsx", "smiles", "molecule", "sequence"];

function listed(notes: NotesPage): Promise<{ id: string; title: string }[]> {
  return notes.page.evaluate(() =>
    (window as unknown as { __notes: { snapshot(): { notes: { id: string; title: string }[] } } }).__notes
      .snapshot()
      .notes.map(({ id, title }) => ({ id, title })),
  );
}

async function titles(notes: NotesPage): Promise<string[]> {
  return (await listed(notes)).map((note) => note.title);
}

test.describe("Notes starter note", () => {
  test("the first open adds one Blocks gallery that holds every block", async ({ notes }) => {
    await notes.open("?starter");
    const gallery = (await listed(notes)).filter((note) => note.title === "Blocks gallery");
    expect(gallery).toHaveLength(1);
    const id = gallery[0].id;
    const written = await notes.text(id);

    await notes.openNote("Blocks gallery");
    await expect(notes.firstParagraph).toHaveText(
      "Every block a note can hold. Click Source on a block to see and edit what draws it, and type / on an empty line to insert a new one.",
    );
    await expect(notes.editor.locator("h2")).toHaveText(HEADINGS);
    const drawn = notes.editor.locator("[data-block]");
    await expect(drawn).toHaveCount(BLOCKS.length);
    expect(await drawn.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.block))).toEqual(BLOCKS);
    for (let index = 0; index < BLOCKS.length; index += 1) await drawn.nth(index).scrollIntoViewIfNeeded();
    await expect(notes.drawn("mermaid").first().locator(".note-drawn-preview svg").first()).toBeVisible({ timeout: 30_000 });
    await expect(notes.drawn("latex").first().locator(".katex").first()).toBeVisible();
    await expect(notes.editor.locator("table").first()).toBeVisible();
    await notes.page.waitForTimeout(1_500);
    expect(await notes.saves(id)).toBe(0);
    expect(await notes.text(id)).toBe(written);
  });

  test("leaves the library alone when the harness does not ask for it", async ({ notes }) => {
    await notes.open();
    expect(await titles(notes)).not.toContain("Blocks gallery");
  });
});
