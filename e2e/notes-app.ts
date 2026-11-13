import { join } from "node:path";
import { expect } from "./fixtures";
import type { Page } from "./helpers";
import { scriptValue } from "./script-value";

export function inNote(noteId: string, body: string): string {
  return `(() => {
    const view = Array.from(document.querySelectorAll("[data-note-view]")).find(
      (candidate) => candidate.getAttribute("data-note-view") === ${scriptValue(noteId)} && candidate.getClientRects().length > 0,
    );
    const surface = view ? view.querySelector(".note-body .ProseMirror") : null;
    const editor = surface && surface.editor && !surface.editor.isDestroyed ? surface.editor : null;
    ${body}
  })()`;
}

export function notesEnabled(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => useSettingsStore.getState().notes === true)`,
  );
}

export async function setNotesInSettings(page: Page, on: boolean): Promise<void> {
  await page.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => { useSettingsStore.getState().openSettingsAt("experimentation"); return true; })`,
  );
  const toggle = page.getByTestId("settings-notes");
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await page.evaluate(
    `(() => { const toggle = document.querySelector('[data-testid="settings-notes"]'); if (toggle && toggle.getAttribute("aria-checked") !== ${scriptValue(String(on))}) toggle.click(); return true; })()`,
  );
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
  await page.click('[data-testid="settings-close"]');
  await page.waitForFunction(`!document.querySelector('[data-testid="settings-close"]')`, 10_000);
  await expect.poll(() => notesEnabled(page), { timeout: 10_000 }).toBe(on);
}

export async function turnNotesOn(page: Page): Promise<boolean> {
  if (await notesEnabled(page)) return false;
  await setNotesInSettings(page, true);
  return true;
}

export async function turnNotesOff(page: Page): Promise<void> {
  await page
    .evaluate(`import("/src/store/settings.ts").then(({ useSettingsStore }) => { useSettingsStore.getState().setNotes(false); return true; })`)
    .catch(() => undefined);
}

export async function openNotes(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      const ready = Array.from(document.querySelectorAll('button[aria-label="New note"]')).some(
        (button) => !button.disabled && button.getClientRects().length > 0,
      );
      if (ready) return true;
      const library = document.querySelector('[data-testid="library"][data-projects-loaded="true"]');
      const dock = document.querySelector('[data-testid="open-notes"]');
      const last = window.__e2eNotesOpenedAt || 0;
      if (library && dock instanceof HTMLElement && dock.getClientRects().length > 0 && Date.now() - last > 2000) {
        window.__e2eNotesOpenedAt = Date.now();
        dock.click();
      }
      return false;
    })()`,
    60_000,
  );
}

export async function createNote(page: Page): Promise<string> {
  const before = await page.evaluate<string[]>(
    `Array.from(document.querySelectorAll("[data-note-view]"), (view) => view.getAttribute("data-note-view") || "")`,
  );
  await page.waitForFunction(
    `(() => {
      const button = Array.from(document.querySelectorAll('button[aria-label="New note"]')).find(
        (candidate) => !candidate.disabled && candidate.getClientRects().length > 0,
      );
      if (!button) return false;
      button.click();
      return true;
    })()`,
    20_000,
  );
  let noteId = "";
  await expect
    .poll(
      async () => {
        noteId = await page.evaluate<string>(
          `(() => {
            const known = new Set(${scriptValue(before)});
            const view = Array.from(document.querySelectorAll("[data-note-view]")).find((candidate) => {
              const id = candidate.getAttribute("data-note-view") || "";
              if (!id || known.has(id) || candidate.getClientRects().length === 0) return false;
              const surface = candidate.querySelector(".note-body .ProseMirror");
              return Boolean(surface && surface.editor && surface.editor.isEditable);
            });
            return view ? view.getAttribute("data-note-view") : "";
          })()`,
        );
        return noteId;
      },
      { message: "the new note never opened with an editable body", timeout: 30_000 },
    )
    .not.toBe("");
  return noteId;
}

export async function caretAtEnd(page: Page, noteId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate<boolean>(
          inNote(
            noteId,
            `if (!editor) return false;
            editor.commands.focus("end");
            return editor.isFocused;`,
          ),
        ),
      { message: "the caret at the end of the note", timeout: 15_000 },
    )
    .toBe(true);
}

export async function noteFile(page: Page, noteId: string): Promise<string> {
  const root = await page.evaluate<string>(`import("/src/lib/tauri.ts").then(({ libraryRoot }) => libraryRoot())`);
  return join(root, noteId, "note.md");
}

export function noteDiffs(page: Page, noteId: string): Promise<string[]> {
  return page.evaluate<string[]>(
    inNote(noteId, `return surface ? Array.from(surface.querySelectorAll(".note-diff-insert"), (node) => node.textContent || "") : [];`),
  );
}

export async function clickInNote(page: Page, noteId: string, label: string): Promise<void> {
  const clicked = await page.evaluate<boolean>(
    inNote(
      noteId,
      `const button = view ? Array.from(view.querySelectorAll("button")).find((candidate) => candidate.getAttribute("aria-label") === ${scriptValue(label)} || (candidate.textContent || "").trim() === ${scriptValue(label)}) : null;
      if (!button) return false;
      button.click();
      return true;`,
    ),
  );
  expect(clicked, `clicking ${label} in the note`).toBe(true);
}

export async function recycleNote(page: Page, noteId: string): Promise<void> {
  await page.evaluate(
    `Promise.all([import("/src/lib/tauri.ts"), import("/src/store/files.ts")]).then(async ([tauri, files]) => {
      await tauri.recycleProject(${scriptValue(noteId)});
      await files.useFilesStore.getState().refreshProjects();
      return true;
    })`,
  );
}
