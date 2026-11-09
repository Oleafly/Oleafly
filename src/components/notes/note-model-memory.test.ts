// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { noteModelMemory } from "./note-model-memory";

const KEY = "oleafly.notes.assistantModel";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the model a note's assistant remembers", () => {
  it("keeps a model per note and offers the last one used to notes without their own", () => {
    noteModelMemory("n1").save({ providerId: "openai", modelId: "gpt-5" });
    noteModelMemory("n2").save({ providerId: "anthropic", modelId: "claude" });
    expect(noteModelMemory("n1").read()).toEqual({ providerId: "openai", modelId: "gpt-5" });
    expect(noteModelMemory("n2").read()).toEqual({ providerId: "anthropic", modelId: "claude" });
    expect(noteModelMemory("n3").read()).toEqual({ providerId: "anthropic", modelId: "claude" });
  });

  it("remembers nothing before a model is picked", () => {
    expect(noteModelMemory("n1").read()).toBeNull();
  });

  it("keeps only the most recent notes and survives broken or full storage", () => {
    for (let index = 0; index < 205; index += 1) noteModelMemory(`n${index}`).save({ providerId: "p", modelId: `m${index}` });
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { notes: Record<string, unknown> };
    expect(Object.keys(stored.notes)).toHaveLength(200);
    expect(stored.notes.n0).toBeUndefined();
    noteModelMemory("n204").save({ providerId: "p", modelId: "again" });
    expect(Object.keys((JSON.parse(localStorage.getItem(KEY) ?? "{}") as { notes: object }).notes).at(-1)).toBe("n204");
    localStorage.setItem(KEY, "{");
    expect(noteModelMemory("n1").read()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ notes: { n1: { providerId: "p" } }, last: "x" }));
    expect(noteModelMemory("n1").read()).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => noteModelMemory("n1").save({ providerId: "p", modelId: "m" })).not.toThrow();
  });
});
