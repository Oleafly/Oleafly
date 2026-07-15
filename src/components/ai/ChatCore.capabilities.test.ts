import { describe, expect, it } from "vitest";
import { buildAiToolInventory } from "./ChatCore";

describe("AI capability inventory", () => {
  it("omits source-map and figure tools when unavailable", () => {
    expect(buildAiToolInventory([], false, false)).not.toContain("project_map");
    expect(buildAiToolInventory([], true, false)).toEqual([]);
  });
  it("includes only capability-backed specialized tools", () => {
    expect(buildAiToolInventory(["document_index"], false, false)).toContain("project_map");
    expect(buildAiToolInventory([], true, true)).toEqual(["preview_figure", "insert_figure", "load_image"]);
  });
});
