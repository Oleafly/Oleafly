import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftAttachment } from "@/components/ai/composer/types";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  attachmentGc,
  attachmentMeta,
  attachmentNotice,
  attachmentObjectUrl,
  attachmentPut,
  attachmentRead,
  attachmentText,
  chatToDraftAttachment,
  draftToChatAttachment,
  holdAttachmentObjectUrl,
  storeToolImage,
} from "./attachments";

function draft(patch: Partial<DraftAttachment>): DraftAttachment {
  return {
    id: "d1",
    name: "fig.png",
    mime: "image/png",
    size: 10,
    status: "ready",
    kind: "image",
    scope: "p1",
    sha256: "a".repeat(64),
    ...patch,
  };
}

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

beforeEach(() => {
  invoke.mockReset();
});

describe("attachment IPC", () => {
  it("sends the bytes once as a framed raw body", async () => {
    invoke.mockResolvedValue({ sha256: "s" });
    await attachmentPut("p1", "Résumé 履歴.pdf", "application/pdf", new Uint8Array([1, 2, 3]));
    const [command, body] = invoke.mock.calls[0];
    expect(command).toBe("attachment_put");
    expect(body).toBeInstanceOf(Uint8Array);
    const length = new DataView((body as Uint8Array).buffer).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode((body as Uint8Array).slice(4, 4 + length)));
    expect(header).toEqual({ projectId: "p1", name: "Résumé 履歴.pdf", mime: "application/pdf" });
    expect(Array.from((body as Uint8Array).slice(-3))).toEqual([1, 2, 3]);
  });

  it("uses a null project for the global store", async () => {
    invoke.mockResolvedValue({ sha256: "s" });
    await attachmentPut(null, "a.txt", "text/plain", new Uint8Array());
    const body = invoke.mock.calls[0][1] as Uint8Array;
    const length = new DataView(body.buffer).getUint32(0, true);
    expect(JSON.parse(new TextDecoder().decode(body.slice(4, 4 + length))).projectId).toBeNull();
  });

  it("passes projectId and sha256 to read, meta, text and gc", async () => {
    invoke.mockResolvedValue(new TextEncoder().encode("hello").buffer);
    await attachmentRead("p1", "abc");
    expect(invoke).toHaveBeenLastCalledWith("attachment_read", { projectId: "p1", sha256: "abc" });
    await expect(attachmentText("p1", "abc")).resolves.toBe("hello");
    invoke.mockResolvedValue(null);
    await attachmentMeta(null, "abc");
    expect(invoke).toHaveBeenLastCalledWith("attachment_meta", { projectId: null, sha256: "abc" });
    invoke.mockResolvedValue(3);
    await expect(attachmentGc("p1", ["a"])).resolves.toBe(3);
    expect(invoke).toHaveBeenLastCalledWith("attachment_gc", { projectId: "p1", keep: ["a"] });
  });

  it("returns null text when the read fails", async () => {
    invoke.mockRejectedValue(new Error("gone"));
    await expect(attachmentText("p1", "abc")).resolves.toBeNull();
  });

  it("shares one read between concurrent object URL requests and revokes the oldest past 48", async () => {
    invoke.mockResolvedValue(new Uint8Array([1]).buffer);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const [first, second] = await Promise.all([
      attachmentObjectUrl("p1", "shared", "image/png"),
      attachmentObjectUrl("p1", "shared", "image/png"),
    ]);
    expect(first).toBe(second);
    expect(invoke).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 48; index += 1) {
      await attachmentObjectUrl("p1", `other-${index}`, "image/png");
    }
    expect(revoke).toHaveBeenCalledWith(first);
    revoke.mockRestore();
  });

  it("does not revoke an object URL something still shows until it lets go", async () => {
    invoke.mockResolvedValue(new Uint8Array([1]).buffer);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const shown = await attachmentObjectUrl("p1", "held", "image/png");
    const release = holdAttachmentObjectUrl(shown);
    const again = holdAttachmentObjectUrl(shown);
    for (let index = 0; index < 48; index += 1) {
      await attachmentObjectUrl("p1", `newer-${index}`, "image/png");
    }
    expect(revoke).not.toHaveBeenCalledWith(shown);
    release();
    release();
    expect(revoke).not.toHaveBeenCalledWith(shown);
    again();
    expect(revoke).toHaveBeenCalledWith(shown);
    const reread = await attachmentObjectUrl("p1", "held", "image/png");
    expect(reread).not.toBe(shown);
    revoke.mockRestore();
  });

  it("stores a tool screenshot from its data URL and returns its reference", async () => {
    invoke.mockResolvedValue({ sha256: "f".repeat(64), mime: "image/png" });
    const ref = await storeToolImage("p1", "data:image/png;base64,iVBORw0KGgo=");
    expect(ref).toEqual({ sha256: "f".repeat(64), mime: "image/png" });
    const body = invoke.mock.calls[0][1] as Uint8Array;
    const length = new DataView(body.buffer).getUint32(0, true);
    expect(JSON.parse(new TextDecoder().decode(body.slice(4, 4 + length))).name).toBe(
      "tool-image.png",
    );
    invoke.mockRejectedValue(new Error("disk full"));
    await expect(storeToolImage("p1", "data:image/png;base64,iVBORw0KGgo=")).resolves.toBeNull();
  });
});

describe("chat attachments", () => {
  it("maps a draft to the saved message attachment and back", () => {
    const original = draft({
      kind: "pdf",
      name: "paper.pdf",
      mime: "application/pdf",
      pages: 240,
      hasText: false,
      pageImages: [{ sha256: "b".repeat(64), mime: "image/png" }],
    });
    const saved = draftToChatAttachment(original);
    expect(saved).toMatchObject({
      name: "paper.pdf",
      mediaType: "application/pdf",
      sha256: original.sha256,
      size: 10,
      pages: 240,
      kind: "pdf",
    });
    const back = chatToDraftAttachment(saved, "p1");
    expect(back).toMatchObject({
      sha256: original.sha256,
      size: 10,
      pages: 240,
      kind: "pdf",
      pageImages: original.pageImages,
      status: "ready",
      scope: "p1",
    });
  });

  it("cannot rebuild a draft from an attachment saved before 0.4.8", () => {
    expect(chatToDraftAttachment({ name: "old.png", mediaType: "image/png" }, "p1")).toBeNull();
  });

  it("notes images a model cannot read", () => {
    expect(attachmentNotice([draft({})], { name: "GPT OSS", vision: false, nativePdf: false })).toBe(
      en.attachments.visionUnsupported.replace("{{model}}", "GPT OSS"),
    );
  });

  it("notes a scanned PDF when the model has neither vision nor PDF input", () => {
    const scanned = draft({ kind: "pdf", name: "scan.pdf", mime: "application/pdf", hasText: false });
    expect(attachmentNotice([scanned], { name: "M", vision: false, nativePdf: false })).toBe(
      en.attachments.scannedPdf.replace("{{name}}", "scan.pdf").replace("{{model}}", "M"),
    );
    expect(attachmentNotice([scanned], { name: "M", vision: false, nativePdf: true })).toBeNull();
  });

  it("stays quiet when the model can read everything attached", () => {
    expect(attachmentNotice([draft({})], { name: "M", vision: true, nativePdf: true })).toBeNull();
    expect(
      attachmentNotice([draft({ status: "processing" })], { name: "M", vision: false, nativePdf: false }),
    ).toBeNull();
  });
});
