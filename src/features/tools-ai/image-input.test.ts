import { describe, expect, it, vi } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

vi.mock("./image-downscale", () => ({ downscaleImage: vi.fn() }));

import { downscaleImage } from "./image-downscale";
import {
  dataUrlToImageInput,
  IMAGE_BUDGETS,
  MAX_TOOL_IMAGE_BYTES,
  prepareImage,
  readEditorImageInput,
  readImageInput,
  sniffImageMime,
  type ImageInput,
} from "./image-input";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new TextEncoder().encode("RIFF1234WEBPVP8 ");
const GIF = new TextEncoder().encode("GIF89a......");

describe("Tools image input", () => {
  it("recognizes PNG, JPEG and WebP by their bytes and refuses GIF", async () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
    expect(sniffImageMime(GIF)).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
    await expect(readImageInput(new File([GIF], "notes.png", { type: "image/png" }))).rejects.toThrow(
      researchTools.converterErrors.imageFormat,
    );
    await expect(readImageInput(new File([JPEG], "photo.jpg"))).resolves.toEqual({
      bytes: JPEG,
      mime: "image/jpeg",
    });
  });

  it("refuses images over 20 MB before reading them", async () => {
    const arrayBuffer = vi.fn();
    const huge = { name: "phone.jpg", size: MAX_TOOL_IMAGE_BYTES + 1, arrayBuffer } as unknown as File;
    await expect(readImageInput(huge)).rejects.toThrow(researchTools.converterErrors.chooseSmallerImage);
    await expect(readEditorImageInput(huge)).rejects.toThrow(researchTools.converterErrors.chooseSmallerImage);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("lets the editor pick any image, drawing other formats again as PNG", async () => {
    const convert = vi.fn(async (): Promise<ImageInput> => ({ bytes: PNG, mime: "image/png" }));
    await expect(readEditorImageInput(new File([WEBP], "scan.webp"), convert)).resolves.toEqual({
      bytes: WEBP,
      mime: "image/webp",
    });
    expect(convert).not.toHaveBeenCalled();

    await expect(readEditorImageInput(new File([GIF], "board.gif", { type: "image/gif" }), convert)).resolves.toEqual({
      bytes: PNG,
      mime: "image/png",
    });
    expect(convert).toHaveBeenCalledExactlyOnceWith(
      { bytes: GIF, mime: "image/gif" },
      { maxEdge: null, maxBytes: MAX_TOOL_IMAGE_BYTES, accept: ["image/png"] },
    );
  });

  it("refuses an editor file that is not an image, or not the image its name says", async () => {
    const convert = vi.fn();
    for (const file of [
      new File([GIF], "notes.txt", { type: "text/plain" }),
      new File([GIF], "notes"),
      new File([GIF], "photo.png", { type: "image/png" }),
    ]) {
      await expect(readEditorImageInput(file, convert)).rejects.toThrow(researchTools.converterErrors.imageFormat);
    }
    expect(convert).not.toHaveBeenCalled();
  });

  it("draws the editor's image with the shared downscaler by default", async () => {
    vi.mocked(downscaleImage).mockResolvedValueOnce({ bytes: PNG, mime: "image/png" });
    await expect(readEditorImageInput(new File([GIF], "board.bmp", { type: "image/bmp" }))).resolves.toEqual({
      bytes: PNG,
      mime: "image/png",
    });
    expect(downscaleImage).toHaveBeenCalledWith(
      { bytes: GIF, mime: "image/bmp" },
      expect.objectContaining({ accept: ["image/png"] }),
    );
  });

  it("reads a rendered PDF page from its data URL", () => {
    expect(dataUrlToImageInput("data:image/png;base64,iVBORw0KGgo=")).toEqual({ bytes: PNG, mime: "image/png" });
    expect(() => dataUrlToImageInput("data:image/png;base64,AAAA")).toThrow(researchTools.converterErrors.imageFormat);
  });

  it("keeps the original bytes for a local model", async () => {
    const downscale = vi.fn();
    const prepared = await prepareImage({ bytes: PNG, mime: "image/png" }, IMAGE_BUDGETS.local, downscale);
    expect(downscale).not.toHaveBeenCalled();
    expect(prepared.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(prepared.base64).toBe("iVBORw0KGgo=");
    expect(prepared.mime).toBe("image/png");
  });

  it("sends every hosted image through the downscaler with the hosted budget", async () => {
    const smaller: ImageInput = { bytes: JPEG, mime: "image/jpeg" };
    const downscale = vi.fn(async () => smaller);
    const prepared = await prepareImage({ bytes: PNG, mime: "image/png" }, IMAGE_BUDGETS.hosted, downscale);
    expect(downscale).toHaveBeenCalledWith({ bytes: PNG, mime: "image/png" }, IMAGE_BUDGETS.hosted);
    expect(IMAGE_BUDGETS.hosted).toMatchObject({ maxEdge: 2_000, maxBytes: 3_750_000 });
    expect(prepared.dataUrl).toBe("data:image/jpeg;base64,/9j/4A==");
  });

  it("turns WebP into PNG or JPEG for Mathpix", async () => {
    const downscale = vi.fn(async (): Promise<ImageInput> => ({ bytes: JPEG, mime: "image/jpeg" }));
    await prepareImage({ bytes: WEBP, mime: "image/webp" }, IMAGE_BUDGETS.mathpix, downscale);
    expect(downscale).toHaveBeenCalledWith(
      { bytes: WEBP, mime: "image/webp" },
      expect.objectContaining({ maxEdge: 2_000, maxBytes: 1_450_000, accept: ["image/png", "image/jpeg"] }),
    );
  });

  it("shrinks a local image that is over the local byte budget", async () => {
    const downscale = vi.fn(async (input: ImageInput) => input);
    const big = new Uint8Array(MAX_TOOL_IMAGE_BYTES + 1);
    big.set(PNG);
    await prepareImage({ bytes: big, mime: "image/png" }, IMAGE_BUDGETS.local, downscale);
    expect(downscale).toHaveBeenCalledOnce();
  });
});
