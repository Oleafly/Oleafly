// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { writeAppearanceStyle } from "./appearance-style";

describe("writing the style", () => {
  it("sets, changes and clears only what differs", () => {
    const element = document.createElement("div");
    const setProperty = vi.spyOn(element.style, "setProperty");
    const first = writeAppearanceStyle(element, {
      variables: { "--a": "1", "--b": "2" },
      attributes: { "data-x": "on", "data-y": null, spellcheck: "false" },
    });
    expect(element.style.getPropertyValue("--a")).toBe("1");
    expect(element.getAttribute("data-x")).toBe("on");
    expect(element.hasAttribute("data-y")).toBe(false);
    expect(setProperty).toHaveBeenCalledTimes(2);
    writeAppearanceStyle(element, { variables: { "--a": "1", "--c": "3" }, attributes: { "data-x": null } }, first);
    expect(setProperty).toHaveBeenCalledTimes(3);
    expect(element.style.getPropertyValue("--b")).toBe("");
    expect(element.style.getPropertyValue("--c")).toBe("3");
    expect(element.hasAttribute("data-x")).toBe(false);
    expect(element.hasAttribute("spellcheck")).toBe(false);
  });
});
