import { describe, expect, it } from "vitest";
import { encodeAttachmentUpload } from "./attachments";

describe("encodeAttachmentUpload", () => {
  it("frames an upload exactly as the Rust decoder expects", () => {
    const body = encodeAttachmentUpload(
      { projectId: "p1", name: "é.pdf", mime: "application/pdf" },
      new Uint8Array([1, 2, 3]),
    );
    const json = new TextEncoder().encode(
      '{"projectId":"p1","name":"é.pdf","mime":"application/pdf"}',
    );
    expect(json).toHaveLength(59);
    expect(Array.from(body.slice(0, 4))).toEqual([59, 0, 0, 0]);
    expect(Array.from(body.slice(4, 4 + json.length))).toEqual(Array.from(json));
    expect(Array.from(body.slice(-3))).toEqual([1, 2, 3]);
    expect(body).toHaveLength(4 + 59 + 3);
  });

  it("writes a null project for chats outside a project", () => {
    const body = encodeAttachmentUpload(
      { projectId: null, name: "a.txt", mime: "text/plain" },
      new Uint8Array(),
    );
    const header = new TextDecoder().decode(body.slice(4));
    expect(JSON.parse(header)).toEqual({ projectId: null, name: "a.txt", mime: "text/plain" });
  });
});
