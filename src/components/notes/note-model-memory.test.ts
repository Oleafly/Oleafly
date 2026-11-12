// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { noteModelMemory } from "./note-model-memory";

const initial = useNotesPrefsStore.getState();

beforeEach(() => {
  useNotesPrefsStore.setState(initial, true);
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

  it("keeps only the most recent notes", () => {
    for (let index = 0; index < 205; index += 1) noteModelMemory(`n${index}`).save({ providerId: "p", modelId: `m${index}` });
    const { notes } = useNotesPrefsStore.getState().models;
    expect(Object.keys(notes)).toHaveLength(200);
    expect(notes.n0).toBeUndefined();
    noteModelMemory("n5").save({ providerId: "p", modelId: "again" });
    expect(Object.keys(useNotesPrefsStore.getState().models.notes).at(-1)).toBe("n5");
  });
});
