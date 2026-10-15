import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

const mocks = vi.hoisted(() => ({
  collabWriteText: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({}));
vi.mock("@/lib/tauri-collab", () => ({
  collabWriteText: mocks.collabWriteText,
}));

import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { SharedReadOnlyError, sharedBaseOption, sharedDocumentLive, writeSharedText } from "./shared-document-writes";

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  mocks.collabWriteText.mockReset().mockResolvedValue({ handled: true });
  useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false });
});

describe("writing through the shared document", () => {
  it("leaves a project that is not shared to the disk", async () => {
    expect(sharedDocumentLive("paper")).toBe(false);
    await expect(writeSharedText("paper", "main.tex", "new", "old")).resolves.toBe(false);
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
  });

  it("leaves a shared project that is still connecting to the disk", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: true });
    expect(sharedDocumentLive("paper")).toBe(false);
    await expect(writeSharedText("paper", "main.tex", "new", "old")).resolves.toBe(false);
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
  });

  it("leaves another project to the disk while one project is live", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    expect(sharedDocumentLive("thesis")).toBe(false);
    await expect(writeSharedText("thesis", "main.tex", "new")).resolves.toBe(false);
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
  });

  it("sends the text and the base it started from for a live project", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    expect(sharedDocumentLive("paper")).toBe(true);
    await expect(writeSharedText("paper", "refs.bib", "new", "old")).resolves.toBe(true);
    expect(mocks.collabWriteText).toHaveBeenCalledWith("paper", "refs.bib", "old", "new");
  });

  it("sends LF text and an LF base whatever line endings the writer used", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    await writeSharedText("paper", "refs.bib", "@book{a,\r\n}\r\n@book{b,\r}\r", "@book{a,\r\n}\r\n");
    expect(mocks.collabWriteText).toHaveBeenCalledWith("paper", "refs.bib", "@book{a,\n}\n", "@book{a,\n}\n@book{b,\n}\n");
  });

  it("sends no base when the writer has none", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    await writeSharedText("paper", "figures/a.tex", "body");
    expect(mocks.collabWriteText).toHaveBeenCalledWith("paper", "figures/a.tex", null, "body");
  });

  it("reports a file the shared document doesn't hold so the caller writes the disk", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    mocks.collabWriteText.mockResolvedValue({ handled: false });
    await expect(writeSharedText("paper", "notes.txt", "new", "old")).resolves.toBe(false);
  });

  it("refuses a write the shared document turned down because this person can only view", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    mocks.collabWriteText.mockResolvedValue({ handled: false, reason: "read_only" });
    const failure = await writeSharedText("paper", "refs.bib", "new", "old").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SharedReadOnlyError);
    expect(String(failure)).toContain(enCollab.access.viewOnly);
  });

  it("refuses a viewer's write without asking the shared document", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: true, connecting: false });
    await expect(writeSharedText("paper", "main.tex", "new", "old")).rejects.toBeInstanceOf(SharedReadOnlyError);
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
  });

  it("passes a failed shared write on to the caller", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    mocks.collabWriteText.mockRejectedValue(new Error("the project document is busy"));
    await expect(writeSharedText("paper", "main.tex", "new", "old")).rejects.toThrow("busy");
  });

  it("turns a structured shared write failure into an error with its message", async () => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    mocks.collabWriteText.mockRejectedValue({ code: "io", message: "the shared document could not be saved" });
    const failure = await writeSharedText("paper", "main.tex", "new", "old").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("the shared document could not be saved");
  });
});

describe("what a failed shared write reports", () => {
  beforeEach(() => {
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
  });

  it("falls back to the failure's code when it carries no message", async () => {
    mocks.collabWriteText.mockRejectedValue({ code: "conflict", message: "" });
    const failure = await writeSharedText("paper", "main.tex", "new").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("conflict");
  });

  it("passes on a failure with neither message nor code, or a plain string, unchanged", async () => {
    const bare = { detail: 4 };
    mocks.collabWriteText.mockRejectedValueOnce(bare).mockRejectedValueOnce("offline");
    await expect(writeSharedText("paper", "main.tex", "new")).rejects.toBe(bare);
    await expect(writeSharedText("paper", "main.tex", "new")).rejects.toBe("offline");
  });
});

describe("the base a writer hands to writeProjectFile", () => {
  it("is passed only for a live project, so other projects keep their exact call", () => {
    expect(sharedBaseOption("paper", "old")).toEqual([]);
    useCollabEditorGate.setState({ projectId: "paper", viewer: false, connecting: false });
    expect(sharedBaseOption("paper", "old")).toEqual([{ base: "old" }]);
    expect(sharedBaseOption("paper", undefined)).toEqual([]);
    expect(sharedBaseOption("thesis", "old")).toEqual([]);
    expect(sharedBaseOption(null, "old")).toEqual([]);
  });
});
