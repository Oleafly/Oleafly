import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: vi.fn() }),
}));

import {
  agentListModels,
  agentModelMetadataStatus,
  agentProbeModel,
  agentRefreshModelMetadata,
  copyFile,
  createFile,
  deleteFile,
  importPathsIntoProject,
  onProjectWriteFailure,
  readFileContent,
  renameFile,
  saveFileBase64,
  writeFileContent,
  writeProjectBytes,
} from "./tauri";

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("model listing bridge", () => {
  it("passes the provider, key, and base URL in the backend's casing", async () => {
    mocks.invoke.mockResolvedValue([
      { id: "gpt-4o", name: "GPT-4o", trust: "verified" },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        trust: "blocked",
        blockedReason: "This preview model's thinking output breaks the assistant loop.",
      },
    ]);

    const models = await agentListModels({
      providerId: "google",
      key: "secret",
      baseURL: "https://example.test/v1",
    });

    expect(mocks.invoke).toHaveBeenCalledWith("agent_list_models", {
      providerId: "google",
      key: "secret",
      baseUrl: "https://example.test/v1",
    });
    expect(models[1].trust).toBe("blocked");
    expect(models[1].blockedReason).toContain("thinking output");
  });

  it("sends null for a missing key and base URL", async () => {
    mocks.invoke.mockResolvedValue([]);
    await agentListModels({ providerId: "openai" });
    expect(mocks.invoke).toHaveBeenCalledWith("agent_list_models", {
      providerId: "openai",
      key: null,
      baseUrl: null,
    });
  });
});

describe("model probe bridge", () => {
  it("runs the probe for one provider and model and returns the verdict verbatim", async () => {
    const verdict = { verdict: "blocked", reason: "No tool call came back.", probedAt: 42 };
    mocks.invoke.mockResolvedValue(verdict);

    const result = await agentProbeModel({ providerId: "openrouter", modelId: "meta/llama" });

    expect(mocks.invoke).toHaveBeenCalledWith("agent_probe_model", {
      providerId: "openrouter",
      modelId: "meta/llama",
      key: null,
      baseUrl: null,
    });
    expect(result).toEqual(verdict);
  });

  it("forwards an explicit key and base URL when given", async () => {
    mocks.invoke.mockResolvedValue({ verdict: "verified", reason: "", probedAt: 1 });
    await agentProbeModel({
      providerId: "acme",
      modelId: "acme-1",
      key: "secret",
      baseURL: "http://localhost:1234/v1",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("agent_probe_model", {
      providerId: "acme",
      modelId: "acme-1",
      key: "secret",
      baseUrl: "http://localhost:1234/v1",
    });
  });
});

describe("model metadata bridge", () => {
  it("reads the snapshot status without arguments", async () => {
    const status = { source: "bundled", generatedAt: "2026-08-20T12:00:00Z", refreshedAt: null };
    mocks.invoke.mockResolvedValue(status);
    expect(await agentModelMetadataStatus()).toEqual(status);
    expect(mocks.invoke).toHaveBeenCalledWith("agent_model_metadata_status");
  });

  it("refreshes the snapshot with an explicit force flag", async () => {
    const status = { source: "cdn", generatedAt: "2026-09-01T12:00:00Z", refreshedAt: 7 };
    mocks.invoke.mockResolvedValue(status);
    expect(await agentRefreshModelMetadata(true)).toEqual(status);
    expect(mocks.invoke).toHaveBeenCalledWith("agent_refresh_model_metadata", { force: true });

    await agentRefreshModelMetadata();
    expect(mocks.invoke).toHaveBeenLastCalledWith("agent_refresh_model_metadata", { force: false });
  });
});

describe("project write failures", () => {
  it("tells listeners which project refused a write and still rejects with the same error", async () => {
    const heard = vi.fn();
    const stop = onProjectWriteFailure(heard);
    const denied = "failed to write main.tex: Permission denied (os error 13)";
    try {
      mocks.invoke.mockRejectedValueOnce(denied);
      await expect(writeFileContent("linked-a", "main.tex", "x")).rejects.toBe(denied);
      mocks.invoke.mockRejectedValueOnce(denied);
      await expect(createFile("linked-a", "notes.tex", false)).rejects.toBe(denied);
      expect(heard).toHaveBeenCalledTimes(2);
      expect(heard).toHaveBeenCalledWith("linked-a");
    } finally {
      stop();
    }
  });

  it.each([
    ["writeProjectBytes", () => writeProjectBytes("linked-a", "figures/a.png", "AA==")],
    ["writeFileContent", () => writeFileContent("linked-a", "main.tex", "x")],
    ["createFile", () => createFile("linked-a", "notes.tex", false)],
    ["deleteFile", () => deleteFile("linked-a", "notes.tex")],
    ["renameFile", () => renameFile("linked-a", "notes.tex", "draft.tex")],
    ["copyFile", () => copyFile("linked-a", "notes.tex", "copy.tex")],
    ["importPathsIntoProject", () => importPathsIntoProject("linked-a", "figures", ["/tmp/a.png"])],
    ["saveFileBase64", () => saveFileBase64("linked-a", "out.pdf", "AA==")],
  ] as const)("reports a refused %s to listeners", async (_name, write) => {
    const heard = vi.fn();
    const stop = onProjectWriteFailure(heard);
    try {
      mocks.invoke.mockRejectedValueOnce("denied");
      await expect(write()).rejects.toBe("denied");
      expect(heard).toHaveBeenCalledExactlyOnceWith("linked-a");
    } finally {
      stop();
    }
  });

  it("stays quiet for successful writes, reads and removed listeners", async () => {
    const heard = vi.fn();
    const stop = onProjectWriteFailure(heard);
    mocks.invoke.mockResolvedValueOnce({ generation: 3 });
    await expect(writeProjectBytes("linked-a", "figures/a.png", "AA==")).resolves.toEqual({ generation: 3 });
    mocks.invoke.mockRejectedValueOnce("missing");
    await expect(readFileContent("linked-a", "main.tex")).rejects.toBe("missing");
    stop();
    mocks.invoke.mockRejectedValueOnce("denied");
    await expect(writeFileContent("linked-a", "main.tex", "x")).rejects.toBe("denied");
    expect(heard).not.toHaveBeenCalled();
  });
});
