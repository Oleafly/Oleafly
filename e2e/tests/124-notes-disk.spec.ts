import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, reloadNativePage, test } from "../fixtures";
import type { TauriPage } from "@srsholmes/tauri-playwright";
import { caretAtEnd, clickInNote, createNote, noteDiffs, noteFile, openNotes, recycleNote, turnNotesOff, turnNotesOn } from "../notes-app";
import { scriptValue } from "../script-value";

const QUIET_MS = 3_000;

function onDisk(path: string): string {
  return readFileSync(path, "utf8");
}

async function typeInNote(page: TauriPage, noteId: string, text: string): Promise<void> {
  await caretAtEnd(page, noteId);
  await page.keyboard.insertText(text);
}

function noteIdOf(text: string): string {
  return /\nid: ([\w-]+)\r?\n/u.exec(text)?.[1] ?? "";
}

test("a typed note reaches its file, outside writes wait for a decision, and the file follows renames and recycling", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  const turnedOn = await turnNotesOn(tauriPage);
  let noteId = "";
  try {
    await openNotes(tauriPage);
    noteId = await createNote(tauriPage);
    const file = await noteFile(tauriPage, noteId);

    await typeInNote(tauriPage, noteId, "alpha beta");
    await expect.poll(() => (existsSync(file) ? onDisk(file) : ""), { timeout: 15_000 }).toContain("alpha beta");
    const typed = onDisk(file);
    expect(typed).toMatch(/^---\n/u);
    expect(typed).toContain("kind: note");
    expect(noteIdOf(typed)).not.toBe("");

    const outside = `${typed.replace(/\r?\n/gu, "\r\n")}\r\ngamma line\r\n`;
    writeFileSync(file, outside);
    await expect.poll(() => noteDiffs(tauriPage, noteId), { timeout: 15_000 }).toContainEqual(expect.stringContaining("gamma line"));
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    expect(onDisk(file), "an outside write stays on disk as written until the person decides").toBe(outside);

    await clickInNote(tauriPage, noteId, "Accept");
    await typeInNote(tauriPage, noteId, " delta");
    await expect.poll(() => onDisk(file), { timeout: 15_000 }).toContain("delta");
    const saved = onDisk(file);
    expect(saved).toContain("gamma line");
    expect(saved.replace(/\r\n/gu, ""), "the file keeps CRLF line endings").not.toContain("\n");
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    expect(await noteDiffs(tauriPage, noteId), "the app's own save is not shown as an outside change").toEqual([]);

    await tauriPage.evaluate(
      `(() => {
        const input = Array.from(document.querySelectorAll('input[aria-label="Note title"]')).find((candidate) => candidate.getClientRects().length > 0);
        if (!input) return false;
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "Disk check");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return true;
      })()`,
    );
    await expect.poll(() => onDisk(file), { timeout: 15_000 }).toMatch(/\r\ntitle: Disk check\r\n/u);

    await typeInNote(tauriPage, noteId, " epsilon");
    await expect.poll(() => onDisk(file), { timeout: 15_000 }).toContain("epsilon");
    const before = onDisk(file);
    await reloadNativePage(tauriPage);
    await openNotes(tauriPage);
    expect(onDisk(file), "reloading the window and opening Notes again leaves the file as saved").toBe(before);

    await recycleNote(tauriPage, noteId);
    expect(existsSync(file), "a recycled note leaves the library").toBe(false);
    const restored = await tauriPage.evaluate<string>(
      `import("/src/lib/tauri.ts").then(async (tauri) => {
        const recycled = await tauri.listRecycledProjects();
        const entry = recycled.find((candidate) => candidate.project_id === ${scriptValue(noteId)});
        return entry ? tauri.restoreRecycledProject(entry.id) : "";
      })`,
    );
    expect(restored).not.toBe("");
    const back = await noteFile(tauriPage, restored);
    expect(onDisk(back), "a restored note comes back unchanged").toBe(before);
    noteId = restored;
  } finally {
    if (noteId) await recycleNote(tauriPage, noteId).catch(() => undefined);
    if (turnedOn) await turnNotesOff(tauriPage);
  }
});
