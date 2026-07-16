import { describe, expect, it } from "vitest";
import { buildAiToolInventory, buildToolContinuation } from "./ChatCore";

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

describe("AI tool continuation", () => {
  it("preserves reasoning before the tool call", () => {
    expect(
      buildToolContinuation("I should inspect the file.", "", [
        { id: "call-1", name: "read_file", args: { path: "main.tex" } },
      ]),
    ).toEqual([
      { type: "reasoning", text: "I should inspect the file." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "main.tex" },
      },
    ]);
  });
});
