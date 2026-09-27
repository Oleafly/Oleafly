import { describe, expect, it } from "vitest";
import { isManagedProjectPath, isReadOnlyProjectPath } from "./project-paths";

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

describe("isReadOnlyProjectPath", () => {
  const tree = [
    { path: "refs.bib", is_dir: false, read_only: true },
    { path: "main.tex", is_dir: false },
    { path: "project.json", is_dir: false },
  ];

  it("treats a link to a file outside the folder as read-only", () => {
    expect(isReadOnlyProjectPath("refs.bib", "device", tree)).toBe(true);
    expect(isReadOnlyProjectPath("main.tex", "device", tree)).toBe(false);
  });

  it("keeps the managed files read-only", () => {
    expect(isReadOnlyProjectPath("project.json", "library", tree)).toBe(true);
    expect(isReadOnlyProjectPath(".git/HEAD", "device", [])).toBe(true);
    expect(isReadOnlyProjectPath("project.json", "device", tree)).toBe(false);
  });
});
