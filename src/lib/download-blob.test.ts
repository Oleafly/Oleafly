// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, downloadBytes } from "./download-blob";

const OBJECT_URL = "blob:oleafly/download";

describe("downloadBlob", () => {
  const clicked: HTMLAnchorElement[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    clicked.length = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => OBJECT_URL),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks a download link for the blob and revokes its URL one task later", () => {
    const blob = new Blob(["hello"], { type: "text/plain" });

    downloadBlob(blob, "notes.txt");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].href).toBe(OBJECT_URL);
    expect(clicked[0].download).toBe("notes.txt");
    expect(clicked[0].rel).toBe("noopener");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it("still revokes the URL when the click throws", () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => downloadBlob(new Blob(["x"]), "x.bin")).toThrow("blocked");

    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it("wraps a copy of the bytes in a blob of the given type", async () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9]);
    const bytes = backing.subarray(1, 4);

    downloadBytes(bytes, "application/pdf", "paper.pdf");

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/pdf");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(clicked[0].download).toBe("paper.pdf");
  });
});
