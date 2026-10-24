// What a key pressed in the terminal does: bytes for the shell, an app
// shortcut, copy or paste, find, or xterm's own handling. Pure, so the byte
// table is tested per platform; TerminalPane wires it into xterm and the app's
// capture-phase shortcut handlers ask it which keys the terminal owns.

export type TerminalPlatform = "mac" | "windows" | "linux";
export type TerminalShiftEnter = "newline" | "enter";

/** The parts of a KeyboardEvent the router reads. */
export interface TerminalKeyEvent {
  type: string;
  key: string;
  code: string;
  keyCode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}

export interface TerminalKeyContext {
  platform: TerminalPlatform;
  shiftEnter: TerminalShiftEnter;
  /** The session's shell is WSL (Windows only). */
  wsl: boolean;
  /** The shell program's name, such as `zsh` or `bash`, when known. */
  shellName?: string | null;
  hasSelection: boolean;
  optionIsMeta: boolean;
  /** Allow-listed app shortcuts that work from inside the terminal. */
  isAppShortcut: (event: TerminalKeyEvent) => boolean;
}

export type TerminalKeyAction =
  /** xterm handles the key. */
  | { kind: "default" }
  /** These bytes go to the PTY and the event is cancelled. */
  | { kind: "send"; data: string }
  /** xterm ignores the key and the event reaches the app's listeners. */
  | { kind: "app" }
  | { kind: "copy"; clearSelection: boolean }
  /** The webview runs its own paste, which xterm turns into a bracketed paste. */
  | { kind: "paste" }
  | { kind: "find" }
  | { kind: "clear" }
  | { kind: "ignore" };

/** Marks the terminal dock's root, so focus inside it can be recognised. */
export const TERMINAL_DOCK_ATTRIBUTE = "data-terminal-dock";

const DEFAULT: TerminalKeyAction = { kind: "default" };

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
  "OS",
  "Fn",
]);

const NAMED_TERMINAL_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

const FUNCTION_KEY = /^F(?:[1-9]|1\d|2[0-4])$/;
const LETTER = /^[a-z]$/i;

/** Keys other than letters that make a control character with Ctrl. */
const CTRL_SYMBOLS = new Set([" ", "[", "\\", "]", "/", "@", "^", "_", "?", "2", "3", "4", "5", "6", "7", "8"]);

/** The platform whose key conventions the terminal follows, read on every call. */
export function terminalPlatform(): TerminalPlatform {
  const platform =
    typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent || "";
  if (/Mac|iPhone|iPad/.test(platform)) return "mac";
  if (/Win/.test(platform)) return "windows";
  return "linux";
}

interface Modifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** Exactly these modifiers and no others. */
function only(event: TerminalKeyEvent, modifiers: Modifiers): boolean {
  return (
    event.ctrlKey === Boolean(modifiers.ctrl) &&
    event.shiftKey === Boolean(modifiers.shift) &&
    event.altKey === Boolean(modifiers.alt) &&
    event.metaKey === Boolean(modifiers.meta)
  );
}

function keyName(event: TerminalKeyEvent): string {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function send(data: string): TerminalKeyAction {
  return { kind: "send", data };
}

/** Shells whose line editor inserts a new line on ESC CR (Alt+Enter). */
const ESC_CR_SHELLS: ReadonlySet<string> = new Set(["zsh", "fish"]);
/** Readline shells, where ESC CR is the vi-mode toggle. */
const READLINE_SHELLS: ReadonlySet<string> = new Set(["bash", "sh"]);

function shellProgram(ctx: TerminalKeyContext): string {
  return ctx.shellName?.replace(/\.exe$/i, "").toLowerCase() ?? "";
}

function windowsShiftEnterBytes(ctx: TerminalKeyContext): string {
  // WSL forwards raw input to Linux, where LF is the newline CLI agents read.
  if (ctx.wsl) return "\n";
  const shell = shellProgram(ctx);
  // Git Bash is bash with the same readline binding as on Linux.
  if (READLINE_SHELLS.has(shell)) return "\n";
  // cmd has no multi-line input; Alt+Enter only submits the line there.
  if (shell === "cmd") return "\r";
  // ESC CR survives ConPTY and libuv and is a no-op at a PSReadLine prompt.
  return "\x1b\r";
}

function shiftEnterBytes(ctx: TerminalKeyContext): string {
  if (ctx.shiftEnter === "enter") return "\r";
  if (ctx.platform === "windows") return windowsShiftEnterBytes(ctx);
  // ESC CR is Option+Enter: zsh and fish add a line to the command, and CLI
  // agents such as Claude Code add a line to the prompt. LF would run the
  // command at a zsh prompt. macOS's bash binds nothing to ESC CR; bash on
  // Linux may switch to vi mode on it, so it keeps LF.
  if (ctx.platform === "mac") return "\x1b\r";
  return ESC_CR_SHELLS.has(shellProgram(ctx)) ? "\x1b\r" : "\n";
}

/** Ctrl+Shift+C copies a selection (nothing else happens without one), Ctrl+Shift+V pastes. */
function shiftClipboardChord(key: string, ctx: TerminalKeyContext): TerminalKeyAction | null {
  if (key === "c") {
    return ctx.hasSelection ? { kind: "copy", clearSelection: false } : { kind: "ignore" };
  }
  return key === "v" ? { kind: "paste" } : null;
}

/** Windows Terminal: Ctrl+C copies a selection (else it is ^C), Ctrl+V pastes. */
function windowsClipboardChord(key: string, ctx: TerminalKeyContext): TerminalKeyAction | null {
  if (key === "c" && ctx.hasSelection) return { kind: "copy", clearSelection: true };
  return key === "v" ? { kind: "paste" } : null;
}

function copyOrPaste(
  event: TerminalKeyEvent,
  key: string,
  ctx: TerminalKeyContext,
): TerminalKeyAction | null {
  if (ctx.platform === "mac") return null;
  if (only(event, { ctrl: true, shift: true })) return shiftClipboardChord(key, ctx);
  if (ctx.platform === "windows" && only(event, { ctrl: true })) return windowsClipboardChord(key, ctx);
  return null;
}

function arrowWithAlt(event: TerminalKeyEvent, platform: TerminalPlatform): TerminalKeyAction | null {
  if (!only(event, { alt: true })) return null;
  switch (event.key) {
    case "ArrowLeft":
      return send(platform === "mac" ? "\x1bb" : "\x1b[1;5D");
    case "ArrowRight":
      return send(platform === "mac" ? "\x1bf" : "\x1b[1;5C");
    case "ArrowUp":
      return send("\x1b[1;5A");
    case "ArrowDown":
      return send("\x1b[1;5B");
    default:
      return null;
  }
}

function lineAndWordKeys(event: TerminalKeyEvent, platform: TerminalPlatform): TerminalKeyAction | null {
  if (platform === "mac" && only(event, { meta: true })) {
    if (event.key === "ArrowLeft") return send("\x01");
    if (event.key === "ArrowRight") return send("\x05");
    if (event.key === "Backspace") return send("\x15");
  }
  if (only(event, { ctrl: true })) {
    if (platform === "linux" && event.key === "Backspace") return send("\x17");
    if (platform !== "mac" && event.key === "Delete") return send("\x1bd");
  }
  return null;
}

function isFindChord(event: TerminalKeyEvent, key: string, platform: TerminalPlatform): boolean {
  if (key !== "f") return false;
  // Plain Ctrl+F belongs to the program (vim and less page forward, readline
  // moves a character), so Windows and Linux use Ctrl+Shift+F, as Windows
  // Terminal and GNOME Terminal do.
  return platform === "mac" ? only(event, { meta: true }) : only(event, { ctrl: true, shift: true });
}

/** Ctrl+/ sends 0x1f, also on layouts that need Shift for "/". */
function isCtrlSlash(event: TerminalKeyEvent): boolean {
  return event.key === "/" && event.ctrlKey && !event.altKey && !event.metaKey;
}

/** What a key event in the terminal does. Only keydown is routed. */
export function routeTerminalKey(event: TerminalKeyEvent, ctx: TerminalKeyContext): TerminalKeyAction {
  if (event.type !== "keydown") return DEFAULT;
  // IME composition (including its Enter) and keyCode 229 belong to the IME.
  if (event.isComposing || event.keyCode === 229) return DEFAULT;
  const key = keyName(event);
  const { platform } = ctx;
  if (platform === "mac" && only(event, { meta: true }) && key === "k") return { kind: "clear" };
  if (ctx.isAppShortcut(event)) return { kind: "app" };
  if (isFindChord(event, key, platform)) return { kind: "find" };
  const clipboard = copyOrPaste(event, key, ctx);
  if (clipboard) return clipboard;
  if (event.key === "Enter" && only(event, { shift: true })) return send(shiftEnterBytes(ctx));
  if (isCtrlSlash(event)) return send("\x1f");
  const mapped = arrowWithAlt(event, platform) ?? lineAndWordKeys(event, platform);
  if (mapped) return mapped;
  // Every other Cmd chord on macOS is an app shortcut (menu items included).
  if (platform === "mac" && event.metaKey) return { kind: "app" };
  return DEFAULT;
}

/**
 * Whether the terminal can turn this key into input: control characters,
 * Alt/Meta prefixes, named keys, printable characters and the keys the
 * router maps. App chords with no terminal meaning (Ctrl+= zoom) are not
 * terminal keys, so they keep working from the terminal. AltGr characters have a single-character key, so they count.
 */
export function isTerminalKey(event: TerminalKeyEvent, platform: TerminalPlatform): boolean {
  if (MODIFIER_KEYS.has(event.key)) return false;
  if (event.metaKey) {
    if (platform !== "mac" || event.ctrlKey || event.altKey || event.shiftKey) return false;
    const key = keyName(event);
    return key === "ArrowLeft" || key === "ArrowRight" || key === "Backspace" || key === "k" || key === "f";
  }
  if (NAMED_TERMINAL_KEYS.has(event.key) || FUNCTION_KEY.test(event.key)) return true;
  if (event.key.length !== 1) return false;
  if (event.ctrlKey && !event.altKey) {
    if (LETTER.test(event.key)) return !event.shiftKey;
    return CTRL_SYMBOLS.has(event.key);
  }
  return true;
}

/**
 * Whether Ctrl, alone, turns this key into something a program reads: a
 * control character (Ctrl+K kills the line in readline and nano) or a named
 * key (vim moves between tabs on Ctrl+PageDown). Off macOS an app shortcut
 * bound to one of these gives way to a focused terminal.
 */
export function isCtrlTerminalKey(event: TerminalKeyEvent): boolean {
  if (!event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.key.length === 1) {
    if (LETTER.test(event.key)) return !event.shiftKey;
    return CTRL_SYMBOLS.has(event.key);
  }
  return !event.shiftKey && (NAMED_TERMINAL_KEYS.has(event.key) || FUNCTION_KEY.test(event.key));
}

/** Whether a capture-phase app handler must leave this key to the terminal. */
export function terminalClaimsKey(event: TerminalKeyEvent, ctx: TerminalKeyContext): boolean {
  const action = routeTerminalKey(event, ctx);
  if (action.kind === "app") return false;
  if (action.kind !== "default") return true;
  return isTerminalKey(event, ctx.platform);
}

function closestFrom(target: EventTarget | null, selector: string): Element | null {
  const element = target as Partial<Pick<Element, "closest">> | null;
  return typeof element?.closest === "function" ? element.closest(selector) : null;
}

/** Whether the event target is inside an xterm (its helper textarea). */
export function isTerminalTarget(target: EventTarget | null): boolean {
  return closestFrom(target, ".xterm") !== null;
}

/** Whether the event target is anywhere inside the terminal dock. */
export function isInsideTerminalDock(target: EventTarget | null): boolean {
  return closestFrom(target, `[${TERMINAL_DOCK_ATTRIBUTE}]`) !== null;
}
