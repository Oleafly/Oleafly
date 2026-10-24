// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useShortcutStore } from "@/store/shortcuts";
import { isAllowListedTerminalShortcut, terminalOwnsKey } from "./terminal-shortcut-guard";

let platform = "Win32";

beforeAll(() => {
  Object.defineProperty(window.navigator, "platform", { configurable: true, get: () => platform });
});

afterAll(() => {
  delete (window.navigator as unknown as Record<string, unknown>).platform;
});

function owns(target: Element, init: KeyboardEventInit): boolean {
  let owned = false;
  const listener = (event: Event) => {
    owned = terminalOwnsKey(event as KeyboardEvent);
  };
  target.addEventListener("keydown", listener);
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  target.removeEventListener("keydown", listener);
  return owned;
}

describe("terminal shortcut guard", () => {
  let textarea: HTMLTextAreaElement;
  let outside: HTMLInputElement;

  beforeEach(() => {
    platform = "Win32";
    useShortcutStore.getState().resetAll();
    document.body.innerHTML = "";
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    textarea = document.createElement("textarea");
    xterm.append(textarea);
    outside = document.createElement("input");
    document.body.append(xterm, outside);
  });

  it("keeps terminal keys in a focused terminal on Windows and Linux", () => {
    expect(owns(textarea, { key: "b", ctrlKey: true })).toBe(true);
    expect(owns(textarea, { key: "z", ctrlKey: true })).toBe(true);
    expect(owns(textarea, { key: "F11", shiftKey: true })).toBe(true);
    expect(owns(textarea, { key: "p", ctrlKey: true, altKey: true })).toBe(true);
    expect(owns(textarea, { key: "`", ctrlKey: true })).toBe(false);
    expect(owns(textarea, { key: "=", ctrlKey: true })).toBe(false);
    expect(owns(textarea, { key: "~", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(owns(textarea, { key: "w", ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it("keeps Ctrl+K and Ctrl+PageUp/PageDown for the program on Windows and Linux", () => {
    for (const os of ["Win32", "Linux x86_64"]) {
      platform = os;
      // Ctrl+K is kill-line in readline and cut in nano; vim switches tabs on Ctrl+PageDown.
      expect(owns(textarea, { key: "k", ctrlKey: true })).toBe(true);
      expect(owns(textarea, { key: "PageDown", ctrlKey: true })).toBe(true);
      expect(owns(textarea, { key: "PageUp", ctrlKey: true })).toBe(true);
    }
    platform = "MacIntel";
    expect(owns(textarea, { key: "PageDown", ctrlKey: true })).toBe(false);
  });

  it("never claims keys outside a terminal", () => {
    for (const init of [
      { key: "b", ctrlKey: true },
      { key: "z", ctrlKey: true },
      { key: "F11", shiftKey: true },
    ]) {
      expect(owns(outside, init)).toBe(false);
    }
  });

  it("leaves Cmd shortcuts to the app on macOS except the terminal's own", () => {
    platform = "MacIntel";
    expect(owns(textarea, { key: "b", metaKey: true })).toBe(false);
    expect(owns(textarea, { key: "k", metaKey: true })).toBe(true);
    expect(owns(textarea, { key: "ArrowLeft", metaKey: true })).toBe(true);
    expect(owns(textarea, { key: "b", ctrlKey: true })).toBe(true);
  });

  it("follows rebound shortcuts", () => {
    expect(owns(textarea, { key: "j", ctrlKey: true, altKey: true })).toBe(true);
    useShortcutStore.getState().setBinding("toggleTerminal", { key: "j", ctrl: true, alt: true });
    expect(isAllowListedTerminalShortcut({
      type: "keydown",
      key: "j",
      code: "KeyJ",
      keyCode: 74,
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
    })).toBe(true);
    expect(owns(textarea, { key: "j", ctrlKey: true, altKey: true })).toBe(false);
  });
});
