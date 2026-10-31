import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  normalizeAttachment: vi.fn(),
  attachmentPut: vi.fn(),
  attachmentPutText: vi.fn(),
  errorUnique: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/attachments-normalize", () => ({ normalizeAttachment: mocks.normalizeAttachment }));
vi.mock("@/lib/attachments", () => ({
  attachmentPut: mocks.attachmentPut,
  attachmentPutText: mocks.attachmentPutText,
}));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: mocks.errorUnique } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { draftAttachmentRefs, draftAttachments, useComposerDrafts } from "@/store/composer-drafts";
import {
  AttachmentError,
  attachmentKind,
  intakeFiles,
  readDroppedFiles,
  rejectionMessage,
  screenFiles,
} from "./attachments-intake";

const COMPOSER = "p1:builtin";

function file(name: string, type = "", size = 10): File {
  const created = new File([new Uint8Array([1])], name, { type });
  Object.defineProperty(created, "size", { value: size });
  return created;
}

function stored(name: string, sha: string, mime = "image/png") {
  return { sha256: sha, name, mime, size: 1, pages: null, hasText: false };
}

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

beforeEach(() => {
  vi.resetAllMocks();
  useComposerDrafts.setState({ drafts: {} });
});

describe("screening", () => {
  it("classifies images, PDFs and text files by type or extension, in any case", () => {
    expect(attachmentKind({ name: "SCAN.PDF", type: "" })).toBe("pdf");
    expect(attachmentKind({ name: "notes.TeX", type: "" })).toBe("text");
    expect(attachmentKind({ name: "photo.HEIC", type: "" })).toBe("image");
    expect(attachmentKind({ name: "x.json", type: "application/json" })).toBe("text");
    expect(attachmentKind({ name: "deck.pptx", type: "" })).toBeNull();
  });

  it("accepts at most 10 files per message and rejects the rest as too many", () => {
    const files = Array.from({ length: 12 }, (_, index) => file(`f${index}.png`, "image/png"));
    const { accepted, rejected } = screenFiles(files, 1);
    expect(accepted).toHaveLength(9);
    expect(rejected.map((item) => item.reason)).toEqual(["tooMany", "tooMany", "tooMany"]);
  });

  it("rejects images over 20 MB, PDFs over 32 MB and text over 2 MB without reading them", () => {
    const { accepted, rejected } = screenFiles(
      [
        file("big.png", "image/png", 21 * 1024 * 1024),
        file("big.pdf", "application/pdf", 33 * 1024 * 1024),
        file("big.txt", "text/plain", 3 * 1024 * 1024),
        file("ok.pdf", "application/pdf", 31 * 1024 * 1024),
      ],
      0,
    );
    expect(accepted.map((item) => item.file.name)).toEqual(["ok.pdf"]);
    expect(rejected.map((item) => [item.name, item.reason])).toEqual([
      ["big.png", "tooLarge"],
      ["big.pdf", "tooLarge"],
      ["big.txt", "tooLarge"],
    ]);
  });

  it("rejects kinds the caller does not take", () => {
    const { rejected } = screenFiles([file("a.pdf", "application/pdf")], 0, ["image"]);
    expect(rejected).toEqual([{ name: "a.pdf", reason: "unsupported" }]);
  });

  it("reports all rejected files in one toast", async () => {
    await intakeFiles(
      [file("a.pptx"), file("b.pptx"), file("c.png", "image/png", 25 * 1024 * 1024)],
      { composerId: COMPOSER, scope: "p1" },
    );
    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
    const [key, message] = mocks.errorUnique.mock.calls[0];
    expect(key).toBe("ai-attach");
    expect(message).toContain("a.pptx");
    expect(message).toContain("b.pptx");
    expect(message).toContain("c.png");
    expect(
      rejectionMessage([
        { name: "x", reason: "tooMany" },
        { name: "y", reason: "tooMany" },
      ]),
    ).toBe(en.attachments.tooMany.replace("{{max}}", "10"));
  });
});

describe("intake", () => {
  it("shows processing chips, then marks each one ready with its hash, size and pages", async () => {
    let resolve!: (value: unknown) => void;
    mocks.normalizeAttachment.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mocks.attachmentPut.mockResolvedValue({ ...stored("a.png", "h1"), size: 5 });
    const running = intakeFiles([file("a.png", "image/png")], { composerId: COMPOSER, scope: "p1" });
    await vi.waitFor(() => expect(draftAttachments(COMPOSER)).toHaveLength(1));
    expect(draftAttachments(COMPOSER)[0].status).toBe("processing");
    resolve({ name: "a.png", mime: "image/png", bytes: new Uint8Array([1]), thumbnailUrl: "data:t" });
    await running;
    expect(draftAttachments(COMPOSER)[0]).toMatchObject({
      status: "ready",
      sha256: "h1",
      size: 5,
      thumbnailUrl: "data:t",
    });
  });

  it("stores PDF text and scanned page images beside the PDF", async () => {
    mocks.normalizeAttachment.mockResolvedValue({
      name: "scan.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array([1]),
      pages: 4,
      text: "[Page 1]\nx",
      pageImages: [
        { mime: "image/png", bytes: new Uint8Array([2]) },
        { mime: "image/png", bytes: new Uint8Array([3]) },
      ],
    });
    mocks.attachmentPut
      .mockResolvedValueOnce(stored("scan.pdf", "pdf", "application/pdf"))
      .mockResolvedValueOnce(stored("scan.pdf page 1.png", "i1"))
      .mockResolvedValueOnce(stored("scan.pdf page 2.png", "i2"));
    mocks.attachmentPutText.mockResolvedValue(undefined);
    await intakeFiles([file("scan.pdf", "application/pdf")], { composerId: COMPOSER, scope: "p1" });
    expect(mocks.attachmentPutText).toHaveBeenCalledWith("p1", "pdf", "[Page 1]\nx", 4);
    expect(mocks.attachmentPut.mock.calls[1][1]).toBe("scan.pdf page 1.png");
    expect(draftAttachments(COMPOSER)[0]).toMatchObject({
      status: "ready",
      pages: 4,
      hasText: true,
      pageImages: [
        { sha256: "i1", mime: "image/png" },
        { sha256: "i2", mime: "image/png" },
      ],
    });
  });

  it("keeps the page images in page order when their stores finish out of order", async () => {
    mocks.normalizeAttachment.mockResolvedValue({
      name: "scan.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array([1]),
      pages: 4,
      pageImages: [
        { mime: "image/png", bytes: new Uint8Array([2]) },
        { mime: "image/png", bytes: new Uint8Array([3]) },
      ],
    });
    let releaseFirstPage!: (value: ReturnType<typeof stored>) => void;
    const firstPage = new Promise<ReturnType<typeof stored>>((resolve) => {
      releaseFirstPage = resolve;
    });
    mocks.attachmentPut
      .mockResolvedValueOnce(stored("scan.pdf", "pdf", "application/pdf"))
      .mockReturnValueOnce(firstPage)
      .mockResolvedValueOnce(stored("scan.pdf page 2.png", "i2"));
    const running = intakeFiles([file("scan.pdf", "application/pdf")], { composerId: COMPOSER, scope: "p1" });
    await vi.waitFor(() => expect(mocks.attachmentPut).toHaveBeenCalledTimes(3));
    releaseFirstPage(stored("scan.pdf page 1.png", "i1"));
    await running;
    expect(draftAttachments(COMPOSER)[0].pageImages).toEqual([
      { sha256: "i1", mime: "image/png" },
      { sha256: "i2", mime: "image/png" },
    ]);
  });

  it("drops a second copy of a file already in the draft", async () => {
    mocks.normalizeAttachment.mockResolvedValue({
      name: "a.png",
      mime: "image/png",
      bytes: new Uint8Array([1]),
    });
    mocks.attachmentPut.mockResolvedValue(stored("a.png", "same"));
    await intakeFiles([file("a.png", "image/png")], { composerId: COMPOSER, scope: "p1" });
    await intakeFiles([file("copy.png", "image/png")], { composerId: COMPOSER, scope: "p1" });
    expect(draftAttachments(COMPOSER).map((item) => item.name)).toEqual(["a.png"]);
  });

  it("does not bring back an attachment removed while it was processing", async () => {
    let resolve!: (value: unknown) => void;
    mocks.normalizeAttachment.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const running = intakeFiles([file("a.png", "image/png")], { composerId: COMPOSER, scope: "p1" });
    await vi.waitFor(() => expect(draftAttachments(COMPOSER)).toHaveLength(1));
    useComposerDrafts.getState().removeAttachments(COMPOSER, [draftAttachments(COMPOSER)[0].id]);
    resolve({ name: "a.png", mime: "image/png", bytes: new Uint8Array([1]) });
    await running;
    expect(draftAttachments(COMPOSER)).toEqual([]);
    expect(mocks.attachmentPut).not.toHaveBeenCalled();
  });

  it("marks the chip ready in the composer its draft moved to while it was prepared", async () => {
    let resolve!: (value: unknown) => void;
    mocks.normalizeAttachment.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mocks.attachmentPut.mockResolvedValue(stored("a.png", "h1"));
    const running = intakeFiles([file("a.png", "image/png")], { composerId: COMPOSER, scope: "p1" });
    await vi.waitFor(() => expect(draftAttachments(COMPOSER)).toHaveLength(1));
    useComposerDrafts.getState().moveDraft(COMPOSER, "p1:builtin:chat-1");
    resolve({ name: "a.png", mime: "image/png", bytes: new Uint8Array([1]) });
    await running;
    expect(draftAttachments("p1:builtin:chat-1")[0]).toMatchObject({ status: "ready", sha256: "h1" });
    expect(draftAttachments(COMPOSER)).toEqual([]);
  });

  it("keeps stored files out of a collection until the chip lists them", async () => {
    mocks.normalizeAttachment.mockResolvedValue({
      name: "scan.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array([1]),
      pageImages: [{ mime: "image/png", bytes: new Uint8Array([2]) }],
    });
    let releasePage!: (value: ReturnType<typeof stored>) => void;
    mocks.attachmentPut
      .mockResolvedValueOnce(stored("scan.pdf", "pdf", "application/pdf"))
      .mockReturnValueOnce(new Promise((resolve) => { releasePage = resolve; }));
    const running = intakeFiles([file("scan.pdf", "application/pdf")], { composerId: COMPOSER, scope: "p1" });
    await vi.waitFor(() => expect(mocks.attachmentPut).toHaveBeenCalledTimes(2));
    expect(draftAttachments(COMPOSER)[0].sha256).toBeUndefined();
    expect(draftAttachmentRefs("p1")).toContain("pdf");
    releasePage(stored("scan.pdf page 1.png", "page"));
    await running;
    expect(draftAttachmentRefs("p1").sort()).toEqual(["page", "pdf"]);
    useComposerDrafts.getState().removeAttachments(COMPOSER, [draftAttachments(COMPOSER)[0].id]);
    expect(draftAttachmentRefs("p1")).toEqual([]);
  });

  it("turns a failed preparation into an error chip with a readable message", async () => {
    mocks.normalizeAttachment.mockRejectedValue(new AttachmentError("unreadableImage"));
    await intakeFiles([file("photo.heic", "")], { composerId: COMPOSER, scope: "p1" });
    expect(draftAttachments(COMPOSER)[0]).toMatchObject({
      status: "error",
      error: en.attachments.unreadableImage.replace("{{name}}", "photo.heic"),
    });
  });
});

describe("reading a native drop", () => {
  const item = (name: string, read = vi.fn(async () => file(name, "", 5))) => ({ name, read });

  it("reads only the items that could be attached, one after another", async () => {
    const order: string[] = [];
    const slow = item("paper.pdf", vi.fn(async () => {
      order.push("paper:start");
      await Promise.resolve();
      order.push("paper:end");
      return file("paper.pdf", "application/pdf");
    }));
    const next = item("notes.txt", vi.fn(async () => {
      order.push("notes");
      return file("notes.txt");
    }));
    const video = item("lecture.mp4");
    const archive = item("data.zip");
    const folder = item("results");

    const files = await readDroppedFiles([slow, video, next, archive, folder]);

    expect(files.map((value) => value.name)).toEqual(["paper.pdf", "notes.txt"]);
    expect(order).toEqual(["paper:start", "paper:end", "notes"]);
    expect(video.read).not.toHaveBeenCalled();
    expect(archive.read).not.toHaveBeenCalled();
    expect(folder.read).not.toHaveBeenCalled();
    expect(mocks.errorUnique).toHaveBeenCalledOnce();
    const message = mocks.errorUnique.mock.calls[0][1] as string;
    expect(message).toContain("lecture.mp4");
    expect(message).toContain("data.zip");
    expect(message).toContain("results");
  });

  it("keeps the files it could read when one cannot be read, and names that one", async () => {
    const broken = item("data.csv", vi.fn(async () => {
      throw new Error("Is a directory");
    }));

    const files = await readDroppedFiles([item("a.txt"), broken, item("b.txt")]);

    expect(files.map((value) => value.name)).toEqual(["a.txt", "b.txt"]);
    expect(mocks.errorUnique).toHaveBeenCalledWith("ai-attach", "data.csv could not be read.");
    expect(mocks.logError).toHaveBeenCalledWith("read dropped file", expect.any(Error));
  });

  it("reads no more than one message holds", async () => {
    const items = Array.from({ length: 12 }, (_, index) => item(`note-${index}.txt`));

    const files = await readDroppedFiles(items);

    expect(files).toHaveLength(10);
    expect(items[10].read).not.toHaveBeenCalled();
    expect(items[11].read).not.toHaveBeenCalled();
    expect(mocks.errorUnique.mock.calls[0][1]).toContain("10");
  });

  it("says nothing when everything was read", async () => {
    await readDroppedFiles([item("a.txt")]);
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });
});
