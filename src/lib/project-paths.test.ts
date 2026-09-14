import { describe, expect, it } from "vitest";
import { isManagedProjectPath } from "./project-paths";

describe("isManagedProjectPath", () => {
  it("matches the files the backend refuses to write as project files", () => {
    expect(isManagedProjectPath("project.json")).toBe(true);
    expect(isManagedProjectPath("Project.JSON")).toBe(true);
    expect(isManagedProjectPath(".oleafly/build/main.aux")).toBe(true);
    expect(isManagedProjectPath(".git/HEAD")).toBe(true);
    expect(isManagedProjectPath("/.oleafly/settings.json")).toBe(true);
  });

  it("leaves ordinary project files alone", () => {
    expect(isManagedProjectPath("main.tex")).toBe(false);
    expect(isManagedProjectPath("chapters/project.json")).toBe(false);
    expect(isManagedProjectPath("notes/.oleafly/x")).toBe(false);
    expect(isManagedProjectPath("project.json.bak")).toBe(false);
    expect(isManagedProjectPath("")).toBe(false);
  });
});
