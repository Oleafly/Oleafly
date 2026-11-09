import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: class {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: vi.fn(async () => {}) }) }));

import { artifactFrameClose, artifactFrameOpen, artifactFramePutRuntime } from "./tauri";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue("ok");
});

describe("artifact frame commands", () => {
  it.each([
    ["opens a document", () => artifactFrameOpen("<p>x</p>"), "artifact_frame_open", { html: "<p>x</p>" }],
    ["closes a document", () => artifactFrameClose("abc"), "artifact_frame_close", { token: "abc" }],
    ["registers the runtime", () => artifactFramePutRuntime("runtime"), "artifact_frame_put_runtime", { text: "runtime" }],
  ])("%s", async (_name, call, command, args) => {
    await expect(call()).resolves.toBe("ok");
    expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });
});
