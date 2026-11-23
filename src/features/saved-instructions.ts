import { rememberProviderConfig } from "@/components/ai/provider-config";
import { invalidateConfigCache } from "@/lib/config-cache";
import { canSaveMore, newSavedInstruction, savedInstructionsOf } from "@/lib/saved-instructions";
import { getConfig, setConfig, type AppConfig, type SavedInstruction } from "@/lib/tauri";

export async function addSavedInstruction(name: string, text: string): Promise<SavedInstruction | null> {
  const latest = await getConfig();
  if (!canSaveMore(latest)) return null;
  const instruction = newSavedInstruction(name, text);
  if (!instruction.name || !instruction.text) return null;
  const next: AppConfig = {
    ...latest,
    ai_saved_instructions: [...savedInstructionsOf(latest), instruction],
  };
  await setConfig(next);
  window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: next }));
  return instruction;
}

export async function recordSavedInstructionUse(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const latest = await getConfig();
  const known = new Set(savedInstructionsOf(latest).map((instruction) => instruction.id));
  const uses: Record<string, number> = {};
  for (const [id, count] of Object.entries(latest.ai_saved_instruction_uses ?? {})) {
    if (known.has(id)) uses[id] = count;
  }
  let changed = false;
  for (const id of new Set(ids)) {
    if (!known.has(id)) continue;
    uses[id] = (uses[id] ?? 0) + 1;
    changed = true;
  }
  if (!changed) return;
  const next: AppConfig = { ...latest, ai_saved_instruction_uses: uses };
  await setConfig(next);
  invalidateConfigCache();
  rememberProviderConfig(next);
}
