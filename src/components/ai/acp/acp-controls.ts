import type { AcpConfigOption, AcpModeOption, AcpSession } from "@/lib/acp";

export type ModelControl =
  | { kind: "config"; option: AcpConfigOption }
  | { kind: "legacy"; models: { modelId: string; name: string }[]; current: string | null };
export type ModeControl =
  | { kind: "config"; option: AcpConfigOption }
  | { kind: "legacy"; modes: AcpModeOption[]; current: string | null };

export interface ControlGroups {
  model: ModelControl | null;
  /** Options that belong with the model (Claude's Fast). */
  modelConfig: AcpConfigOption[];
  effort: AcpConfigOption | null;
  mode: ModeControl | null;
  /** Everything else the agent reports. */
  more: AcpConfigOption[];
}

/** The agent's options by category, never by id (effort is `effort` for Claude and `reasoning_effort` for Codex). */
export function groupControls(controls: AcpSession["controls"]): ControlGroups {
  const options = (controls.options ?? []).filter((option) => option.kind.type !== "unsupported");
  const groups: ControlGroups = { model: null, modelConfig: [], effort: null, mode: null, more: [] };
  for (const option of options) {
    if (option.category === "model" && option.kind.type === "select" && !groups.model) {
      groups.model = { kind: "config", option };
    } else if (option.category === "model_config") {
      groups.modelConfig.push(option);
    } else if (option.category === "thought_level" && !groups.effort) {
      groups.effort = option;
    } else if (option.category === "mode" && option.kind.type === "select" && !groups.mode) {
      groups.mode = { kind: "config", option };
    } else {
      groups.more.push(option);
    }
  }
  if (!groups.model && controls.models.length > 0) {
    groups.model = { kind: "legacy", models: controls.models, current: controls.modelId };
  }
  if (!groups.mode && (controls.modes?.length ?? 0) > 0) {
    groups.mode = { kind: "legacy", modes: controls.modes ?? [], current: controls.modeId ?? null };
  }
  return groups;
}

/** The display name of an option's current choice. */
export function currentName(option: AcpConfigOption): string | null {
  if (option.kind.type === "select") {
    const current = option.kind.currentValue;
    if (current === null) return null;
    return option.kind.options.find((choice) => choice.value === current)?.name ?? current;
  }
  if (option.kind.type === "boolean") return option.kind.currentValue ? option.name : null;
  return null;
}

/**
 * Which option takes focus after a key in a listbox: the arrows, Home and End,
 * or typing the start of a name. `labels` has null for an option that cannot
 * be chosen. Null when the key does nothing here.
 */
export function listboxFocusTarget(labels: readonly (string | null)[], active: number, key: string): number | null {
  const enabled = labels.flatMap((label, index) => (label === null ? [] : [index]));
  if (enabled.length === 0) return null;
  const position = enabled.indexOf(active);
  switch (key) {
    case "ArrowDown":
      return enabled[position < 0 ? 0 : Math.min(enabled.length - 1, position + 1)];
    case "ArrowUp":
      return enabled[position < 0 ? enabled.length - 1 : Math.max(0, position - 1)];
    case "Home":
      return enabled[0];
    case "End":
      return enabled[enabled.length - 1];
  }
  if (key.length !== 1 || key === " ") return null;
  const typed = key.toLowerCase();
  const start = position < 0 ? 0 : position + 1;
  for (let step = 0; step < enabled.length; step++) {
    const index = enabled[(start + step) % enabled.length];
    if (labels[index]?.toLowerCase().startsWith(typed)) return index;
  }
  return null;
}
