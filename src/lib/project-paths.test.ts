import { describe, expect, it } from "vitest";
import { isManagedProjectPath } from "./project-paths";

describe("isManagedProjectPath", () => {
  it("matches the files the backend refuses to write as project files", () => {
    expect(isManagedProjectPath("project.json", "library")).toBe(true);
    expect(isManagedProjectPath("Project.JSON", "library")).toBe(true);
    expect(isManagedProjectPath(".oleafly/build/main.aux", "library")).toBe(true);
    expect(isManagedProjectPath(".git/HEAD", "library")).toBe(true);
    expect(isManagedProjectPath("/.oleafly/settings.json", "library")).toBe(true);
  });

  it("leaves ordinary project files alone", () => {
    expect(isManagedProjectPath("main.tex", "library")).toBe(false);
    expect(isManagedProjectPath("chapters/project.json", "library")).toBe(false);
    expect(isManagedProjectPath("notes/.oleafly/x", "library")).toBe(false);
    expect(isManagedProjectPath("project.json.bak", "library")).toBe(false);
    expect(isManagedProjectPath("", "library")).toBe(false);
  });

  it("treats a linked folder's own project.json as an ordinary file", () => {
    expect(isManagedProjectPath("project.json", "device")).toBe(false);
    expect(isManagedProjectPath("Project.JSON", "device_foreign")).toBe(false);
    expect(isManagedProjectPath("project.json", "folder")).toBe(true);
    expect(isManagedProjectPath(".git/HEAD", "device_foreign")).toBe(true);
    expect(isManagedProjectPath(".oleafly/build/main.aux", "device")).toBe(true);
  });
});
