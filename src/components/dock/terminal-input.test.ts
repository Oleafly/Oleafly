// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalKeyContext, TerminalPlatform } from "@/lib/terminal-keys";
import { attachTerminalKeys } from "./terminal-input";

const target = {
  input: vi.fn(),
  hasSelection: vi.fn(() => false),
  getSelection: vi.fn(() => ""),
  clearSelection: vi.fn(),
  clear: vi.fn(),
  handler: null as ((event: KeyboardEvent) => boolean) | null,
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    target.handler = handler;
  },
};
const hooks = { copy: vi.fn(), find: vi.fn() };

function attach(context: Omit<TerminalKeyContext, "hasSelection">) {
  attachTerminalKeys(target, { context: () => context, copy: hooks.copy, find: hooks.find });
  const handler = target.handler;
  if (!handler) throw new Error("no key handler attached");
  return handler;
}

function ctxFor(platform: TerminalPlatform, over: Partial<TerminalKeyContext> = {}) {
  return {
    platform,
    shiftEnter: "newline" as const,
    wsl: false,
    optionIsMeta: false,
    isAppShortcut: () => false,
    ...over,
  };
}

function keydown(key: string, init: KeyboardEventInit & { keyCode?: number } = {}): KeyboardEvent {
  const { keyCode, ...rest } = init;
  const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...rest });
  if (keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: keyCode });
  return event;
}

describe("terminal key handler", () => {
  beforeEach(() => {
    target.input.mockClear();
    target.hasSelection.mockReset().mockReturnValue(false);
    target.getSelection.mockReset().mockReturnValue("");
    target.clearSelection.mockClear();
    target.clear.mockClear();
    target.handler = null;
    hooks.copy.mockClear();
    hooks.find.mockClear();
  });

  it("sends mapped bytes on keydown, cancels the event and swallows the keypress", () => {
    const handler = attach(ctxFor("windows"));
    const down = keydown("Enter", { code: "Enter", shiftKey: true, keyCode: 13 });

    expect(handler(down)).toBe(false);
    expect(down.defaultPrevented).toBe(true);
    expect(target.input).toHaveBeenCalledWith("\x1b\r");
    expect(handler(new KeyboardEvent("keypress", { key: "Enter", shiftKey: true }))).toBe(false);
    expect(handler(new KeyboardEvent("keypress", { key: "a" }))).toBe(true);
    expect(handler(new KeyboardEvent("keyup", { key: "Enter" }))).toBe(true);
  });

  it("lets the webview paste on Ctrl+V (Windows) without sending ^V", () => {
    const handler = attach(ctxFor("windows"));
    const down = keydown("v", { ctrlKey: true, keyCode: 86 });

    expect(handler(down)).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    expect(target.input).not.toHaveBeenCalled();
  });

  it("copies the selection with Ctrl+Shift+C and keeps it; Windows Ctrl+C clears it", () => {
    target.hasSelection.mockReturnValue(true);
    target.getSelection.mockReturnValue("selected text");
    const linux = attach(ctxFor("linux"));
    const keep = keydown("C", { ctrlKey: true, shiftKey: true, keyCode: 67 });
    expect(linux(keep)).toBe(false);
    expect(keep.defaultPrevented).toBe(true);
    expect(hooks.copy).toHaveBeenCalledWith("selected text");
    expect(target.clearSelection).not.toHaveBeenCalled();

    const windows = attach(ctxFor("windows"));
    expect(windows(keydown("c", { ctrlKey: true, keyCode: 67 }))).toBe(false);
    expect(hooks.copy).toHaveBeenCalledTimes(2);
    expect(target.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("swallows Ctrl+Shift+C with nothing selected", () => {
    const handler = attach(ctxFor("linux"));
    const down = keydown("C", { ctrlKey: true, shiftKey: true, keyCode: 67 });

    expect(handler(down)).toBe(false);
    expect(down.defaultPrevented).toBe(true);
    expect(hooks.copy).not.toHaveBeenCalled();
    expect(target.input).not.toHaveBeenCalled();
  });

  it("hands allow-listed shortcuts to the app without cancelling them", () => {
    const handler = attach(ctxFor("windows", { isAppShortcut: (event) => event.key === "k" && event.ctrlKey }));
    const down = keydown("k", { ctrlKey: true, keyCode: 75 });

    expect(handler(down)).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    expect(target.input).not.toHaveBeenCalled();
  });

  it("clears on Cmd+K and opens find on Cmd+F on macOS", () => {
    const handler = attach(ctxFor("mac"));
    const clear = keydown("k", { metaKey: true, keyCode: 75 });
    expect(handler(clear)).toBe(false);
    expect(clear.defaultPrevented).toBe(true);
    expect(target.clear).toHaveBeenCalledTimes(1);

    const find = keydown("f", { metaKey: true, keyCode: 70 });
    expect(handler(find)).toBe(false);
    expect(find.defaultPrevented).toBe(true);
    expect(hooks.find).toHaveBeenCalledTimes(1);
  });

  it("leaves ordinary keys to xterm", () => {
    const handler = attach(ctxFor("linux"));
    const down = keydown("a", { keyCode: 65 });

    expect(handler(down)).toBe(true);
    expect(down.defaultPrevented).toBe(false);
  });
});
