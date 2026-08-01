// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { foldMarkerDOM } from "./fold-marker";

describe("foldMarkerDOM", () => {
  it("has intrinsic dimensions before the runtime theme is mounted", () => {
    const marker = foldMarkerDOM(true);
    const svg = marker.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("12");
    expect(svg?.getAttribute("height")).toBe("12");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
  });
});
