import { describe, expect, it } from "vitest";
import { REDACTED_MARKER } from "@/lib/tauri";
import { editableKeys, withKey, withoutKey, type KeyMap } from "./ai-keys";

function isConfigured(saved: string, isCustom: boolean): boolean {
  return saved.length > 0 || isCustom;
}

function isDirty(input: string, saved: string): boolean {
  return input.trim().length > 0 && input !== saved;
}

describe("redacted credentials in Settings", () => {
  it("leaves the key field empty rather than showing the marker", () => {
    const stored = { openai: REDACTED_MARKER, zai: REDACTED_MARKER };
    expect(editableKeys(stored)).toEqual({ openai: "", zai: "" });
  });

  it("keeps the Ollama host visible because it is not redacted", () => {
    const stored = { ollama: "http://localhost:11434", openrouter: REDACTED_MARKER };
    expect(editableKeys(stored).ollama).toBe("http://localhost:11434");
  });

  it("still reports a provider with a stored key as connected", () => {
    expect(isConfigured(REDACTED_MARKER, false)).toBe(true);
    expect(isConfigured("", false)).toBe(false);
  });

  it("treats a custom provider as usable with no credential at all", () => {
    expect(isConfigured("", true)).toBe(true);
  });

  it("offers no save until the user types a new key", () => {
    expect(isDirty("", REDACTED_MARKER)).toBe(false);
    expect(isDirty("sk-new", REDACTED_MARKER)).toBe(true);
  });

  it("cannot save the marker itself as a credential", () => {
    expect(editableKeys({ openai: REDACTED_MARKER }).openai).toBe("");
    expect(isDirty(editableKeys({ openai: REDACTED_MARKER }).openai, REDACTED_MARKER)).toBe(false);
  });
});

describe("saving one provider does not disturb the others", () => {
  const stored: KeyMap = {
    openai: REDACTED_MARKER,
    groq: REDACTED_MARKER,
    ollama: "http://localhost:11434",
  };

  it("keeps every other credential as a marker when one key is saved", () => {
    expect(withKey(stored, "groq", "gsk-new")).toEqual({
      openai: REDACTED_MARKER,
      groq: "gsk-new",
      ollama: "http://localhost:11434",
    });
  });

  it("never writes a blank over a stored credential", () => {
    const saved = withKey(stored, "groq", "gsk-new");
    const blanks = Object.entries(saved).filter(([, value]) => value === "");
    expect(blanks).toEqual([]);
  });

  it("adding a first key leaves an unrelated stored one alone", () => {
    expect(withKey(stored, "mistral", "sk-m").openai).toBe(REDACTED_MARKER);
  });

  it("removes only the provider being deleted", () => {
    expect(withoutKey(stored, "openai")).toEqual({
      groq: REDACTED_MARKER,
      ollama: "http://localhost:11434",
    });
  });

  it("saving from the editable map would have dropped the rest", () => {
    const editable = editableKeys(stored);
    const wrong: KeyMap = { ...editable, groq: "gsk-new" };
    expect(wrong.openai).toBe("");
    expect(withKey(stored, "groq", "gsk-new").openai).toBe(REDACTED_MARKER);
  });
});
