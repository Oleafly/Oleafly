import type { AssistantScopeModelMemory, ScopeModelChoice } from "@/components/ai/scope-model-memory";
import { readJson, writeJson } from "@/lib/local-storage";

const KEY = "oleafly.notes.assistantModel";
const MAX_NOTES = 200;

interface Stored {
  last: ScopeModelChoice | null;
  notes: Record<string, ScopeModelChoice>;
}

function choiceOf(value: unknown): ScopeModelChoice | null {
  if (!value || typeof value !== "object") return null;
  const { providerId, modelId } = value as Record<string, unknown>;
  return typeof providerId === "string" && typeof modelId === "string" ? { providerId, modelId } : null;
}

function read(): Stored {
  const value = readJson<unknown>(KEY, null);
  if (!value || typeof value !== "object") return { last: null, notes: {} };
  const record = value as Record<string, unknown>;
  const notes: Record<string, ScopeModelChoice> = {};
  for (const [noteId, choice] of Object.entries((record.notes ?? {}) as Record<string, unknown>)) {
    const valid = choiceOf(choice);
    if (valid) notes[noteId] = valid;
  }
  return { last: choiceOf(record.last), notes };
}

export function noteModelMemory(noteId: string): AssistantScopeModelMemory {
  return {
    read: () => {
      const stored = read();
      return stored.notes[noteId] ?? stored.last;
    },
    save: (choice) => {
      const stored = read();
      const kept = { providerId: choice.providerId, modelId: choice.modelId };
      delete stored.notes[noteId];
      stored.notes[noteId] = kept;
      const ids = Object.keys(stored.notes);
      for (const old of ids.slice(0, Math.max(0, ids.length - MAX_NOTES))) delete stored.notes[old];
      writeJson(KEY, { last: kept, notes: stored.notes });
    },
  };
}
