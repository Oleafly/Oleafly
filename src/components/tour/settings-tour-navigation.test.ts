import { describe, expect, it } from "vitest";
import { settingsTourDestination } from "./settings-tour-navigation";

describe("settings tour navigation", () => {
  it("ignores the removed MCP tour destination", () => {
    expect(settingsTourDestination("settings-mcp")).toBeNull();
  });

  it("routes ordinary settings steps without a tab target", () => {
    expect(settingsTourDestination("settings-integrations")).toEqual({
      section: "integrations",
    });
    expect(settingsTourDestination("unknown-step")).toBeNull();
  });
});
