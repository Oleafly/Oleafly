import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channels: Array<{ onmessage: (message: unknown) => void }> = [];
  class FakeChannel {
    onmessage: (message: unknown) => void = () => {};
    constructor() {
      channels.push(this);
    }
  }
  return { invoke: vi.fn(), channels, FakeChannel };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: mocks.FakeChannel }));

import {
  isOverleafError,
  overleafImportProjects,
  overleafListProjects,
  overleafSignIn,
  overleafSignOut,
  overleafStatus,
} from "./overleaf";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.channels.length = 0;
});

describe("overleaf bridge", () => {
  it("passes a trimmed server or null to every command", async () => {
    mocks.invoke.mockResolvedValue({});
    await overleafStatus("  ");
    await overleafStatus(" https://latex.uni.edu ");
    await overleafSignIn(null, "Sign in");
    await overleafSignOut("https://www.overleaf.com");
    await overleafListProjects();
    expect(mocks.invoke.mock.calls).toEqual([
      ["overleaf_status", { server: null }],
      ["overleaf_status", { server: "https://latex.uni.edu" }],
      ["overleaf_sign_in", { server: null, title: "Sign in" }],
      ["overleaf_sign_out", { server: "https://www.overleaf.com" }],
      ["overleaf_list_projects", { server: null }],
    ]);
  });

  it("streams import events through a channel and detaches it afterwards", async () => {
    const events: unknown[] = [];
    mocks.invoke.mockImplementation(async (_command: string, args: { onEvent: { onmessage: (event: unknown) => void } }) => {
      args.onEvent.onmessage({ phase: "importing", remoteId: "a" });
      return [{ remoteId: "a", projectId: "p", error: null }];
    });
    const outcomes = await overleafImportProjects(undefined, ["a"], (event) => events.push(event));
    expect(outcomes).toEqual([{ remoteId: "a", projectId: "p", error: null }]);
    expect(events).toEqual([{ phase: "importing", remoteId: "a" }]);
    expect(mocks.invoke).toHaveBeenCalledWith("overleaf_import_projects", {
      server: null,
      ids: ["a"],
      onEvent: mocks.channels[0],
    });
    mocks.channels[0].onmessage({ phase: "late", remoteId: "a" });
    expect(events).toHaveLength(1);
  });

  it("recognizes coded errors from strings and errors", () => {
    const text = '@oleafly/error:{"code":"overleaf.session_expired","params":{}}';
    expect(isOverleafError(text, "session_expired")).toBe(true);
    expect(isOverleafError(new Error(text), "session_expired")).toBe(true);
    expect(isOverleafError(text, "signed_out")).toBe(false);
    expect(isOverleafError({ code: "x" }, "signed_out")).toBe(false);
  });
});
