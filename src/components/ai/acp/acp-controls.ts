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
