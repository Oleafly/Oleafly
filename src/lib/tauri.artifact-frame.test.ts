import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: class {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: vi.fn(async () => {}) }) }));

import { artifactFrameClose, artifactFrameOpen, artifactFrameRuntimeUrl } from "./tauri";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue("ok");
});

describe("artifact frame commands", () => {
  it.each([
    ["opens a document", () => artifactFrameOpen("<p>x</p>"), "artifact_frame_open", { html: "<p>x</p>" }],
    ["closes a document", () => artifactFrameClose("abc"), "artifact_frame_close", { token: "abc" }],
  ])("%s", async (_name, call, command, args) => {
    await expect(call()).resolves.toBe("ok");
    expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });

  it("asks for the bundled runtime's address without sending anything", async () => {
    await expect(artifactFrameRuntimeUrl()).resolves.toBe("ok");
    expect(mocks.invoke).toHaveBeenCalledWith("artifact_frame_runtime_url");
    expect(mocks.invoke.mock.calls[0]).toHaveLength(1);
  });
});
