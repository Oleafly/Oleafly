import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  setFocus: vi.fn(async () => {}),
  channels: [] as Array<{ onmessage: (value: unknown) => void }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage: (value: unknown) => void = () => {};
    constructor() {
      mocks.channels.push(this);
    }
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: mocks.setFocus }) }));

import * as tauri from "./tauri";
import * as tauriCollab from "./tauri-collab";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.setFocus.mockClear();
  mocks.channels = [];
});

describe("IPC helpers with client-side logic", () => {
  it("focuses the current window", async () => {
    await tauri.focusCurrentWindow();
    expect(mocks.setFocus).toHaveBeenCalledOnce();
  });

  it("maps the figure cache reply to camel case", async () => {
    mocks.invoke.mockResolvedValue({ hash: "abc", already_cached: true });
    await expect(tauri.saveFigureToCache("fig", "AAAA", "\\draw;")).resolves.toEqual({ hash: "abc", alreadyCached: true });
    expect(mocks.invoke).toHaveBeenCalledWith("save_figure_to_cache", { name: "fig", pngBase64: "AAAA", tikz: "\\draw;" });
  });

  function dictionaryPayload(aff: string, dic: string, declared = aff.length): ArrayBuffer {
    const encoder = new TextEncoder();
    const affBytes = encoder.encode(aff);
    const dicBytes = encoder.encode(dic);
    const bytes = new Uint8Array(8 + affBytes.length + dicBytes.length);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(declared), true);
    bytes.set(affBytes, 8);
    bytes.set(dicBytes, 8 + affBytes.length);
    return bytes.buffer;
  }

  it("splits a dictionary payload into its affix and word files", async () => {
    mocks.invoke.mockResolvedValue(dictionaryPayload("SET UTF-8", "1\nword"));
    const result = await tauri.readDictionary("en_US");
    expect(mocks.invoke).toHaveBeenCalledWith("read_dictionary", { id: "en_US" });
    expect(new TextDecoder().decode(result.aff)).toBe("SET UTF-8");
    expect(new TextDecoder().decode(result.dic)).toBe("1\nword");
  });

  it.each([
    ["a payload with no content", new Uint8Array(8).buffer],
    ["an empty affix file", dictionaryPayload("", "1\nword")],
    ["an affix length past the end", dictionaryPayload("SET", "1\nw", 50)],
    ["no word file", dictionaryPayload("SET UTF-8", "")],
  ])("rejects %s", async (_label, payload) => {
    mocks.invoke.mockResolvedValue(payload);
    await expect(tauri.readDictionary("en_US")).rejects.toThrow("The spelling dictionary payload is incomplete.");
  });

  it("streams copy-into-library progress and detaches the listener afterwards", async () => {
    const onProgress = vi.fn();
    mocks.invoke.mockImplementation(async (_command: string, args: { onProgress: { onmessage: (value: unknown) => void } }) => {
      args.onProgress.onmessage({ phase: "copying", entriesDone: 1, entriesTotal: 2, bytesDone: 1, bytesTotal: 2 });
      return { projectId: "copy", leftOut: 0 };
    });
    await expect(tauri.copyLinkedIntoLibrary("p", "op", onProgress)).resolves.toEqual({ projectId: "copy", leftOut: 0 });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: "copying", entriesDone: 1 }));
    expect(mocks.invoke).toHaveBeenCalledWith("copy_linked_into_library", {
      projectId: "p",
      operationId: "op",
      onProgress: mocks.channels[0],
    });
    mocks.channels[0].onmessage({ phase: "copying" });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("detaches the progress listener when the copy fails", async () => {
    const onProgress = vi.fn();
    mocks.invoke.mockRejectedValue(new Error("disk full"));
    await expect(tauri.copyLinkedIntoLibrary("p", "op", onProgress)).rejects.toThrow("disk full");
    mocks.channels[0].onmessage({ phase: "copying" });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("opens a live document over a message channel", async () => {
    const onMessage = vi.fn();
    mocks.invoke.mockResolvedValue(null);
    await expect(tauriCollab.collabDocOpen("p", "main.tex", onMessage)).resolves.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("collab_doc_open", {
      projectId: "p",
      path: "main.tex",
      channel: mocks.channels[0],
    });
    mocks.channels[0].onmessage({ kind: "text" });
    expect(onMessage).toHaveBeenCalledWith({ kind: "text" });
  });

  it("sends a live document change and closes the channel with the token it opened", async () => {
    await tauriCollab.collabDocChange("p", "file-1", 4, [3, "x"]);
    expect(mocks.invoke).toHaveBeenCalledWith("collab_doc_change", { projectId: "p", fileId: "file-1", rev: 4, op: [3, "x"] });
    await tauriCollab.collabDocClose("p", "file-1", 7);
    expect(mocks.invoke).toHaveBeenCalledWith("collab_doc_close", { projectId: "p", fileId: "file-1", session: 7 });
  });

  it.each([
    ["without a setup code", undefined, null],
    ["with a setup code", "K7QX-2MPL", "K7QX-2MPL"],
  ])("signs in to a server with a code %s", async (_label, setupCode, sent) => {
    const onCode = vi.fn();
    const server = { server_id: "s" };
    mocks.invoke.mockResolvedValue(server);
    await expect(tauriCollab.collabServerCodeSignIn("https://uni.edu", setupCode, onCode)).resolves.toBe(server);
    expect(mocks.invoke).toHaveBeenCalledWith("collab_server_code_sign_in", {
      url: "https://uni.edu",
      setupCode: sent,
      onCode: mocks.channels[0],
    });
    mocks.channels[0].onmessage({ code: "ABCD" });
    expect(onCode).toHaveBeenCalledWith({ code: "ABCD" });
  });
});
