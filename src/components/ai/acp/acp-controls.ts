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

export interface ModelChoice {
  id: string;
  name: string;
  group: string | null;
  blocked: boolean;
}

/** The models the agent offers, in its order; empty when it gives no list to pick from. */
export function modelChoices(model: ModelControl | null): ModelChoice[] {
  if (model?.kind === "config" && model.option.kind.type === "select") {
    return model.option.kind.options.map((choice) => ({
      id: choice.value,
      name: choice.name,
      group: choice.group,
      blocked: choice.blocked,
    }));
  }
  if (model?.kind === "legacy") {
    return model.models.map((entry) => ({ id: entry.modelId, name: entry.name, group: null, blocked: false }));
  }
  return [];
}

/** The id of the model the agent runs now, when it reports one. */
export function currentModelId(model: ModelControl | null): string | null {
  if (model?.kind === "config" && model.option.kind.type === "select") return model.option.kind.currentValue;
  return model?.kind === "legacy" ? model.current : null;
}

/** The group name to show above each choice: where a group starts, and null elsewhere. */
export function groupHeadings(choices: readonly Pick<ModelChoice, "group">[]): (string | null)[] {
  let lastGroup: string | null = null;
  return choices.map((choice) => {
    const heading = choice.group && choice.group !== lastGroup ? choice.group : null;
    lastGroup = choice.group ?? lastGroup;
    return heading;
  });
}

/** The one choice in the tab order: the current model, else the first that can be chosen. */
export function entryChoiceId(choices: readonly ModelChoice[], current: string | null): string | undefined {
  const entry = choices.find((choice) => choice.id === current && !choice.blocked)
    ?? choices.find((choice) => !choice.blocked);
  return entry?.id;
}

export interface ModeChoice {
  id: string;
  name: string;
  blocked: boolean;
}

/** The modes the agent offers, in its order. */
export function modeChoices(mode: ModeControl): ModeChoice[] {
  if (mode.kind === "legacy") return mode.modes;
  if (mode.option.kind.type !== "select") return [];
  return mode.option.kind.options.map((choice) => ({ id: choice.value, name: choice.name, blocked: choice.blocked }));
}

/** The id of the mode the agent is in, when it reports one. */
export function currentModeId(mode: ModeControl): string | null {
  if (mode.kind === "legacy") return mode.current;
  return mode.option.kind.type === "select" ? mode.option.kind.currentValue : null;
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
      return enabled.at(-1) ?? null;
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
