import { expect, type NotesPage, test } from "../notes-page";
const REMOTE_IMAGE = "https://images.example.com/sweep.png";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function outsideEdit(notes: NotesPage, id: string, from: string, to: string): Promise<string> {
  return notes.text(id).then(async (before) => {
    const after = before.replace(from, to);
    await notes.writeFromDisk(id, after);
    return after;
  });
}

test.describe("Notes review", () => {

  test("leaves an outside change on disk as written until it is rejected", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Masking strategy report");
    const before = await notes.text("masking");
    const after = await outsideEdit(notes, "masking", "sampled per pixel", "sampled per patch");
    await expect(notes.page.locator(".note-diff-insert")).toContainText("patch");
    await expect(notes.editor).toContainText("per pixel");
    await expect(notes.page.locator(".note-diff-insert")).toBeVisible();
    expect(await notes.text("masking")).toBe(after);
    expect(await notes.saves("masking")).toBe(0);
    await notes.button("Reject").click();
    await expect.poll(() => notes.text("masking")).toBe(before);
  });

  test("keeps an outside change when it is accepted", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Masking strategy report");
    const after = await outsideEdit(notes, "masking", "sampled per pixel", "sampled per patch");
    await notes.button("Accept").click();
    await expect(notes.editor).toContainText("per patch");
    await expect(notes.page.locator('[data-note-view="masking"] [data-note-save-status="saved"]')).toBeVisible();
    await expect.poll(() => notes.text("masking")).toBe(after);
  });

  test("keeps an outside change reviewable while the person types elsewhere, and writes only their paragraph", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.firstParagraph.click();
    await page.keyboard.press("End");
    const after = await outsideEdit(notes, "masking", "sampled per pixel", "sampled per patch");
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await page.keyboard.type(" Run 4 is queued.");
    await expect.poll(() => notes.text("masking")).toContain("and run 3 reached 64.1%. Run 4 is queued.");
    expect(await notes.text("masking")).toContain("sampled per patch");
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await notes.button("Reject").click();
    await expect.poll(() => notes.text("masking")).toContain("sampled per pixel");
    expect(await notes.text("masking")).toContain("Run 4 is queued.");
    expect(after).not.toContain("Run 4 is queued.");
  });

  test("brings back an outside change that was not reviewed when the note is closed and opened again", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await outsideEdit(notes, "masking", "sampled per pixel", "sampled per patch");
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await page.getByRole("button", { name: /^Close Masking strategy report/ }).click();
    await expect(notes.tabs).toHaveText(["Home"]);
    await notes.openNote("Masking strategy report");
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await notes.button("Accept").click();
    await expect.poll(() => notes.text("masking")).toContain("sampled per patch");
  });

  for (const [kind, reason] of [
    ["permission", "Permission denied (os error 13)"],
    ["full", "No space left on device (os error 28)"],
  ] as const) {
  }

  test("saves again after a write that ran into an unchanged file on disk", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.failNextWrite("conflict");
    await notes.firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Kept.");
    await expect.poll(() => notes.text("abstract")).toContain("up to a point. Kept.");
    await expect(notes.diffs).toHaveCount(0);
    await expect(page.getByText(/^Not saved/u)).toHaveCount(0);
  });

  test("holds back a web image in an outside change until it is loaded", async ({ notes }) => {
    const { page } = notes;
    const requests: string[] = [];
    await page.route(REMOTE_IMAGE, (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: "image/png", body: PNG });
    });
    await notes.open();
    await notes.openNote("Abstract draft");
    await outsideEdit(notes, "abstract", "## Contributions", `![Sweep](${REMOTE_IMAGE})\n\n## Contributions`);
    const held = notes.editor.getByText("Image from images.example.com");
    await expect(held).toBeVisible();
    await expect(notes.editor.locator(`img[src="${REMOTE_IMAGE}"]`)).toHaveCount(0);
    expect(requests).toEqual([]);
    await notes.editor.getByRole("button", { name: "Load image", exact: true }).click();
    await expect(notes.editor.locator(`img[src="${REMOTE_IMAGE}"]`)).toBeVisible();
    expect(requests).toEqual([REMOTE_IMAGE]);
  });
});
