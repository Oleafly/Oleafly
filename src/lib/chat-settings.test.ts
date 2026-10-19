import { describe, expect, it } from "vitest";
import { isWebOn, resolveRunEffort, runWebTools, WEB_DEFAULT_SUGGESTIONS, WEB_ON } from "./chat-settings";

describe("chat settings", () => {
  it("drops a stored effort the model does not offer", () => {
    expect(resolveRunEffort("max", ["low", "high"])).toBeUndefined();
    expect(resolveRunEffort("high", ["low", "high"])).toBe("high");
    expect(resolveRunEffort(undefined, ["low", "high"])).toBeUndefined();
  });

  it("sends web tools only when the toggle is on", () => {
    expect(runWebTools(undefined)).toBeUndefined();
    expect(runWebTools({ search: false, fetch: false })).toBeUndefined();
    expect(runWebTools(WEB_ON)).toEqual(WEB_ON);
    expect(isWebOn({ search: false, fetch: true })).toBe(true);
  });

  it("turns web on for the literature quick starts", () => {
    expect(WEB_DEFAULT_SUGGESTIONS.has("literature-sweep")).toBe(true);
    expect(WEB_DEFAULT_SUGGESTIONS.has("fix-errors")).toBe(false);
  });
});
