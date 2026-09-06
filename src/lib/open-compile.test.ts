import { describe, expect, it } from "vitest";
import {
  openCompileHydrated,
  resetOpenCompileMarker,
  shouldCompileOnOpen,
} from "./open-compile";

describe("shouldCompileOnOpen", () => {
  it("defers the one-shot compile until the engine finishes loading", () => {
    expect(shouldCompileOnOpen("project", true, false, null, "split", "idle")).toBe(false);
    expect(shouldCompileOnOpen("project", true, true, null, "split", "idle")).toBe(true);
  });

  it("does not repeat the compile after the project is consumed", () => {
    expect(shouldCompileOnOpen("project", true, true, "project", "pdf", "success")).toBe(false);
  });

  it("waits for an active compile and retries after it finishes", () => {
    expect(shouldCompileOnOpen("project", true, true, null, "split", "compiling")).toBe(false);
    expect(shouldCompileOnOpen("project", true, true, null, "split", "success")).toBe(true);
  });

  it("clears the marker when the project closes so the same project can reopen", () => {
    const marker = resetOpenCompileMarker(null, "project");
    expect(marker).toBeNull();
    expect(shouldCompileOnOpen("project", true, true, marker, "split", "idle")).toBe(true);
  });
});

describe("openCompileHydrated", () => {
  it("waits for the project load and the first analysis revision", () => {
    expect(openCompileHydrated(true, "project", "project", 3)).toBe(false);
    expect(openCompileHydrated(false, "project", "project", 0)).toBe(false);
    expect(openCompileHydrated(false, "project", "other", 3)).toBe(false);
    expect(openCompileHydrated(false, null, null, 3)).toBe(false);
    expect(openCompileHydrated(false, "project", "project", 3)).toBe(true);
  });

  it("holds for a layout with no editor, whatever file the tree left active", () => {
    expect(openCompileHydrated(false, "project", "project", 1)).toBe(true);
  });
});
