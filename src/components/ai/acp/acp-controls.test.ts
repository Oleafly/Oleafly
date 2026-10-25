import { describe, expect, it } from "vitest";
import type { AcpSession } from "@/lib/acp";
import { booleanOption, choice, claudeOptions, codexOptions, geminiControls, selectOption } from "./tests/ui-fixtures";
import {
  currentModeId,
  currentModelId,
  currentName,
  entryChoiceId,
  groupControls,
  groupHeadings,
  listboxFocusTarget,
  modeChoices,
  modelChoices,
  type ModeControl,
  type ModelControl,
} from "./acp-controls";

const controls = (options: AcpSession["controls"]["options"]): AcpSession["controls"] => ({
  models: [],
  modelId: null,
  modelConfigId: null,
  options,
});

describe("agent controls", () => {
  it("groups Claude's options by category, never by id", () => {
    const groups = groupControls(controls(claudeOptions()));
    expect(groups.model).toMatchObject({ kind: "config", option: { id: "model" } });
    expect(groups.effort?.id).toBe("effort");
    expect(groups.mode).toMatchObject({ kind: "config", option: { id: "mode" } });
    expect(groups.modelConfig.map((option) => option.id)).toEqual(["fast"]);
    expect(groups.more).toEqual([]);
  });

  it("finds Codex's effort under its own id", () => {
    const groups = groupControls(controls(codexOptions()));
    expect(groups.effort?.id).toBe("reasoning_effort");
    expect(groups.mode).toMatchObject({ kind: "config", option: { id: "mode", name: "Approval preset" } });
    expect(groups.modelConfig).toEqual([]);
  });

  it("falls back to legacy models and modes", () => {
    const groups = groupControls(geminiControls());
    expect(groups.model).toEqual({
      kind: "legacy",
      models: [{ modelId: "gemini-3-pro", name: "Gemini 3 Pro" }, { modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
      current: "gemini-3-pro",
    });
    expect(groups.mode).toMatchObject({ kind: "legacy", current: "default" });
    expect(groups.mode?.kind === "legacy" && groups.mode.modes.map((mode) => mode.id)).toEqual(["default", "plan", "yolo"]);
    expect(groups.effort).toBeNull();
  });

  it("reports no model or mode when the agent has none", () => {
    const groups = groupControls({ models: [], modelId: null, modelConfigId: null });
    expect(groups).toEqual({ model: null, modelConfig: [], effort: null, mode: null, more: [] });
    const noModeId = groupControls({ ...geminiControls(), modeId: undefined });
    expect(noModeId.mode).toMatchObject({ kind: "legacy", current: null });
  });

  it("puts unknown categories under More and drops unsupported kinds", () => {
    const groups = groupControls(controls([
      ...claudeOptions(),
      selectOption("effort2", "Second effort", "thought_level", "low", [choice("low", "Low")]),
      selectOption("model2", "Second model", "model", "a", [choice("a", "A")]),
      booleanOption("model_switch", "Model switch", "model", true),
      selectOption("mode2", "Second mode", "mode", "x", [choice("x", "X")]),
      booleanOption("sandbox", "Sandbox", "_oleafly_custom", true),
      selectOption("verbosity", "Verbosity", null, "low", [choice("low", "Low"), choice("high", "High")]),
      { id: "matrix", name: "Matrix", description: null, category: "other", kind: { type: "unsupported", rawType: "matrix" } },
    ]));
    expect(groups.model).toMatchObject({ option: { id: "model" } });
    expect(groups.effort?.id).toBe("effort");
    expect(groups.mode).toMatchObject({ option: { id: "mode" } });
    expect(groups.more.map((option) => option.id)).toEqual([
      "effort2", "model2", "model_switch", "mode2", "sandbox", "verbosity",
    ]);
  });

  it("names the current choice of an option", () => {
    const [model, fast] = claudeOptions();
    expect(currentName(model)).toBe("Default (recommended)");
    expect(currentName(selectOption("m", "M", "model", "custom-id", [choice("a", "A")]))).toBe("custom-id");
    expect(currentName(selectOption("m", "M", "model", null, [choice("a", "A")]))).toBeNull();
    expect(currentName(fast)).toBeNull();
    expect(currentName(booleanOption("fast", "Fast", "model_config", true))).toBe("Fast");
    expect(currentName({ id: "x", name: "X", description: null, category: null, kind: { type: "unsupported", rawType: "x" } })).toBeNull();
  });
});

describe("model and mode choices", () => {
  it("lists a config model's choices with their groups, and the current one", () => {
    const { model } = groupControls(
      controls([
        selectOption("model", "Model", "model", "b", [
          choice("a", "A", { group: "Fast" }),
          choice("b", "B", { blocked: true }),
        ]),
      ]),
    );
    expect(modelChoices(model)).toEqual([
      { id: "a", name: "A", group: "Fast", blocked: false },
      { id: "b", name: "B", group: null, blocked: true },
    ]);
    expect(currentModelId(model)).toBe("b");
  });

  it("lists a legacy agent's models without groups", () => {
    const { model } = groupControls(geminiControls());
    expect(modelChoices(model).map((entry) => [entry.id, entry.group, entry.blocked])).toEqual([
      ["gemini-3-pro", null, false],
      ["gemini-3-flash", null, false],
    ]);
    expect(currentModelId(model)).toBe("gemini-3-pro");
  });

  it("offers no models when there is no list, or the option is not a select", () => {
    expect(modelChoices(null)).toEqual([]);
    expect(currentModelId(null)).toBeNull();
    const toggle: ModelControl = { kind: "config", option: booleanOption("model", "Model", "model", true) };
    expect(modelChoices(toggle)).toEqual([]);
    expect(currentModelId(toggle)).toBeNull();
  });

  it("shows a group heading where a group starts, not for ungrouped choices in between", () => {
    const group = (name: string | null) => ({ group: name });
    expect(groupHeadings([group(null), group("A"), group("A"), group(null), group("A"), group("B")])).toEqual([
      null,
      "A",
      null,
      null,
      null,
      "B",
    ]);
  });

  it("puts the current model in the tab order, else the first one that can be chosen", () => {
    const choices = [
      { id: "a", name: "A", group: null, blocked: true },
      { id: "b", name: "B", group: null, blocked: false },
      { id: "c", name: "C", group: null, blocked: false },
    ];
    expect(entryChoiceId(choices, "c")).toBe("c");
    expect(entryChoiceId(choices, "a")).toBe("b");
    expect(entryChoiceId(choices, null)).toBe("b");
    expect(entryChoiceId([choices[0]], null)).toBeUndefined();
  });

  it("lists a config agent's modes and the current one", () => {
    const { mode } = groupControls(
      controls([selectOption("mode", "Mode", "mode", "plan", [choice("default", "Default"), choice("plan", "Plan")])]),
    );
    if (!mode) throw new Error("expected a mode");
    expect(modeChoices(mode)).toEqual([
      { id: "default", name: "Default", blocked: false },
      { id: "plan", name: "Plan", blocked: false },
    ]);
    expect(currentModeId(mode)).toBe("plan");
  });

  it("lists a legacy agent's modes and the current one", () => {
    const { mode } = groupControls(geminiControls());
    if (!mode) throw new Error("expected a mode");
    expect(modeChoices(mode).map((entry) => entry.id)).toEqual(["default", "plan", "yolo"]);
    expect(currentModeId(mode)).toBe("default");
  });

  it("offers no modes when the mode option is not a select", () => {
    const toggle: ModeControl = { kind: "config", option: booleanOption("mode", "Mode", "mode", true) };
    expect(modeChoices(toggle)).toEqual([]);
    expect(currentModeId(toggle)).toBeNull();
  });
});

describe("listbox keys", () => {
  const labels = ["GPT-5.5", null, "GPT-5.5 mini", "Opus"];

  it("moves between the options that can be chosen", () => {
    expect(listboxFocusTarget(labels, 0, "ArrowDown")).toBe(2);
    expect(listboxFocusTarget(labels, 2, "ArrowUp")).toBe(0);
    expect(listboxFocusTarget(labels, 3, "ArrowDown")).toBe(3);
    expect(listboxFocusTarget(labels, 0, "ArrowUp")).toBe(0);
    expect(listboxFocusTarget(labels, -1, "ArrowDown")).toBe(0);
    expect(listboxFocusTarget(labels, -1, "ArrowUp")).toBe(3);
  });

  it("jumps to the ends", () => {
    expect(listboxFocusTarget(labels, 2, "Home")).toBe(0);
    expect(listboxFocusTarget(labels, 0, "End")).toBe(3);
  });

  it("finds an option by the start of its name, wrapping round", () => {
    expect(listboxFocusTarget(labels, 3, "g")).toBe(0);
    expect(listboxFocusTarget(labels, 0, "G")).toBe(2);
    expect(listboxFocusTarget(labels, 0, "o")).toBe(3);
    expect(listboxFocusTarget(labels, 0, "z")).toBeNull();
  });

  it("ignores other keys and a list with nothing to choose", () => {
    expect(listboxFocusTarget(labels, 0, "Enter")).toBeNull();
    expect(listboxFocusTarget(labels, 0, " ")).toBeNull();
    expect(listboxFocusTarget([null, null], 0, "ArrowDown")).toBeNull();
    expect(listboxFocusTarget([], 0, "Home")).toBeNull();
  });
});
