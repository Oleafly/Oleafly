import { describe, expect, it } from "vitest";
import { REDACTED_SECRET } from "@/lib/tauri";

function editableKeys(stored: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(stored).map(([id, value]) => [id, value === REDACTED_SECRET ? "" : value]),
  );
}

function isConfigured(saved: string, isCustom: boolean): boolean {
  return saved.length > 0 || isCustom;
}

function isDirty(input: string, saved: string): boolean {
  return input.trim().length > 0 && input !== saved;
}

describe("redacted credentials in Settings", () => {
  it("leaves the key field empty rather than showing the marker", () => {
    const stored = { openai: REDACTED_SECRET, zai: REDACTED_SECRET };
    expect(editableKeys(stored)).toEqual({ openai: "", zai: "" });
  });

  it("keeps the Ollama host visible because it is not redacted", () => {
    const stored = { ollama: "http://localhost:11434", openrouter: REDACTED_SECRET };
    expect(editableKeys(stored).ollama).toBe("http://localhost:11434");
  });

  it("still reports a provider with a stored key as connected", () => {
    expect(isConfigured(REDACTED_SECRET, false)).toBe(true);
    expect(isConfigured("", false)).toBe(false);
  });

  it("treats a custom provider as usable with no credential at all", () => {
    expect(isConfigured("", true)).toBe(true);
  });

  it("offers no save until the user types a new key", () => {
    expect(isDirty("", REDACTED_SECRET)).toBe(false);
    expect(isDirty("sk-new", REDACTED_SECRET)).toBe(true);
  });

  it("cannot save the marker itself as a credential", () => {
    expect(editableKeys({ openai: REDACTED_SECRET }).openai).toBe("");
    expect(isDirty(editableKeys({ openai: REDACTED_SECRET }).openai, REDACTED_SECRET)).toBe(false);
  });
});
