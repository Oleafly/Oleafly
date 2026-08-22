import { describe, expect, it, vi } from "vitest";
import type { FileId } from "@oleafly/realtime-protocol";
import { FileSource } from "./file-source";

const FILE = "0198cf35-0000-7000-8000-000000000002" as FileId;

describe("FileSource", () => {
  it("applies incremental UTF-16 edits while retaining solo behavior", async () => {
    let content = "a🌿b";
    const write = vi.fn((_fileId: FileId, next: string) => {
      content = next;
    });
    const source = new FileSource({ read: () => content, write });
    const session = source.openText(FILE);

    session.apply([{ from: 1, to: 3, insert: "leaf" }], { origin: "human" });
    expect(session.snapshot().text).toBe("aleafb");
    session.undo();
    expect(session.snapshot().text).toBe("a🌿b");
    session.redo();
    await session.flushMaterialization();
    expect(content).toBe("aleafb");
    expect(write).toHaveBeenCalled();
  });

  it("does not load or initialize Yjs for solo sessions", async () => {
    vi.resetModules();
    vi.doMock("yjs", () => {
      throw new Error("solo FileSource loaded Yjs");
    });
    const module = await import("./file-source");
    const source = new module.FileSource({ read: () => "", write: () => {} });
    source.openText(FILE);
    expect(source.mode).toBe("solo");
    vi.doUnmock("yjs");
  });
});
