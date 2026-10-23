import { describe, expect, it } from "vitest";
import type { AcpSession } from "@/lib/acp";
import { booleanOption, choice, claudeOptions, codexOptions, geminiControls, selectOption } from "./tests/ui-fixtures";
import { currentName, groupControls, listboxFocusTarget } from "./acp-controls";

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
