// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  logError: vi.fn(),
  linux: true,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  get isLinux() {
    return mocks.linux;
  },
}));

import { isNativeFileDrop, takeNativeDrop } from "./native-drop";

const drag = (types: string[]) => ({ types }) as unknown as DataTransfer;

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.logError.mockReset();
  mocks.linux = true;
});

describe("isNativeFileDrop", () => {
  it("claims only the link list WebKitGTK passes for files from a Linux file manager", () => {
    expect(isNativeFileDrop(drag(["text/uri-list", "text/html"]))).toBe(true);
    expect(isNativeFileDrop(drag(["text/uri-list", "text/plain"]))).toBe(false);
    expect(isNativeFileDrop(drag(["Files", "text/uri-list"]))).toBe(false);
    expect(isNativeFileDrop(drag(["text/plain"]))).toBe(false);
    expect(isNativeFileDrop(null)).toBe(false);
    mocks.linux = false;
    expect(isNativeFileDrop(drag(["text/uri-list", "text/html"]))).toBe(false);
  });
});

describe("takeNativeDrop", () => {
  it("names each dropped path and reads it only when asked", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "take_dropped_paths") return ["/home/a/Pictures/plot.png", "/home/a/paper.pdf", "/home/a/notes"];
      if (command === "read_dropped_file") return new Uint8Array([1, 2, 3]).buffer;
      throw new Error(command);
    });

    const dropped = await takeNativeDrop();

    expect(dropped.map(({ name }) => name)).toEqual(["plot.png", "paper.pdf", "notes"]);
    expect(mocks.invoke).not.toHaveBeenCalledWith("read_dropped_file", expect.anything());
    const plot = await dropped[0].read();
    const paper = await dropped[1].read();
    const notes = await dropped[2].read();
    expect([plot.name, plot.type, plot.size]).toEqual(["plot.png", "image/png", 3]);
    expect(paper.type).toBe("application/pdf");
    expect(notes.type).toBe("");
    expect(mocks.invoke).toHaveBeenCalledWith("read_dropped_file", { path: "/home/a/Pictures/plot.png" });
  });

  it("returns nothing and logs when the paths cannot be taken", async () => {
    mocks.invoke.mockRejectedValue(new Error("ipc down"));

    expect(await takeNativeDrop()).toEqual([]);
    expect(mocks.logError).toHaveBeenCalledWith("read dropped paths", expect.any(Error));
  });
});
