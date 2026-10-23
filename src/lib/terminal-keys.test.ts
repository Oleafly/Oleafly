// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isInsideTerminalDock,
  isTerminalKey,
  isTerminalTarget,
  routeTerminalKey,
  TERMINAL_DOCK_ATTRIBUTE,
  terminalClaimsKey,
  terminalPlatform,
  type TerminalKeyContext,
  type TerminalKeyEvent,
  type TerminalPlatform,
} from "./terminal-keys";

interface KeyOptions {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  composing?: boolean;
  keyCode?: number;
  code?: string;
  type?: string;
}

const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Backspace: 8,
  Delete: 46,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

function defaultKeyCode(name: string): number {
  if (name in KEY_CODES) return KEY_CODES[name];
  if (name.length === 1 && /[a-z]/i.test(name)) return name.toUpperCase().charCodeAt(0);
  return 0;
}

function key(name: string, options: KeyOptions = {}): TerminalKeyEvent {
  return {
    type: options.type ?? "keydown",
    key: name,
    code: options.code ?? "",
    keyCode: options.keyCode ?? defaultKeyCode(name),
    ctrlKey: Boolean(options.ctrl),
    shiftKey: Boolean(options.shift),
    altKey: Boolean(options.alt),
    metaKey: Boolean(options.meta),
    isComposing: Boolean(options.composing),
  };
}

function ctx(platform: TerminalPlatform, over: Partial<TerminalKeyContext> = {}): TerminalKeyContext {
  return {
    platform,
    shiftEnter: "newline",
    wsl: false,
    hasSelection: false,
    optionIsMeta: false,
    isAppShortcut: () => false,
    ...over,
  };
}

describe("terminal key router", () => {
  it("sends the platform's Shift+Enter newline", () => {
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("windows"))).toEqual({ kind: "send", data: "\x1b\r" });
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("linux"))).toEqual({ kind: "send", data: "\n" });
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("linux", { shellName: "bash" }))).toEqual({
      kind: "send",
      data: "\n",
    });
    // zsh and fish add a line on ESC CR; LF would run the command.
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("linux", { shellName: "zsh" }))).toEqual({
      kind: "send",
      data: "\x1b\r",
    });
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("linux", { shellName: "fish" }))).toEqual({
      kind: "send",
      data: "\x1b\r",
    });
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("mac"))).toEqual({ kind: "send", data: "\x1b\r" });
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("mac", { shellName: "bash" }))).toEqual({
      kind: "send",
      data: "\x1b\r",
    });
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("windows", { wsl: true }))).toEqual({
      kind: "send",
      data: "\n",
    });
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("linux", { shiftEnter: "enter" }))).toEqual({
      kind: "send",
      data: "\r",
    });
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("windows", { shiftEnter: "enter" }))).toEqual({
      kind: "send",
      data: "\r",
    });
  });

  it("leaves Enter, Ctrl+Enter, Alt+Enter and Ctrl+Shift+Enter to xterm", () => {
    for (const mods of [{}, { ctrl: true }, { alt: true }, { shift: true, ctrl: true }, { shift: true, meta: true }]) {
      expect(routeTerminalKey(key("Enter", mods), ctx("windows"))).toEqual({ kind: "default" });
    }
    expect(routeTerminalKey(key("Enter", { ctrl: true }), ctx("linux"))).toEqual({ kind: "default" });
  });

  it("composition and AltGr fall through to xterm", () => {
    expect(routeTerminalKey(key("Enter", { shift: true, composing: true }), ctx("linux"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("Process", { shift: true, keyCode: 229 }), ctx("windows"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("Enter", { shift: true, keyCode: 229 }), ctx("windows"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("ArrowLeft", { ctrl: true, alt: true }), ctx("windows"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("@", { ctrl: true, alt: true, code: "KeyQ" }), ctx("windows"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("€", { ctrl: true, alt: true, code: "KeyE" }), ctx("windows"))).toEqual({ kind: "default" });
  });

  it("copies and pastes like Windows Terminal on Windows and like terminals on Linux", () => {
    expect(routeTerminalKey(key("c", { ctrl: true }), ctx("windows", { hasSelection: true }))).toEqual({
      kind: "copy",
      clearSelection: true,
    });
    expect(routeTerminalKey(key("c", { ctrl: true }), ctx("windows"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("c", { ctrl: true }), ctx("linux", { hasSelection: true }))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("C", { ctrl: true, shift: true }), ctx("linux", { hasSelection: true }))).toEqual({
      kind: "copy",
      clearSelection: false,
    });
    expect(routeTerminalKey(key("C", { ctrl: true, shift: true }), ctx("windows"))).toEqual({ kind: "ignore" });
    expect(routeTerminalKey(key("v", { ctrl: true }), ctx("windows"))).toEqual({ kind: "paste" });
    expect(routeTerminalKey(key("v", { ctrl: true }), ctx("linux"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("V", { ctrl: true, shift: true }), ctx("windows"))).toEqual({ kind: "paste" });
    expect(routeTerminalKey(key("V", { ctrl: true, shift: true }), ctx("linux"))).toEqual({ kind: "paste" });
    expect(routeTerminalKey(key("v", { meta: true }), ctx("mac"))).toEqual({ kind: "app" });
    expect(routeTerminalKey(key("c", { meta: true }), ctx("mac", { hasSelection: true }))).toEqual({ kind: "app" });
  });

  it("maps macOS line and word keys", () => {
    expect(routeTerminalKey(key("ArrowLeft", { meta: true }), ctx("mac"))).toEqual({ kind: "send", data: "\x01" });
    expect(routeTerminalKey(key("ArrowRight", { meta: true }), ctx("mac"))).toEqual({ kind: "send", data: "\x05" });
    expect(routeTerminalKey(key("Backspace", { meta: true }), ctx("mac"))).toEqual({ kind: "send", data: "\x15" });
    expect(routeTerminalKey(key("ArrowLeft", { alt: true }), ctx("mac", { optionIsMeta: true }))).toEqual({
      kind: "send",
      data: "\x1bb",
    });
    expect(routeTerminalKey(key("ArrowRight", { alt: true }), ctx("mac"))).toEqual({ kind: "send", data: "\x1bf" });
    expect(routeTerminalKey(key("k", { meta: true }), ctx("mac", { isAppShortcut: () => true }))).toEqual({
      kind: "clear",
    });
    expect(routeTerminalKey(key("b", { meta: true }), ctx("mac"))).toEqual({ kind: "app" });
    expect(routeTerminalKey(key("Backspace", { alt: true }), ctx("mac"))).toEqual({ kind: "default" });
  });

  it("restores Alt-arrow word moves on Windows and Linux", () => {
    expect(routeTerminalKey(key("ArrowLeft", { alt: true }), ctx("linux"))).toEqual({ kind: "send", data: "\x1b[1;5D" });
    expect(routeTerminalKey(key("ArrowRight", { alt: true }), ctx("windows"))).toEqual({ kind: "send", data: "\x1b[1;5C" });
    expect(routeTerminalKey(key("ArrowUp", { alt: true }), ctx("mac"))).toEqual({ kind: "send", data: "\x1b[1;5A" });
    expect(routeTerminalKey(key("ArrowDown", { alt: true }), ctx("windows"))).toEqual({ kind: "send", data: "\x1b[1;5B" });
  });

  it("maps word deletion per platform", () => {
    expect(routeTerminalKey(key("Backspace", { ctrl: true }), ctx("linux"))).toEqual({ kind: "send", data: "\x17" });
    expect(routeTerminalKey(key("Backspace", { ctrl: true }), ctx("windows"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("Delete", { ctrl: true }), ctx("windows"))).toEqual({ kind: "send", data: "\x1bd" });
    expect(routeTerminalKey(key("Delete", { ctrl: true }), ctx("linux"))).toEqual({ kind: "send", data: "\x1bd" });
    expect(routeTerminalKey(key("Delete", { ctrl: true }), ctx("mac"))).toEqual({ kind: "default" });
  });

  it("sends Ctrl+/ as 0x1f, including layouts that need Shift for /", () => {
    expect(routeTerminalKey(key("/", { ctrl: true }), ctx("windows"))).toEqual({ kind: "send", data: "\x1f" });
    expect(routeTerminalKey(key("/", { ctrl: true, shift: true, code: "Digit7" }), ctx("linux"))).toEqual({
      kind: "send",
      data: "\x1f",
    });
    expect(routeTerminalKey(key("/", { ctrl: true, alt: true }), ctx("linux"))).toEqual({ kind: "default" });
  });

  it("opens find with Ctrl+Shift+F, or Cmd+F on macOS", () => {
    expect(routeTerminalKey(key("F", { ctrl: true, shift: true }), ctx("linux"))).toEqual({ kind: "find" });
    expect(routeTerminalKey(key("F", { ctrl: true, shift: true }), ctx("windows"))).toEqual({ kind: "find" });
    expect(routeTerminalKey(key("f", { meta: true }), ctx("mac"))).toEqual({ kind: "find" });
    expect(routeTerminalKey(key("f", { ctrl: true }), ctx("mac"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("F", { ctrl: true, shift: true }), ctx("mac"))).toEqual({ kind: "default" });
  });

  it("leaves plain Ctrl+F to the program on Windows and Linux", () => {
    expect(routeTerminalKey(key("f", { ctrl: true }), ctx("linux"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("f", { ctrl: true }), ctx("windows"))).toEqual({ kind: "default" });
    expect(terminalClaimsKey(key("f", { ctrl: true }), ctx("linux"))).toBe(true);
    expect(terminalClaimsKey(key("f", { ctrl: true }), ctx("windows"))).toBe(true);
  });

  it("hands allow-listed app shortcuts to the app before the byte table", () => {
    const palette = (event: TerminalKeyEvent) => event.key === "k" && event.ctrlKey;
    expect(routeTerminalKey(key("k", { ctrl: true }), ctx("windows", { isAppShortcut: palette }))).toEqual({ kind: "app" });
    const newline = (event: TerminalKeyEvent) => event.key === "Enter";
    expect(routeTerminalKey(key("Enter", { shift: true }), ctx("linux", { isAppShortcut: newline }))).toEqual({
      kind: "app",
    });
  });

  it("routes only keydown", () => {
    expect(routeTerminalKey(key("Enter", { shift: true, type: "keyup" }), ctx("linux"))).toEqual({ kind: "default" });
    expect(routeTerminalKey(key("Enter", { shift: true, type: "keypress" }), ctx("windows"))).toEqual({
      kind: "default",
    });
  });

  it("knows which keys the terminal can encode", () => {
    expect(isTerminalKey(key("b", { ctrl: true }), "windows")).toBe(true);
    expect(isTerminalKey(key("z", { ctrl: true }), "linux")).toBe(true);
    expect(isTerminalKey(key("F11", { shift: true }), "windows")).toBe(true);
    expect(isTerminalKey(key("p", { ctrl: true, alt: true }), "linux")).toBe(true);
    expect(isTerminalKey(key("[", { ctrl: true }), "linux")).toBe(true);
    expect(isTerminalKey(key("x"), "mac")).toBe(true);
    expect(isTerminalKey(key("Tab", { shift: true }), "linux")).toBe(true);
    expect(isTerminalKey(key("=", { ctrl: true }), "windows")).toBe(false);
    expect(isTerminalKey(key("F", { ctrl: true, shift: true }), "linux")).toBe(false);
    expect(isTerminalKey(key("z", { meta: true }), "mac")).toBe(false);
    expect(isTerminalKey(key("ArrowLeft", { meta: true }), "mac")).toBe(true);
    expect(isTerminalKey(key("k", { meta: true }), "windows")).toBe(false);
    expect(isTerminalKey(key("Shift", { shift: true }), "linux")).toBe(false);
    expect(isTerminalKey(key("Unidentified"), "linux")).toBe(false);
  });

  it("claims terminal keys and leaves app-only chords and allow-listed shortcuts alone", () => {
    const allow = (event: TerminalKeyEvent) => event.key === "`" && event.ctrlKey;
    const c = ctx("windows", { isAppShortcut: allow });
    expect(terminalClaimsKey(key("b", { ctrl: true }), c)).toBe(true);
    expect(terminalClaimsKey(key("z", { ctrl: true }), c)).toBe(true);
    expect(terminalClaimsKey(key("/", { ctrl: true }), c)).toBe(true);
    expect(terminalClaimsKey(key("F11", { shift: true }), c)).toBe(true);
    expect(terminalClaimsKey(key("`", { ctrl: true }), c)).toBe(false);
    expect(terminalClaimsKey(key("=", { ctrl: true }), c)).toBe(false);
    expect(terminalClaimsKey(key("F", { ctrl: true, shift: true }), c)).toBe(true);
    expect(terminalClaimsKey(key("k", { meta: true }), ctx("mac"))).toBe(true);
    expect(terminalClaimsKey(key("b", { meta: true }), ctx("mac"))).toBe(false);
  });

  it("finds terminal and dock targets", () => {
    const dock = document.createElement("div");
    dock.setAttribute(TERMINAL_DOCK_ATTRIBUTE, "");
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const textarea = document.createElement("textarea");
    const input = document.createElement("input");
    xterm.append(textarea);
    dock.append(xterm, input);
    document.body.append(dock);

    expect(isTerminalTarget(textarea)).toBe(true);
    expect(isTerminalTarget(input)).toBe(false);
    expect(isInsideTerminalDock(input)).toBe(true);
    expect(isInsideTerminalDock(document.body)).toBe(false);
    expect(isTerminalTarget(null)).toBe(false);
    expect(isTerminalTarget(window)).toBe(false);
    dock.remove();
  });
});

describe("terminal platform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the platform when asked", () => {
    vi.stubGlobal("navigator", { platform: "Win32", userAgent: "" });
    expect(terminalPlatform()).toBe("windows");
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "" });
    expect(terminalPlatform()).toBe("mac");
    vi.stubGlobal("navigator", { platform: "Linux x86_64", userAgent: "" });
    expect(terminalPlatform()).toBe("linux");
    vi.stubGlobal("navigator", { platform: "", userAgent: "" });
    expect(terminalPlatform()).toBe("linux");
  });
});
