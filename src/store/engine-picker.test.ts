import { beforeEach, describe, expect, it } from "vitest";
import type { ImportCompatFinding } from "@oleafly/latex";
import {
  dismissEngineHint,
  engineHintDismissed,
  useEnginePickerStore,
} from "./engine-picker";

const finding = (id: string): ImportCompatFinding =>
  ({ id }) as ImportCompatFinding;

beforeEach(() => {
  localStorage.clear();
  useEnginePickerStore.setState({ open: false, source: "manual", findings: [] });
});

describe("useEnginePickerStore", () => {
  it("openPicker opens with the source and findings", () => {
    useEnginePickerStore
      .getState()
      .openPicker("compile-failure", [finding("minted")]);
    const state = useEnginePickerStore.getState();
    expect(state.open).toBe(true);
    expect(state.source).toBe("compile-failure");
    expect(state.findings.map((f) => f.id)).toEqual(["minted"]);
  });

  it("close keeps the findings for a re-open but closes the modal", () => {
    useEnginePickerStore.getState().openPicker("project-open", [finding("minted")]);
    useEnginePickerStore.getState().close();
    const state = useEnginePickerStore.getState();
    expect(state.open).toBe(false);
    expect(state.findings).toHaveLength(1);
  });
});

describe("engine hint dismissal memory", () => {
  it("is not dismissed before anything was recorded", () => {
    expect(engineHintDismissed("p1", [finding("minted")])).toBe(false);
  });

  it("remembers dismissed findings per project", () => {
    dismissEngineHint("p1", [finding("minted")]);
    expect(engineHintDismissed("p1", [finding("minted")])).toBe(true);
    expect(engineHintDismissed("p2", [finding("minted")])).toBe(false);
  });

  it("resurfaces the hint when a new gap appears", () => {
    dismissEngineHint("p1", [finding("minted")]);
    expect(
      engineHintDismissed("p1", [finding("minted"), finding("pythontex")]),
    ).toBe(false);
    dismissEngineHint("p1", [finding("pythontex")]);
    expect(
      engineHintDismissed("p1", [finding("minted"), finding("pythontex")]),
    ).toBe(true);
  });

  it("merges repeat dismissals instead of overwriting", () => {
    dismissEngineHint("p1", [finding("minted")]);
    dismissEngineHint("p1", [finding("biblatex-biber")]);
    expect(engineHintDismissed("p1", [finding("minted")])).toBe(true);
    expect(engineHintDismissed("p1", [finding("biblatex-biber")])).toBe(true);
  });
});
