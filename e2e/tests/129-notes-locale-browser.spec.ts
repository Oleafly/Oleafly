import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../notes-page";

const JA = JSON.parse(readFileSync(join(process.cwd(), "src/i18n/locales/ja/notes.json"), "utf8")) as {
  workspace: { home: string };
  document: { titleLabel: string };
  toolbar: { label: string };
};
const KEY_PATH = /\b(?:notes|common|editor|ai|shell|cloud|collab)[:.][a-z]\w*\.[a-z]\w*/u;

test.describe("Notes in other languages", () => {
  test("shows Home, the editor and its menus in Japanese with no raw keys", async ({ notes }) => {
    const { page } = await notes.open("?lang=ja");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("ja");
    await expect(page.getByRole("heading", { name: JA.workspace.home })).toBeVisible();
    await notes.sidebar.getByRole("button", { name: /Abstract draft/ }).click();
    await expect(page.getByRole("textbox", { name: JA.document.titleLabel })).toHaveValue("Abstract draft");
    const toolbar = page.getByRole("toolbar", { name: JA.toolbar.label }).filter({ visible: true });
    await expect(toolbar).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(KEY_PATH);
    await notes.newParagraph();
    await page.keyboard.type("/");
    await expect(page.getByRole("listbox").filter({ visible: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(KEY_PATH);
  });

  test("commits a Japanese IME composition once and saves it", async ({ notes, browserName }) => {
    test.skip(browserName !== "chromium", "IME composition is driven through the Chromium DevTools protocol");
    const { page } = await notes.open("?lang=ja");
    await notes.sidebar.getByRole("button", { name: /Abstract draft/ }).click();
    await notes.caretAtEnd();
    const session = await page.context().newCDPSession(page);
    for (const text of ["に", "にほ", "にほん"]) {
      await session.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await session.send("Input.insertText", { text: "日本" });
    await expect.poll(() => notes.text("abstract")).toContain("up to a point.日本\n");
    const saved = await notes.text("abstract");
    expect(saved.split("日本")).toHaveLength(2);
    expect(saved).not.toMatch(/[にほん]/u);
  });

  test("saves Arabic text typed into a note as written", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.newParagraph();
    await page.keyboard.insertText("نسبة القناع ٠٫٧٥");
    await expect.poll(() => notes.text("abstract")).toContain("up to a point.\n\nنسبة القناع ٠٫٧٥\n");
  });
});
