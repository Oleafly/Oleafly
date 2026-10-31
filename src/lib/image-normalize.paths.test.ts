// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/toast", () => ({ toast: { errorUnique: vi.fn() } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const OPTIONS = { maxEdge: 2048, thumbEdge: 96 };

function bitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

function stubCanvas(options: { transparent?: boolean; encodes?: string[] } = {}) {
  const encodes = options.encodes ?? ["image/webp", "image/png", "image/jpeg"];
  const context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      if (options.transparent) data[3] = 0;
      return { data };
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,THUMB");
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => {
    // A webview that can't encode a type returns PNG instead, as browsers do.
    const mime = type && encodes.includes(type) ? type : "image/png";
    callback(new Blob([new Uint8Array([1, 2, 3])], { type: mime }));
  });
  return context;
}

function photo(name: string, type: string, size = 4_000_000): File {
  return new File([new Uint8Array(size)], name, { type });
}

function stubWorker(answer: (job: { id: number }) => Record<string, unknown> | "crash" | "silent") {
  const created: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    terminate = vi.fn();
    constructor() {
      created.push(this);
    }
    postMessage(job: { id: number }) {
      queueMicrotask(() => {
        const reply = answer(job);
        if (reply === "silent") return;
        if (reply === "crash") this.onerror?.();
        else this.onmessage?.({ data: { id: job.id, ...reply } });
      });
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", class {});
  return created;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("normalizing an image on the main thread", () => {
  it("shrinks a large photo to WebP and makes a thumbnail", async () => {
    const decoded = bitmap(4096, 2048);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(decoded));
    const context = stubCanvas();
    const { normalizeImage } = await import("./image-normalize");

    const result = await normalizeImage(photo("photo.jpg", "image/jpeg"), OPTIONS);

    expect(result).toMatchObject({ mime: "image/webp", width: 2048, height: 1024, thumbnailUrl: "data:image/jpeg;base64,THUMB" });
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(context.getImageData).not.toHaveBeenCalled();
    expect(decoded.close).toHaveBeenCalledOnce();
  });

  it("falls back to JPEG where the webview can't encode WebP", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap(4096, 2048)));
    stubCanvas({ encodes: ["image/png", "image/jpeg"] });
    const { normalizeImage } = await import("./image-normalize");

    expect((await normalizeImage(photo("photo.jpg", "image/jpeg"), OPTIONS)).mime).toBe("image/jpeg");
  });

  it("keeps a transparent image as PNG", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap(3000, 3000)));
    const context = stubCanvas({ transparent: true });
    const { normalizeImage } = await import("./image-normalize");

    const result = await normalizeImage(photo("figure.png", "image/png"), OPTIONS);

    expect(result).toMatchObject({ mime: "image/png", width: 2048, height: 2048 });
    expect(context.getImageData).toHaveBeenCalledOnce();
  });

  it("sends a small file byte for byte and only draws its thumbnail", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap(120, 80)));
    const context = stubCanvas();
    const { normalizeImage } = await import("./image-normalize");
    const file = new File([new Uint8Array([9, 8, 7])], "icon.png", { type: "image/png" });

    const result = await normalizeImage(file, OPTIONS);

    expect([...result.bytes]).toEqual([9, 8, 7]);
    expect(result).toMatchObject({ mime: "image/png", width: 120, height: 80 });
    expect(context.drawImage).toHaveBeenCalledOnce();
  });

  it("names the image unreadable when the canvas has no 2D context", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap(4096, 2048)));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { normalizeImage } = await import("./image-normalize");

    await expect(normalizeImage(photo("photo.jpg", "image/jpeg"), OPTIONS)).rejects.toThrow("no 2d context");
  });
});

describe("rasterizing an SVG", () => {
  // jsdom has no image decoding; each test says how decode() ends.
  const decodeWith = (decode: () => Promise<void>) =>
    Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: decode });

  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:svg"), revokeObjectURL: vi.fn() }));
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
  });

  it("draws it to a PNG of its natural size, 1,024 pixels when it has none", async () => {
    decodeWith(async () => {});
    stubCanvas();
    const { normalizeImage } = await import("./image-normalize");
    const file = new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "diagram.svg", { type: "image/svg+xml" });

    const result = await normalizeImage(file, OPTIONS);

    expect(result).toMatchObject({ mime: "image/png", width: 1024, height: 1024, thumbnailUrl: "data:image/jpeg;base64,THUMB" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:svg");
  });

  it("names an SVG the webview can't decode unreadable", async () => {
    decodeWith(async () => {
      throw new Error("bad svg");
    });
    const { normalizeImage } = await import("./image-normalize");
    const file = new File(["<svg"], "broken.svg", { type: "" });

    await expect(normalizeImage(file, OPTIONS)).rejects.toMatchObject({ reason: "unreadableImage" });
  });
});

describe("normalizing an image in the worker", () => {
  it("uses the worker's encoding", async () => {
    const created = stubWorker(() => ({ ok: true, bytes: new Uint8Array([4, 5]).buffer, mime: "image/webp", thumbnailUrl: "data:t" }));
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap(4096, 2048)));
    const context = stubCanvas();
    const { normalizeImage } = await import("./image-normalize");

    const result = await normalizeImage(photo("photo.jpg", "image/jpeg"), OPTIONS);

    expect(result).toMatchObject({ mime: "image/webp", width: 2048, height: 1024, thumbnailUrl: "data:t" });
    expect([...result.bytes]).toEqual([4, 5]);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it("decodes again and encodes on the main thread when the worker fails", async () => {
    stubWorker(() => ({ ok: false, error: "no OffscreenCanvas encoder" }));
    const decode = vi.fn().mockResolvedValue(bitmap(4096, 2048));
    vi.stubGlobal("createImageBitmap", decode);
    stubCanvas();
    const { normalizeImage } = await import("./image-normalize");
    const { logError } = await import("@/lib/log");

    const result = await normalizeImage(photo("photo.jpg", "image/jpeg"), OPTIONS);

    expect(result.mime).toBe("image/webp");
    expect(decode).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith("image worker", expect.any(Error));
  });

  it("drops a crashed worker and starts a new one for the next image", async () => {
    let calls = 0;
    const created = stubWorker(() => (++calls === 1 ? "crash" : { ok: true, thumbnailUrl: "data:t" }));
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap(120, 80)));
    stubCanvas();
    const { normalizeImage } = await import("./image-normalize");
    const small = () => new File([new Uint8Array([1])], "icon.png", { type: "image/png" });

    expect((await normalizeImage(small(), OPTIONS)).thumbnailUrl).toBe("data:image/jpeg;base64,THUMB");
    expect(created[0].terminate).toHaveBeenCalledOnce();
    expect((await normalizeImage(small(), OPTIONS)).thumbnailUrl).toBe("data:t");
    expect(created).toHaveLength(2);
  });

  it("stops a worker that never answers, so the next image gets a new one", async () => {
    vi.useFakeTimers();
    try {
      const created = stubWorker((job) => (job.id === 1 ? "silent" : { ok: true, thumbnailUrl: "data:t" }));
      vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap(120, 80)));
      stubCanvas();
      const { normalizeImage } = await import("./image-normalize");
      const small = () => new File([new Uint8Array([1])], "icon.png", { type: "image/png" });

      const stuck = normalizeImage(small(), OPTIONS);
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await stuck).thumbnailUrl).toBe("data:image/jpeg;base64,THUMB");
      expect(created[0].terminate).toHaveBeenCalledOnce();
      expect((await normalizeImage(small(), OPTIONS)).thumbnailUrl).toBe("data:t");
      expect(created).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the worker go once no image has needed it for a while", async () => {
    vi.useFakeTimers();
    try {
      const created = stubWorker(() => ({ ok: true, thumbnailUrl: "data:t" }));
      vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap(120, 80)));
      stubCanvas();
      const { normalizeImage } = await import("./image-normalize");
      const small = () => new File([new Uint8Array([1])], "icon.png", { type: "image/png" });

      await normalizeImage(small(), OPTIONS);
      expect(created).toHaveLength(1);
      expect(created[0].terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(created[0].terminate).toHaveBeenCalledOnce();
      await normalizeImage(small(), OPTIONS);
      expect(created).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
