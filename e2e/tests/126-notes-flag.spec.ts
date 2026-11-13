import { expect, test } from "../fixtures";
import type { Page } from "../helpers";
import { createNote, notesEnabled, openNotes, recycleNote, setNotesInSettings } from "../notes-app";
import { scriptValue } from "../script-value";

function railShowsNotes(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(
    `(() => { const dock = document.querySelector('[data-testid="open-notes"]'); return dock instanceof HTMLElement && dock.getClientRects().length > 0; })()`,
  );
}

function noteOpen(page: Page, noteId: string): Promise<boolean> {
  return page.evaluate<boolean>(
    `Array.from(document.querySelectorAll("[data-note-view]")).some((view) => view.getAttribute("data-note-view") === ${scriptValue(noteId)} && view.getClientRects().length > 0)`,
  );
}

test("Notes turns on without a restart, closes its tabs when turned off, and brings the note back when turned on again", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  const startedOn = await notesEnabled(tauriPage);
  let noteId = "";
  try {
    if (startedOn) await setNotesInSettings(tauriPage, false);
    await expect.poll(() => railShowsNotes(tauriPage), { timeout: 10_000 }).toBe(false);

    await setNotesInSettings(tauriPage, true);
    await expect.poll(() => railShowsNotes(tauriPage), { timeout: 20_000 }).toBe(true);
    await openNotes(tauriPage);
    noteId = await createNote(tauriPage);
    await expect.poll(() => noteOpen(tauriPage, noteId)).toBe(true);

    await setNotesInSettings(tauriPage, false);
    await expect.poll(() => noteOpen(tauriPage, noteId), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => railShowsNotes(tauriPage), { timeout: 10_000 }).toBe(false);
    await tauriPage.waitForFunction(`document.querySelector('[data-testid="library"]') !== null`, 20_000);

    await setNotesInSettings(tauriPage, true);
    await openNotes(tauriPage);
    await expect
      .poll(
        () =>
          tauriPage.evaluate<boolean>(
            `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().projects.some((project) => project.id === ${scriptValue(noteId)}))`,
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
  } finally {
    if (noteId) await recycleNote(tauriPage, noteId).catch(() => undefined);
    await setNotesInSettings(tauriPage, startedOn).catch(() => undefined);
  }
});
