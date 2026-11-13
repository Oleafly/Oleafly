import type { OpenNoteEditor } from "@/lib/open-note-editors";

export function noteEditorHandle(overrides: Partial<OpenNoteEditor> = {}): OpenNoteEditor {
  return {
    editor: {} as OpenNoteEditor["editor"],
    root: null,
    text: () => "",
    flush: async () => null,
    busy: () => false,
    history: () => {},
    title: () => "Note",
    timedOut: () => "Note timed out",
    ...overrides,
  };
}
