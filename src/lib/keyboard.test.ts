// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { isAltGraphCharacter, isUnbindableKey } from "./keyboard";

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

beforeEach(() => {
  setPlatform("");
});

describe("isAltGraphCharacter on Windows", () => {
  beforeEach(() => {
    setPlatform("Win32");
  });

  it("recognises a character typed through AltGr", () => {
    // WebView2 reports AltGraph and clears Ctrl and Alt.
    expect(isAltGraphCharacter(keyEvent({ key: "@", modifierAltGraph: true }))).toBe(true);
    // Engines that report AltGr as Ctrl+Alt.
    expect(
      isAltGraphCharacter(
        keyEvent({ key: "@", ctrlKey: true, altKey: true, modifierAltGraph: true }),
      ),
    ).toBe(true);
    // Ctrl held with AltGr still types the character.
    expect(
      isAltGraphCharacter(keyEvent({ key: "]", ctrlKey: true, modifierAltGraph: true })),
    ).toBe(true);
    // AltGr+Shift, such as £ on US-International.
    expect(
      isAltGraphCharacter(keyEvent({ key: "£", shiftKey: true, modifierAltGraph: true })),
    ).toBe(true);
    // Some layouts type more than one code point with one key.
    expect(isAltGraphCharacter(keyEvent({ key: "ह़", modifierAltGraph: true }))).toBe(true);
  });

  it("leaves a real Ctrl+Alt chord alone", () => {
    expect(isAltGraphCharacter(keyEvent({ key: "q", ctrlKey: true, altKey: true }))).toBe(
      false,
    );
  });

  it("leaves named keys pressed with AltGr alone", () => {
    for (const key of ["ArrowUp", "F5", "Enter", "AltGraph", "Dead"]) {
      expect(isAltGraphCharacter(keyEvent({ key, modifierAltGraph: true }))).toBe(false);
    }
  });

  it("accepts an event without getModifierState", () => {
    expect(isAltGraphCharacter({ key: "@" } as KeyboardEvent)).toBe(false);
  });
});

describe("isAltGraphCharacter on Linux", () => {
  beforeEach(() => {
    setPlatform("Linux x86_64");
  });

  it("recognises a bare AltGr character from WebKitGTK 2.54", () => {
    expect(isAltGraphCharacter(keyEvent({ key: "@", modifierAltGraph: true }))).toBe(true);
    expect(
      isAltGraphCharacter(keyEvent({ key: "¡", shiftKey: true, modifierAltGraph: true })),
    ).toBe(true);
  });

  it("treats Ctrl with AltGr as a shortcut, because it types nothing", () => {
    // Ctrl+AltGr+9 on a German layout.
    expect(
      isAltGraphCharacter(keyEvent({ key: "]", ctrlKey: true, modifierAltGraph: true })),
    ).toBe(false);
  });

  it("sees nothing on WebKitGTK before 2.54, which never reports AltGraph", () => {
    expect(isAltGraphCharacter(keyEvent({ key: "@" }))).toBe(false);
    expect(isAltGraphCharacter(keyEvent({ key: "]", ctrlKey: true }))).toBe(false);
  });
});

describe("isAltGraphCharacter on macOS", () => {
  beforeEach(() => {
    setPlatform("MacIntel");
  });

  it("recognises Option typing plain ASCII on a non-US layout", () => {
    // Option+L and Option+Shift+7 on a German layout.
    expect(isAltGraphCharacter(keyEvent({ key: "@", altKey: true }))).toBe(true);
    expect(isAltGraphCharacter(keyEvent({ key: "\\", altKey: true, shiftKey: true }))).toBe(
      true,
    );
  });

  it("leaves US Option characters, Cmd and Ctrl chords and named keys alone", () => {
    expect(isAltGraphCharacter(keyEvent({ key: "∂", altKey: true }))).toBe(false);
    expect(isAltGraphCharacter(keyEvent({ key: "@", altKey: true, metaKey: true }))).toBe(
      false,
    );
    expect(isAltGraphCharacter(keyEvent({ key: "@", altKey: true, ctrlKey: true }))).toBe(
      false,
    );
    expect(isAltGraphCharacter(keyEvent({ key: "ArrowUp", altKey: true }))).toBe(false);
    expect(isAltGraphCharacter(keyEvent({ key: "@" }))).toBe(false);
  });
});

describe("isUnbindableKey", () => {
  it("rejects modifiers, lock keys, dead keys, IME keys and layout keys", () => {
    for (const key of [
      "AltGraph",
      "Dead",
      "Process",
      "Unidentified",
      "CapsLock",
      "GroupNext",
      "Super",
      "Compose",
      "ModeChange",
      "Hankaku",
      "Zenkaku",
      "Convert",
      "NonConvert",
      "KanjiMode",
      "HangulMode",
      "HanjaMode",
    ]) {
      expect(isUnbindableKey(key)).toBe(true);
    }
  });

  it("allows characters and named keys", () => {
    for (const key of ["q", "`", "Enter", "F5", " "]) {
      expect(isUnbindableKey(key)).toBe(false);
    }
  });
});
