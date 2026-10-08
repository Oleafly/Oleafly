// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appModalCoordinator } from "@/components/ui/use-modal-accessibility";

const editor = vi.hoisted(() => ({ focus: vi.fn(), view: true }));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: () => (editor.view ? { focus: editor.focus } : null),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return { useFilesStore: create(() => ({ projectId: "p1" as string | null })) };
});
vi.mock("@/store/tours", async () => {
  const { create } = await import("zustand");
  return { useTourStore: create(() => ({ activeTourId: null as string | null })) };
});
vi.mock("@/store/compile", async () => {
  const { create } = await import("zustand");
  return { useCompileStore: create(() => ({ status: "idle", recompile: vi.fn() })) };
});

import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useZenStore } from "@/store/zen";
import { enterZenMode } from "@/lib/zen-mode";
import { ZenSession } from "./ZenSession";

const PROJECT_LAYOUT = {
  showTree: true,
  railTab: "files" as const,
  assistantOpen: true,
  workspaceHidden: false,
  viewMode: "editor" as const,
  terminalOpen: false,
  vim: false,
  zenFullScreen: false,
  zenCenterEditor: true,
  zenShowPdfOnCompile: true,
};

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function zenIsOn() {
  return useZenStore.getState().active;
}

beforeEach(() => {
  editor.focus.mockClear();
  editor.view = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  useFilesStore.setState({ projectId: "p1" });
  useCompileStore.setState({ status: "idle" });
  useSettingsStore.setState(PROJECT_LAYOUT);
  useZenStore.getState().end();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("leaving Zen mode with Escape", () => {
  beforeEach(() => {
    enterZenMode();
    render(<ZenSession />);
  });

  it("leaves on a second Escape within half a second", () => {
    press("Escape");
    expect(zenIsOn()).toBe(true);
    vi.advanceTimersByTime(499);
    press("Escape");
    expect(zenIsOn()).toBe(false);
    expect(useSettingsStore.getState()).toMatchObject({ showTree: true, assistantOpen: true });
  });

  it("stays on after a single Escape", () => {
    press("Escape");
    vi.advanceTimersByTime(5_000);
    expect(zenIsOn()).toBe(true);
  });

  it("does not pair two presses that are more than half a second apart", () => {
    press("Escape");
    vi.advanceTimersByTime(501);
    press("Escape");
    expect(zenIsOn()).toBe(true);
    vi.advanceTimersByTime(100);
    press("Escape");
    expect(zenIsOn()).toBe(false);
  });

  it("ignores other keys between the presses", () => {
    press("Escape");
    press("a");
    press("Escape");
    expect(zenIsOn()).toBe(false);
  });

  it("does not count held-down key repeats", () => {
    press("Escape");
    press("Escape", { repeat: true });
    expect(zenIsOn()).toBe(true);
  });

  it("does not count the Escape that ends an input method composition", () => {
    press("Escape");
    press("Escape", { isComposing: true });
    expect(zenIsOn()).toBe(true);
  });

  it("does not count Escape pressed with a modifier", () => {
    press("Escape");
    press("Escape", { shiftKey: true });
    expect(zenIsOn()).toBe(true);
  });

  it("does not count an Escape another handler already used", () => {
    const consume = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", consume, { once: true });
    const used = press("Escape");
    expect(used.defaultPrevented).toBe(true);
    press("Escape");
    expect(zenIsOn()).toBe(true);
    press("Escape");
    expect(zenIsOn()).toBe(false);
  });

  it("does not count Escape that closes a modal dialog", () => {
    const id = appModalCoordinator.add(null);
    try {
      press("Escape");
      press("Escape");
      expect(zenIsOn()).toBe(true);
    } finally {
      appModalCoordinator.remove(id);
    }
    press("Escape");
    press("Escape");
    expect(zenIsOn()).toBe(false);
  });

  it.each([
    ['<div role="dialog"></div>', "a dialog"],
    ['<div role="alertdialog"></div>', "an alert dialog"],
    ['<div role="menu"></div>', "a menu"],
    ['<div role="listbox"></div>', "a list"],
    ['<div class="cm-tooltip-autocomplete"></div>', "the autocomplete list"],
  ])("does not count Escape while %s is open", (markup) => {
    document.body.innerHTML = markup;
    press("Escape");
    press("Escape");
    expect(zenIsOn()).toBe(true);
    document.body.innerHTML = "";
    press("Escape");
    press("Escape");
    expect(zenIsOn()).toBe(false);
  });

  it("leaves Escape to Vim while the source editor has focus in Vim mode", () => {
    useSettingsStore.setState({ vim: true });
    document.body.innerHTML = '<div class="cm-editor"><div class="cm-content" id="source"></div></div>';
    const source = document.getElementById("source") as HTMLElement;
    press("Escape", {}, source);
    press("Escape", {}, source);
    expect(zenIsOn()).toBe(true);
    press("Escape");
    press("Escape");
    expect(zenIsOn()).toBe(false);
  });

  it("counts Escape in the source editor when Vim mode is off", () => {
    document.body.innerHTML = '<div class="cm-editor"><div class="cm-content" id="source"></div></div>';
    const source = document.getElementById("source") as HTMLElement;
    press("Escape", {}, source);
    press("Escape", {}, source);
    expect(zenIsOn()).toBe(false);
  });

  it("leaves Escape to a terminal that has focus", () => {
    document.body.innerHTML = '<div class="xterm"><textarea id="term"></textarea></div>';
    const terminal = document.getElementById("term") as HTMLElement;
    press("Escape", {}, terminal);
    press("Escape", {}, terminal);
    expect(zenIsOn()).toBe(true);
  });
});

describe("the PDF pane on the first compile", () => {
  beforeEach(() => {
    useSettingsStore.setState({ viewMode: "editor" });
    enterZenMode();
  });

  it("leaves the PDF closed when a compile starts on its own", () => {
    render(<ZenSession />);
    act(() => useCompileStore.setState({ status: "compiling" }));
    act(() => useCompileStore.setState({ status: "success" }));
    act(() => useCompileStore.setState({ status: "compiling" }));
    expect(useSettingsStore.getState().viewMode).toBe("editor");
  });

  it("does not touch a PDF that was showing when Zen began", () => {
    useZenStore.getState().end();
    useSettingsStore.setState({ viewMode: "split" });
    enterZenMode();
    render(<ZenSession />);
    act(() => useCompileStore.setState({ status: "compiling" }));
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("closes the compile log once a compile succeeds", () => {
    render(<ZenSession />);
    act(() => useZenStore.getState().setLogsOpen(true));
    act(() => useCompileStore.setState({ status: "error" }));
    expect(useZenStore.getState().logsOpen).toBe(true);
    act(() => useCompileStore.setState({ status: "success" }));
    expect(useZenStore.getState().logsOpen).toBe(false);
  });
});

describe("focus when Zen mode begins", () => {
  it("puts the cursor back in the editor when nothing else has focus", async () => {
    enterZenMode();
    render(<ZenSession />);
    await vi.waitFor(() => expect(editor.focus).toHaveBeenCalledOnce());
  });

  it("leaves focus alone when something else already has it", async () => {
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    enterZenMode();
    render(<ZenSession />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it("copes with no editor on screen", async () => {
    editor.view = false;
    enterZenMode();
    render(<ZenSession />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(editor.focus).not.toHaveBeenCalled();
  });
});

describe("the end of the session", () => {
  it("stops listening for Escape when it unmounts", () => {
    enterZenMode();
    const view = render(<ZenSession />);
    view.unmount();
    press("Escape");
    press("Escape");
    expect(zenIsOn()).toBe(true);
  });
});
