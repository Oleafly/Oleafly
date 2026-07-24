// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getWysiwygMode, setWysiwygMode } from "./wysiwyg-mode";

describe("wysiwyg-mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false for a project that has never toggled", () => {
    expect(getWysiwygMode("proj-1")).toBe(false);
  });

  it("persists true/false per project id", () => {
    setWysiwygMode("proj-1", true);
    expect(getWysiwygMode("proj-1")).toBe(true);
    expect(getWysiwygMode("proj-2")).toBe(false);
    setWysiwygMode("proj-1", false);
    expect(getWysiwygMode("proj-1")).toBe(false);
  });
});
