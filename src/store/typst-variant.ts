import { create } from "zustand";
import type { DocumentEngineDescriptor } from "@oleafly/backend-port";

const STORAGE_KEY = "oleafly.typstVariants";

type Selections = Readonly<Record<string, string>>;

function readSelections(): Selections {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
      ),
    );
  } catch {
    return {};
  }
}

function writeSelections(selections: Selections): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(selections));
  } catch {
    return;
  }
}

interface TypstVariantState {
  selections: Selections;
  select: (projectId: string, variant: string | null) => void;
}

export const useTypstVariantStore = create<TypstVariantState>((set, get) => ({
  selections: readSelections(),
  select: (projectId, variant) => {
    const next: Record<string, string> = { ...get().selections };
    if (variant) next[projectId] = variant;
    else delete next[projectId];
    writeSelections(next);
    set({ selections: next });
  },
}));

export function activeTypstVariant(
  projectId: string | null,
  engine: Pick<DocumentEngineDescriptor, "source_format" | "typst_options">,
  selections: Selections = useTypstVariantStore.getState().selections,
): string | null {
  if (!projectId || engine.source_format !== "typst") return null;
  const chosen = selections[projectId];
  return chosen && engine.typst_options?.variants.includes(chosen) ? chosen : null;
}
