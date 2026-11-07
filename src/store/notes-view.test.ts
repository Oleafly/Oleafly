import { afterEach, describe, expect, it } from "vitest";
import { useNotesViewStore } from "./notes-view";

const initial = useNotesViewStore.getState();

afterEach(() => {
  useNotesViewStore.setState(initial, true);
});

describe("notes view requests", () => {
  it("starts with no note requested", () => {
    expect(useNotesViewStore.getState().requestedNoteId).toBeNull();
    expect(useNotesViewStore.getState().take()).toBeNull();
  });

  it("hands a requested note over once", () => {
    useNotesViewStore.getState().request("note-1");
    expect(useNotesViewStore.getState().requestedNoteId).toBe("note-1");
    expect(useNotesViewStore.getState().take()).toBe("note-1");
    expect(useNotesViewStore.getState().requestedNoteId).toBeNull();
    expect(useNotesViewStore.getState().take()).toBeNull();
  });

  it("keeps only the latest request", () => {
    useNotesViewStore.getState().request("note-1");
    useNotesViewStore.getState().request("note-2");
    expect(useNotesViewStore.getState().take()).toBe("note-2");
  });

  it("clears a request when asked for no note", () => {
    useNotesViewStore.getState().request("note-1");
    useNotesViewStore.getState().request(null);
    expect(useNotesViewStore.getState().take()).toBeNull();
  });

  it("leaves the store alone when nothing was requested", () => {
    let changes = 0;
    const stop = useNotesViewStore.subscribe(() => {
      changes += 1;
    });
    useNotesViewStore.getState().take();
    stop();
    expect(changes).toBe(0);
  });
});
