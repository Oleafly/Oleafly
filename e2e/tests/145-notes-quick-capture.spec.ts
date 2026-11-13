import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { TauriPage } from "@srsholmes/tauri-playwright";
import { expect, test } from "../fixtures";
import { chooseCommandPaletteItem, fillCommandPalette, pressGlobal } from "../helpers";
import { noteFile, recycleNote, turnNotesOff, turnNotesOn } from "../notes-app";
import { scriptValue } from "../script-value";

const WINDOW = "quick-capture";
const COMMAND = "Quick capture";
const CAPTURE_EVENT = "notes:quick-capture";
const CAPTURED_EVENT = "notes:quick-captured";
const TITLE = "Captured from the floating window";
const BODY = "It lands in the library as its own note.";

interface ShortcutStatus {
  supported: boolean;
  registered: boolean;
  command: string | null;
  failure: string | null;
}

interface CaptureRequest {
  id: string;
  text: string;
  target: "new";
}

interface CaptureReply {
  id: string;
  noteId?: string;
  error?: string;
}

function waylandSession(): boolean {
  return (
    process.platform === "linux" &&
    (Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland")
  );
}

function shortcutOutcome(status: ShortcutStatus | null): string {
  if (!status) return "pending";
  if (!status.supported) return "unsupported";
  if (status.registered) return "registered";
  return status.failure ?? "pending";
}

function shortcutStatus(page: TauriPage): Promise<ShortcutStatus | null> {
  return page.evaluate<ShortcutStatus | null>(
    `import("/src/store/quick-capture.ts").then(({ useQuickCaptureStore }) => useQuickCaptureStore.getState().status)`,
  );
}

async function captureWindow(page: TauriPage): Promise<{ visible: boolean; url: string } | null> {
  const found = (await page.listWindows()).find((candidate) => candidate.label === WINDOW);
  return found ? { visible: found.visible, url: found.url } : null;
}

function capturedNotes(page: TauriPage): Promise<string[]> {
  return page.evaluate<string[]>(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().projects.filter((project) => project.kind === "note" && project.name === ${scriptValue(TITLE)}).map((project) => project.id))`,
  );
}

function homePage(page: TauriPage): Promise<string> {
  return page.evaluate<string>(`import("/src/store/home-view.ts").then(({ useHomeViewStore }) => useHomeViewStore.getState().page)`);
}

function sendCapture(page: TauriPage, request: CaptureRequest): Promise<CaptureReply> {
  return page.evaluate<CaptureReply>(
    `new Promise((resolve, reject) => {
      const internals = window.__TAURI_INTERNALS__;
      const request = ${scriptValue(request)};
      const reply = ${scriptValue(CAPTURED_EVENT)};
      let eventId = null;
      const stop = () => {
        if (eventId === null) return;
        window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener(reply, eventId);
        void internals.invoke("plugin:event|unlisten", { event: reply, eventId });
      };
      const timer = setTimeout(() => {
        stop();
        reject(new Error("the main window never answered the capture"));
      }, 15000);
      const handler = internals.transformCallback((event) => {
        if (!event.payload || event.payload.id !== request.id) return;
        clearTimeout(timer);
        stop();
        resolve(event.payload);
      });
      internals
        .invoke("plugin:event|listen", { event: reply, target: { kind: "Any" }, handler })
        .then((id) => {
          eventId = id;
          return internals.invoke("plugin:event|emit_to", {
            target: { kind: "AnyLabel", label: "main" },
            event: ${scriptValue(CAPTURE_EVENT)},
            payload: request,
          });
        })
        .catch((error) => {
          clearTimeout(timer);
          stop();
          reject(error);
        });
    })`,
  );
}

test("quick capture opens its window from the command, and the main window saves what the window sends as a library note", async ({
  tauriPage,
}) => {
  test.setTimeout(150_000);
  const page = tauriPage as TauriPage;
  const turnedOn = await turnNotesOn(page);
  try {
    await expect
      .poll(async () => shortcutOutcome(await shortcutStatus(page)), {
        message: "the shortcut registers once Notes is on, unless another app holds it or the session is Wayland",
        timeout: 20_000,
      })
      .toMatch(waylandSession() ? /^unsupported$/u : /^(?:registered|taken)$/u);
    expect((await shortcutStatus(page))?.command ?? "").toMatch(/ --quick-capture$/u);

    await pressGlobal(page, "k", { meta: true });
    await fillCommandPalette(page, COMMAND);
    await chooseCommandPaletteItem(page, COMMAND);
    await expect
      .poll(() => captureWindow(page), { message: "the command opens the floating capture window", timeout: 30_000 })
      .toMatchObject({ visible: true, url: expect.stringContaining("view=capture") });

    const request: CaptureRequest = { id: randomUUID(), text: `${TITLE}\n\n${BODY}`, target: "new" };
    const reply = await sendCapture(page, request);
    expect(reply.error, "the main window saved the capture").toBeUndefined();
    expect(reply.id).toBe(request.id);
    const noteId = reply.noteId ?? "";
    expect(noteId, "the reply names the new note").not.toBe("");
    await expect.poll(() => capturedNotes(page), { message: "the captured note reaches the library", timeout: 20_000 }).toEqual([noteId]);
    const saved = readFileSync(await noteFile(page, noteId), "utf8");
    expect(saved).toMatch(new RegExp(String.raw`^title: ${TITLE}\r?$`, "mu"));
    expect(saved).toContain(BODY);
    expect(saved, "the title line is not repeated in the body").not.toMatch(new RegExp(String.raw`^${TITLE}\r?$`, "mu"));

    await page.evaluate(`import("/src/store/home-view.ts").then(({ useHomeViewStore }) => { useHomeViewStore.getState().goTo("library"); return true; })`);
    await expect.poll(() => homePage(page)).toBe("library");
    await page.evaluate(`import("/src/lib/tauri.ts").then(({ quickCaptureOpenNotes }) => quickCaptureOpenNotes()).then(() => true)`);
    await expect
      .poll(() => homePage(page), { message: "Open Notes from the capture window opens Notes in the main window", timeout: 20_000 })
      .toBe("notes");
    const listed = `[data-note-row="${noteId}"], [data-note-card="${noteId}"], [data-note-list-row="${noteId}"]`;
    await expect
      .poll(() => page.evaluate<boolean>(`document.querySelector(${scriptValue(listed)}) !== null`), {
        message: "the captured note is listed in Notes",
        timeout: 20_000,
      })
      .toBe(true);
  } finally {
    for (const id of await capturedNotes(page).catch(() => [])) await recycleNote(page, id).catch(() => undefined);
    if (turnedOn) await turnNotesOff(page);
  }
});
