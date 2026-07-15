import { describe, expect, it } from "vitest";
import { resetOpenCompileMarker, shouldCompileOnOpen } from "./open-compile";

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
