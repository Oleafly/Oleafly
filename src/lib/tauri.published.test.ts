import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import * as tauri from "./tauri-collab";

const SERVER = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f60";
const NOTE = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f69";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
});

describe("published note IPC contract", () => {
  it.each([
    ["collabPublishedNotes", () => tauri.collabPublishedNotes(SERVER), "collab_published_notes", { serverId: SERVER }],
    [
      "collabPublishNote",
      () => tauri.collabPublishNote(SERVER, { source: "note-1", title: "Field notes", html: "<p>x</p>" }),
      "collab_publish_note",
      { serverId: SERVER, source: "note-1", title: "Field notes", html: "<p>x</p>" },
    ],
    [
      "collabUnpublishNote",
      () => tauri.collabUnpublishNote(SERVER, NOTE),
      "collab_unpublish_note",
      { serverId: SERVER, noteId: NOTE },
    ],
    [
      "collabAdminPublishedNotes",
      () => tauri.collabAdminPublishedNotes(SERVER),
      "collab_admin_published_notes",
      { serverId: SERVER },
    ],
    [
      "collabAdminSetNoteTakenDown",
      () => tauri.collabAdminSetNoteTakenDown(SERVER, NOTE, true),
      "collab_admin_set_note_taken_down",
      { serverId: SERVER, noteId: NOTE, takenDown: true },
    ],
  ] as const)("sends %s", async (_label, call, command, args) => {
    await call();
    expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });

  it("registers every published note command the bridge calls", () => {
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    const registered = [...read("../../src-tauri/src/lib.rs").matchAll(/collab::published::(collab_[a-z_]+)/g)].map(
      (match) => match[1],
    );
    expect(registered).toEqual([
      "collab_published_notes",
      "collab_publish_note",
      "collab_unpublish_note",
      "collab_admin_published_notes",
      "collab_admin_set_note_taken_down",
    ]);
    const defined = [...read("../../src-tauri/src/collab/published.rs").matchAll(/pub async fn (collab_[a-z_]+)/g)].map(
      (match) => match[1],
    );
    expect(defined).toEqual(registered);
    for (const code of ["public_notes_off", "too_many_pages", "page_too_large", "page_taken_down"]) {
      expect(tauri.isCollabCommandError({ code, message: "" })).toBe(true);
    }
  });
});
