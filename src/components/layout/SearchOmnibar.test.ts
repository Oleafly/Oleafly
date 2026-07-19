import { describe, expect, it } from "vitest";
import type { ProjectInfo } from "@/lib/tauri";
import { projectMatches } from "./SearchOmnibar";

const project: ProjectInfo = {
  id: "project-1",
  name: "Paper",
  main_doc: "main.tex",
  engine: "xetex",
  kind: "document",
  created_at: 1,
  updated_at: 2,
  color: "#123456",
  has_preview: true,
  exports: [],
};

describe("project omnibar metadata matching", () => {
  it("indexes the user-facing Tectonic engine label", () => {
    expect(projectMatches(project, "tectonic", false)).toBe(true);
    expect(projectMatches(project, "engine:tectonic", false)).toBe(true);
  });

  it("treats prototype and unknown field names as non-matches", () => {
    expect(projectMatches(project, "toString:x", false)).toBe(false);
    expect(projectMatches(project, "constructor:x", false)).toBe(false);
    expect(projectMatches(project, "__proto__:x", false)).toBe(false);
    expect(projectMatches(project, "author:x", false)).toBe(false);
  });
});
