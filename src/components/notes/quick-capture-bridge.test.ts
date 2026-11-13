// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configure = vi.fn(async () => ({ supported: true, registered: true, command: null, failure: null }));
const emitTo = vi.fn(async () => undefined);
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const openNotes = vi.fn(async () => undefined);

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: (...args: unknown[]) => emitTo(...(args as [])),
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return () => {
      listeners.delete(name);
    };
  }),
}));

vi.mock("@/features/open-tool", () => ({ openNotes: () => openNotes() }));

function heard(name: string, payload: unknown = null): void {
  listeners.get(name)?.({ payload });
}

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  quickCaptureConfigure: (...args: unknown[]) => configure(...(args as [])),
}));

const saveCapture = vi.fn(async () => "note-1");
vi.mock("./quick-capture-save", () => ({ appCaptureDeps: async () => ({}), saveCapture: (...args: unknown[]) => saveCapture(...(args as [])) }));

const { startQuickCaptureBridge, wantedShortcut } = await import("./quick-capture-bridge");
const { useQuickCaptureStore } = await import("@/store/quick-capture");
const { useSettingsStore } = await import("@/store/settings");
const { useShortcutStore } = await import("@/store/shortcuts");

beforeEach(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  useShortcutStore.getState().resetAll();
  useQuickCaptureStore.setState({ enabled: true, status: null });
  useSettingsStore.setState({ notes: true });
  configure.mockClear();
  emitTo.mockClear();
  saveCapture.mockClear();
  openNotes.mockClear();
});

afterEach(() => useSettingsStore.setState({ notes: false }));

describe("wantedShortcut", () => {
  it("asks for the binding as a native accelerator only while Notes and quick capture are on", () => {
    expect(wantedShortcut()).toEqual({ enabled: true, accelerator: "Cmd+Shift+Alt+Space" });
    useQuickCaptureStore.setState({ enabled: false });
    expect(wantedShortcut()).toEqual({ enabled: false, accelerator: null });
    useQuickCaptureStore.setState({ enabled: true });
    useSettingsStore.setState({ notes: false });
    expect(wantedShortcut()).toEqual({ enabled: false, accelerator: null });
  });
});

describe("startQuickCaptureBridge", () => {
  it("registers once, follows changes and keeps the backend's answer", async () => {
    const stop = await startQuickCaptureBridge();
    await vi.waitFor(() => expect(useQuickCaptureStore.getState().status?.registered).toBe(true));
    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenLastCalledWith(true, "Cmd+Shift+Alt+Space");
    useSettingsStore.setState({ latexTools: true });
    useShortcutStore.getState().setBinding("notesQuickCapture", { key: "k", mod: true, shift: true });
    await vi.waitFor(() => expect(configure).toHaveBeenLastCalledWith(true, "Cmd+Shift+K"));
    expect(configure).toHaveBeenCalledTimes(2);
    useSettingsStore.setState({ notes: false });
    await vi.waitFor(() => expect(configure).toHaveBeenLastCalledWith(false, null));
    stop();
  });

  it("saves a capture from the window and answers it by id", async () => {
    const stop = await startQuickCaptureBridge();
    heard("notes:quick-capture", { id: "r1", text: "Hello", target: "today" });
    heard("notes:quick-capture", { id: "bad", target: "today" });
    await vi.waitFor(() => expect(emitTo).toHaveBeenCalledWith("quick-capture", "notes:quick-captured", { id: "r1", noteId: "note-1" }));
    expect(saveCapture).toHaveBeenCalledTimes(1);
    stop();
  });

  it("answers with an error while Notes is off", async () => {
    const stop = await startQuickCaptureBridge();
    useSettingsStore.setState({ notes: false });
    heard("notes:quick-capture", { id: "r2", text: "Hello", target: "new" });
    await vi.waitFor(() =>
      expect(emitTo).toHaveBeenCalledWith("quick-capture", "notes:quick-captured", expect.objectContaining({ id: "r2", error: expect.any(String) })),
    );
    expect(saveCapture).not.toHaveBeenCalled();
    stop();
  });

  it("opens Notes when the capture window asks, while Notes is on", async () => {
    const stop = await startQuickCaptureBridge();
    heard("notes:quick-capture-open-notes");
    expect(openNotes).toHaveBeenCalledTimes(1);
    useSettingsStore.setState({ notes: false });
    heard("notes:quick-capture-open-notes");
    expect(openNotes).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.has("notes:quick-capture-open-notes")).toBe(false);
  });
});
