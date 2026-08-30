import { describe, expect, it } from "vitest";
import { aiSettingsDestination } from "./ai-settings-navigation";

describe("AI settings navigation", () => {
  it("routes approval links to the project rules on the Providers tab", () => {
    expect(aiSettingsDestination("ai-approvals")).toEqual({
      tab: "providers",
      elementId: "ai-project-approvals",
    });
  });

  it("keeps the existing persona deep link and ignores unrelated targets", () => {
    expect(aiSettingsDestination("ai-personas")).toEqual({ tab: "personas" });
    expect(aiSettingsDestination("editor-fonts")).toBeNull();
  });

  it("routes skill recording links to the Skills preview", () => {
    expect(aiSettingsDestination("ai-skills")).toEqual({ tab: "skills" });
  });
});
