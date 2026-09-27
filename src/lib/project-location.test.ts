import { describe, expect, it } from "vitest";
import { isLibraryProject, projectLocation } from "./project-location";

describe("project location", () => {
  it("treats a project without a location as a library project", () => {
    expect(projectLocation({})).toEqual({ kind: "library" });
    expect(isLibraryProject({})).toBe(true);
  });

  it("recognises a folder opened in place", () => {
    const location = { kind: "linked", display_path: "~/thesis", availability: "unknown" } as const;
    expect(projectLocation({ location })).toBe(location);
    expect(isLibraryProject({ location })).toBe(false);
  });
});
