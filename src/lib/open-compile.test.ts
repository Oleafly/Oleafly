import { describe, expect, it } from "vitest";
import {
  agentCompileAllowed,
  automaticCompileAllowed,
  type OpenCompileObservation,
  type OpenCompileRequest,
  openCompileHydrated,
  resetOpenCompileMarker,
  settleOpenCompile,
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

describe("automaticCompileAllowed", () => {
  it("allows automatic compiles only once a main document is decided", () => {
    expect(automaticCompileAllowed("auto")).toBe(true);
    expect(automaticCompileAllowed("ask")).toBe(false);
    expect(automaticCompileAllowed("no_main")).toBe(false);
  });
});

describe("agentCompileAllowed", () => {
  it("lets the agent compile unless the folder has no main document", () => {
    expect(agentCompileAllowed("auto")).toBe(true);
    expect(agentCompileAllowed("ask")).toBe(true);
    expect(agentCompileAllowed("no_main")).toBe(false);
  });
});

describe("settleOpenCompile", () => {
  const request = (projectRevision: number): OpenCompileRequest => ({
    projectId: "project",
    mainDocument: "main.md",
    projectRevision,
  });
  const observed = (
    analysisProjectRevision: number,
    attempt: OpenCompileRequest | null,
    changes: Partial<OpenCompileObservation> = {},
  ): OpenCompileObservation => ({
    projectId: "project",
    mainDocument: "main.md",
    loading: false,
    analysisProjectId: "project",
    analysisProjectRevision,
    attempt,
    hasCurrentArtifact: false,
    ...changes,
  });

  it("settles a single compile whose revision held", () => {
    expect(settleOpenCompile(request(3), observed(3, request(3)), null)).toEqual({
      compiled: true,
      retries: null,
    });
    expect(
      settleOpenCompile(request(3), observed(3, null, { hasCurrentArtifact: true }), null),
    ).toEqual({ compiled: true, retries: null });
  });

  it("retries once when the revision moved during a started compile, then settles", () => {
    const first = settleOpenCompile(request(3), observed(4, request(3)), null);
    expect(first).toEqual({ compiled: false, retries: { projectId: "project", used: 1 } });
    const second = settleOpenCompile(request(4), observed(5, request(4)), first.retries);
    expect(second).toEqual({ compiled: true, retries: null });
  });

  it("keeps retrying while a gate stops the attempt before it starts", () => {
    const stopped = settleOpenCompile(request(3), observed(4, null), null);
    expect(stopped).toEqual({ compiled: false, retries: null });
    const stale = settleOpenCompile(
      request(3),
      observed(4, { projectId: "project", mainDocument: "main.md", projectRevision: 2 }),
      { projectId: "project", used: 1 },
    );
    expect(stale).toEqual({ compiled: false, retries: { projectId: "project", used: 1 } });
    const otherMain = settleOpenCompile(
      request(3),
      observed(4, { projectId: "project", mainDocument: "other.md", projectRevision: 3 }),
      null,
    );
    expect(otherMain.compiled).toBe(false);
  });

  it("never settles for a project or main document that changed meanwhile", () => {
    expect(
      settleOpenCompile(request(3), observed(3, request(3), { projectId: "other" }), null),
    ).toEqual({ compiled: false, retries: null });
    expect(
      settleOpenCompile(request(3), observed(3, request(3), { mainDocument: "other.md" }), null)
        .compiled,
    ).toBe(false);
    expect(
      settleOpenCompile(request(3), observed(3, request(3), { loading: true }), null).compiled,
    ).toBe(false);
  });

  it("settles only for an attempt made at the requested revision", () => {
    expect(settleOpenCompile(request(3), observed(3, request(4)), null)).toEqual({
      compiled: false,
      retries: null,
    });
    expect(settleOpenCompile(request(3), observed(3, request(2)), null)).toEqual({
      compiled: false,
      retries: null,
    });
  });

  it("ignores an attempt left from before the folder went unavailable and came back", () => {
    const beforeUnavailable = request(5);
    const reopened = settleOpenCompile(request(1), observed(1, beforeUnavailable), null);
    expect(reopened).toEqual({ compiled: false, retries: null });
    const again = settleOpenCompile(request(1), observed(1, beforeUnavailable), reopened.retries);
    expect(again).toEqual({ compiled: false, retries: null });
    const moved = settleOpenCompile(request(1), observed(2, beforeUnavailable), again.retries);
    expect(moved).toEqual({ compiled: false, retries: null });
    const spent = { projectId: "project", used: 1 };
    expect(settleOpenCompile(request(1), observed(1, beforeUnavailable), spent)).toEqual({
      compiled: false,
      retries: spent,
    });
    expect(settleOpenCompile(request(1), observed(1, request(1)), spent)).toEqual({
      compiled: true,
      retries: null,
    });
  });

  it("gives every project its own retry", () => {
    const spent = { projectId: "earlier", used: 1 };
    expect(settleOpenCompile(request(3), observed(4, request(3)), spent)).toEqual({
      compiled: false,
      retries: { projectId: "project", used: 1 },
    });
    expect(resetOpenCompileMarker(null, spent)).toBeNull();
  });
});
