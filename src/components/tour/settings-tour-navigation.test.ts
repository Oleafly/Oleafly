import { describe, expect, it } from "vitest";
import { settingsTourDestination } from "./settings-tour-navigation";

describe("settings tour navigation", () => {
  it("keeps the former MCP tour step on the assistant MCP destination", () => {
    expect(settingsTourDestination("settings-mcp")).toEqual({
      section: "ai",
      scrollTarget: "ai-mcp",
    });
  });

  it("routes ordinary settings steps without a tab target", () => {
    expect(settingsTourDestination("settings-integrations")).toEqual({
      section: "integrations",
    });
    expect(settingsTourDestination("unknown-step")).toBeNull();
  });
});
