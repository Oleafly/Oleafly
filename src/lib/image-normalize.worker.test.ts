import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { id: number; ok: boolean; bytes?: ArrayBuffer; mime?: string; thumbnailUrl?: string; error?: string };

const scope = {
  onmessage: null as ((event: { data: unknown }) => void) | null,
  postMessage: vi.fn(),
};

/** An OffscreenCanvas whose pixels are opaque unless `transparent`, and which encodes only `encodes`. */
function stubOffscreenCanvas(options: { transparent?: boolean; encodes?: string[]; noContext?: boolean } = {}) {
  const encodes = options.encodes ?? ["image/webp", "image/png", "image/jpeg"];
  const context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      if (options.transparent) data[7] = 10;
      return { data };
    }),
  };
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return options.noContext ? null : context;
      }
      async convertToBlob({ type }: { type: string }) {
        // WebKit answers a type it can't encode with PNG.
        return new Blob([new Uint8Array([1, 2])], { type: encodes.includes(type) ? type : "image/png" });
      }
    },
  );
  return context;
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    bitmap: { close: vi.fn() },
    width: 2048,
    height: 1024,
    thumbWidth: 96,
    thumbHeight: 48,
    detectAlpha: false,
    encode: true,
    ...overrides,
  };
}

async function run(message: ReturnType<typeof job>): Promise<Reply> {
  scope.onmessage?.({ data: message });
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalled());
  return scope.postMessage.mock.calls[0][0] as Reply;
}

beforeEach(async () => {
  vi.resetModules();
  scope.onmessage = null;
  scope.postMessage.mockReset();
  vi.stubGlobal("self", scope);
  vi.stubGlobal(
    "FileReaderSync",
    class {
      readAsDataURL() {
        return "data:image/jpeg;base64,THUMB";
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the image worker", () => {
  it("encodes to WebP, hands the bytes over and closes the bitmap", async () => {
    stubOffscreenCanvas();
    await import("./image-normalize.worker");
    const message = job();

    const reply = await run(message);

    expect(reply).toMatchObject({ id: 7, ok: true, mime: "image/webp", thumbnailUrl: "data:image/jpeg;base64,THUMB" });
    expect(scope.postMessage.mock.calls[0][1]).toEqual([reply.bytes]);
    expect(message.bitmap.close).toHaveBeenCalledOnce();
  });

  it("falls back to JPEG where WebP can't be encoded", async () => {
    stubOffscreenCanvas({ encodes: ["image/png", "image/jpeg"] });
    await import("./image-normalize.worker");

    expect((await run(job())).mime).toBe("image/jpeg");
  });

  it("keeps a transparent image as PNG", async () => {
    const context = stubOffscreenCanvas({ transparent: true });
    await import("./image-normalize.worker");

    expect((await run(job({ detectAlpha: true }))).mime).toBe("image/png");
    expect(context.getImageData).toHaveBeenCalledOnce();
  });

  it("only makes the thumbnail for an image sent as it is", async () => {
    const context = stubOffscreenCanvas();
    await import("./image-normalize.worker");

    const reply = await run(job({ encode: false }));

    expect(reply).toEqual({ id: 7, ok: true, thumbnailUrl: "data:image/jpeg;base64,THUMB" });
    expect(context.drawImage).toHaveBeenCalledOnce();
  });

  it("answers with the error when it can't draw", async () => {
    stubOffscreenCanvas({ noContext: true });
    await import("./image-normalize.worker");
    const message = job();

    expect(await run(message)).toEqual({ id: 7, ok: false, error: "no 2d context" });
    expect(message.bitmap.close).toHaveBeenCalledOnce();
  });
});
