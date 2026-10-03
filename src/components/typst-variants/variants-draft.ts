import type { TypstInputs } from "@/lib/typst-options";

export interface DraftInput {
  readonly id: number;
  readonly key: string;
  readonly value: string;
}

export interface DraftVariant {
  readonly id: number;
  readonly original: string | null;
  readonly name: string;
  readonly inputs: readonly DraftInput[];
}

export type DraftProblem = "nameRequired" | "nameTaken" | "keyInvalid" | "keyTaken";

let nextId = 0;

export function draftId(): number {
  nextId += 1;
  return nextId;
}

export function draftFromVariants(variants: Readonly<Record<string, TypstInputs>>): DraftVariant[] {
  return Object.entries(variants).map(([name, inputs]) => ({
    id: draftId(),
    original: name,
    name,
    inputs: Object.entries(inputs).map(([key, value]) => ({ id: draftId(), key, value })),
  }));
}

export function newVariantName(draft: readonly DraftVariant[], label: (number: number) => string): string {
  const taken = new Set(draft.map((variant) => variant.name.trim()));
  let number = draft.length + 1;
  while (taken.has(label(number))) number += 1;
  return label(number);
}

export function draftProblem(draft: readonly DraftVariant[]): DraftProblem | null {
  const names = new Set<string>();
  for (const variant of draft) {
    const name = variant.name.trim();
    if (!name) return "nameRequired";
    if (names.has(name)) return "nameTaken";
    names.add(name);
    const keys = new Set<string>();
    for (const input of variant.inputs) {
      const key = input.key.trim();
      if (!key || key.includes("=")) return "keyInvalid";
      if (keys.has(key)) return "keyTaken";
      keys.add(key);
    }
  }
  return null;
}

export function variantsFromDraft(draft: readonly DraftVariant[]): Record<string, TypstInputs> {
  return Object.fromEntries(
    draft.map((variant) => [
      variant.name.trim(),
      Object.fromEntries(variant.inputs.map((input) => [input.key.trim(), input.value])),
    ]),
  );
}

export function selectionAfterSave(draft: readonly DraftVariant[], selected: string | null): string | null {
  if (!selected) return null;
  const kept = draft.find((variant) => variant.original === selected);
  return kept ? kept.name.trim() : null;
}
