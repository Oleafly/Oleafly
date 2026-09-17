// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  EDITOR_KEY_DEFAULTS,
  EDITOR_KEY_DEFINITIONS,
  editorKeyFromEvent,
  editorKeyLabel,
  editorKeyTokens,
  isValidEditorKey,
  mergeEditorKeys,
  normalizeEditorKey,
  parseEditorKey,
  sameEditorKey,
  useEditorKeymapStore,
} from "./editor-keymap";

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

beforeEach(() => {
  setPlatform("");
  localStorage.clear();
  useEditorKeymapStore.setState({ keys: { ...EDITOR_KEY_DEFAULTS } });
});

describe("parseEditorKey", () => {
  it("accepts the supported modifier prefixes", () => {
    expect(parseEditorKey("Mod-d")).toEqual({ modifiers: ["Mod"], key: "d" });
    expect(parseEditorKey("Ctrl-Shift-u")).toEqual({ modifiers: ["Ctrl", "Shift"], key: "u" });
    expect(parseEditorKey("Ctrl-Alt-ArrowUp")).toEqual({
      modifiers: ["Ctrl", "Alt"],
      key: "ArrowUp",
    });
    expect(parseEditorKey("Cmd-/")).toEqual({ modifiers: ["Cmd"], key: "/" });
  });

  it("keeps a trailing dash as the key", () => {
    expect(parseEditorKey("Mod--")).toEqual({ modifiers: ["Mod"], key: "-" });
  });

  it("allows a bare function key but not a bare character", () => {
    expect(isValidEditorKey("F8")).toBe(true);
    expect(isValidEditorKey("d")).toBe(false);
  });

  it("rejects unknown modifiers, unknown key names, duplicates and Mod with Cmd", () => {
    expect(isValidEditorKey("Hyper-d")).toBe(false);
    expect(isValidEditorKey("Mod-Nonsense")).toBe(false);
    expect(isValidEditorKey("Mod-Mod-d")).toBe(false);
    expect(isValidEditorKey("Mod-Cmd-d")).toBe(false);
    expect(isValidEditorKey("")).toBe(false);
  });
});

describe("normalizeEditorKey", () => {
  it("orders modifiers and lowercases single characters", () => {
    expect(normalizeEditorKey("Shift-Mod-D")).toBe("Mod-Shift-d");
    expect(normalizeEditorKey("alt-ctrl-ArrowDown")).toBe("Ctrl-Alt-ArrowDown");
  });

  it("treats differently spelled equivalents as the same key", () => {
    expect(sameEditorKey("Mod-Shift-d", "Shift-Mod-D")).toBe(true);
    expect(sameEditorKey("Mod-d", "Ctrl-d")).toBe(false);
    expect(sameEditorKey("", "Mod-d")).toBe(false);
  });
});

describe("editorKeyFromEvent", () => {
  it("maps Ctrl to Mod away from Apple platforms", () => {
    expect(editorKeyFromEvent(keyEvent({ key: "d", ctrlKey: true }))).toBe("Mod-d");
    expect(editorKeyFromEvent(keyEvent({ key: "D", ctrlKey: true, shiftKey: true }))).toBe(
      "Mod-Shift-d",
    );
  });

  it("maps Meta to Mod and Ctrl to Ctrl on Apple platforms", () => {
    setPlatform("MacIntel");
    expect(editorKeyFromEvent(keyEvent({ key: "d", metaKey: true }))).toBe("Mod-d");
    expect(editorKeyFromEvent(keyEvent({ key: "u", ctrlKey: true }))).toBe("Ctrl-u");
  });

  it("declines modifier-only and unmodified keys", () => {
    expect(editorKeyFromEvent(keyEvent({ key: "Shift", shiftKey: true }))).toBeNull();
    expect(editorKeyFromEvent(keyEvent({ key: "d" }))).toBeNull();
  });

  it("names the space bar", () => {
    expect(editorKeyFromEvent(keyEvent({ key: " ", ctrlKey: true }))).toBe("Mod-Space");
  });
});

describe("editorKeyTokens", () => {
  it("renders platform glyphs and arrow symbols", () => {
    expect(editorKeyTokens("Mod-Shift-d")).toEqual(["Ctrl", "Shift", "D"]);
    expect(editorKeyTokens("Ctrl-Alt-ArrowDown")).toEqual(["Ctrl", "Alt", "↓"]);
    setPlatform("MacIntel");
    expect(editorKeyTokens("Mod-Shift-d")).toEqual(["⌘", "Shift", "D"]);
    expect(editorKeyLabel("Mod-Shift-d")).toBe("⌘ShiftD");
  });

  it("renders nothing for an unbound action", () => {
    expect(editorKeyTokens("")).toEqual([]);
    expect(editorKeyLabel("")).toBe("");
  });
});

describe("mergeEditorKeys", () => {
  it("merges defaults, keeps explicit unbindings and drops unknown ids", () => {
    const merged = mergeEditorKeys({
      deleteLine: "Mod-Shift-k",
      duplicate: "",
      nonsense: "Mod-q",
    });
    expect(merged.deleteLine).toBe("Mod-Shift-k");
    expect(merged.duplicate).toBe("");
    expect(merged.uppercase).toBe(EDITOR_KEY_DEFAULTS.uppercase);
    expect("nonsense" in merged).toBe(false);
  });

  it("drops invalid key strings and non-objects", () => {
    expect(mergeEditorKeys({ deleteLine: "Hyper-q" }).deleteLine).toBe(
      EDITOR_KEY_DEFAULTS.deleteLine,
    );
    expect(mergeEditorKeys(null)).toEqual({ ...EDITOR_KEY_DEFAULTS });
    expect(mergeEditorKeys("nope")).toEqual({ ...EDITOR_KEY_DEFAULTS });
  });
});

describe("useEditorKeymapStore", () => {
  it("persists a remap, an unbinding, a per-key reset and a full reset", () => {
    const store = useEditorKeymapStore.getState();
    store.setKey("deleteLine", "Shift-Mod-K");
    expect(useEditorKeymapStore.getState().keys.deleteLine).toBe("Mod-Shift-k");
    expect(JSON.parse(localStorage.getItem("oleafly.editorKeymap") ?? "{}").deleteLine).toBe(
      "Mod-Shift-k",
    );

    store.setKey("duplicate", "");
    expect(useEditorKeymapStore.getState().keys.duplicate).toBe("");

    store.resetKey("deleteLine");
    expect(useEditorKeymapStore.getState().keys.deleteLine).toBe(
      EDITOR_KEY_DEFAULTS.deleteLine,
    );

    store.resetAll();
    expect(useEditorKeymapStore.getState().keys).toEqual({ ...EDITOR_KEY_DEFAULTS });
  });

  it("refuses an invalid key without changing the stored bindings", () => {
    const before = useEditorKeymapStore.getState().keys;
    useEditorKeymapStore.getState().setKey("deleteLine", "Hyper-q");
    expect(useEditorKeymapStore.getState().keys).toBe(before);
  });
});

describe("EDITOR_KEY_DEFINITIONS", () => {
  it("ships the reference defaults and leaves the rest unbound", () => {
    const defaults = Object.fromEntries(
      EDITOR_KEY_DEFINITIONS.map((definition) => [definition.id, definition.defaultKey]),
    );
    expect(defaults).toMatchObject({
      uppercase: "Ctrl-u",
      lowercase: "Ctrl-Shift-u",
      titleCase: "",
      deleteLine: "Mod-d",
      duplicate: "Mod-Shift-d",
      addCursorAbove: "Ctrl-Alt-ArrowUp",
      addCursorBelow: "Ctrl-Alt-ArrowDown",
      gotoLine: "Mod-Shift-l",
      toggleComment: "Mod-/",
      selectNextOccurrence: "",
      indentMore: "",
      indentLess: "",
    });
  });

  it("only ships key strings CodeMirror can parse", () => {
    for (const { defaultKey } of EDITOR_KEY_DEFINITIONS) {
      if (defaultKey) expect(isValidEditorKey(defaultKey)).toBe(true);
    }
  });
});
