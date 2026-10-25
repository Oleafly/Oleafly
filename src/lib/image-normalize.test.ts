import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/toast", () => ({ toast: { errorUnique: vi.fn() } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { fitWithin, hasTransparency, keepsOriginal, normalizeImage } from "./image-normalize";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image sizing", () => {
  it("fits large images inside 2,048 pixels and leaves small ones", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 6000, 2048)).toEqual({ width: 1024, height: 2048 });
    expect(fitWithin(1000, 800, 2048)).toEqual({ width: 1000, height: 800 });
  });

  it("keeps small PNG, JPEG, WebP and GIF files byte for byte", () => {
    const mb = 1024 * 1024;
    expect(keepsOriginal({ mime: "image/png", size: 3 * mb, width: 1200, height: 900 }, 2048)).toBe(true);
    expect(keepsOriginal({ mime: "image/png", size: 3 * mb, width: 3000, height: 2000 }, 2048)).toBe(false);
    expect(keepsOriginal({ mime: "image/jpeg", size: 6 * mb, width: 1200, height: 900 }, 2048)).toBe(false);
    expect(keepsOriginal({ mime: "image/heic", size: mb, width: 1200, height: 900 }, 2048)).toBe(false);
  });

  it("finds a single transparent pixel", () => {
    expect(hasTransparency(new Uint8ClampedArray([0, 0, 0, 255, 1, 1, 1, 255]))).toBe(false);
    expect(hasTransparency(new Uint8ClampedArray([0, 0, 0, 255, 1, 1, 1, 254]))).toBe(true);
  });

  it("rejects images the webview cannot decode", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("unsupported")));
    const file = new File([new Uint8Array([1])], "photo.heic", { type: "image/heic" });
    await expect(normalizeImage(file, { maxEdge: 2048, thumbEdge: 96 })).rejects.toMatchObject({
      reason: "unreadableImage",
    });
  });
});
