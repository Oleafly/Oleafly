import type { AppConfig, SavedInstruction } from "@/lib/tauri";

export const SAVED_INSTRUCTION_LIMITS = { count: 50, name: 60, text: 2_000 } as const;

const NAME_WORDS_LENGTH = 32;

export function savedInstructionsOf(config: AppConfig | null): SavedInstruction[] {
  return config?.ai_saved_instructions ?? [];
}

export function rankSavedInstructions(config: AppConfig | null): SavedInstruction[] {
  const uses = config?.ai_saved_instruction_uses ?? {};
  return savedInstructionsOf(config)
    .map((instruction, index) => ({ instruction, index, count: uses[instruction.id] ?? 0 }))
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .map(({ instruction }) => instruction);
}

export function usesOf(config: AppConfig | null, id: string): number {
  return config?.ai_saved_instruction_uses?.[id] ?? 0;
}

export function pickedInstructions(config: AppConfig | null, picked: readonly string[]): SavedInstruction[] {
  const chosen = new Set(picked);
  return savedInstructionsOf(config).filter((instruction) => chosen.has(instruction.id) && instruction.text.trim());
}

export function suggestInstructionName(text: string): string {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  let name = "";
  for (const word of words) {
    const next = name ? `${name} ${word}` : word;
    if (next.length > NAME_WORDS_LENGTH && name) break;
    name = next;
  }
  return name.slice(0, SAVED_INSTRUCTION_LIMITS.name);
}

export function hasSavedText(config: AppConfig | null, text: string): boolean {
  const wanted = text.trim();
  return savedInstructionsOf(config).some((instruction) => instruction.text.trim() === wanted);
}

export function canSaveMore(config: AppConfig | null): boolean {
  return savedInstructionsOf(config).length < SAVED_INSTRUCTION_LIMITS.count;
}

export function newSavedInstruction(name: string, text: string): SavedInstruction {
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, SAVED_INSTRUCTION_LIMITS.name),
    text: text.trim().slice(0, SAVED_INSTRUCTION_LIMITS.text),
  };
}
