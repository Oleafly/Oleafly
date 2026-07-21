/** pdf.js ImageKind: 1 = grayscale 1bpp, 2 = RGB 24bpp, 3 = RGBA 32bpp. */
export function rawToRgba(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  kind: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  if (kind === 3) {
    out.set(data.subarray(0, out.length));
    return out;
  }
  if (kind === 2) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out[i * 4] = data[j];
      out[i * 4 + 1] = data[j + 1];
      out[i * 4 + 2] = data[j + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = bit ? 255 : 0;
      const p = (y * width + x) * 4;
      out[p] = v;
      out[p + 1] = v;
      out[p + 2] = v;
      out[p + 3] = 255;
    }
  }
  return out;
}

/** pdf.js v6 usually hands decoded images over as an ImageBitmap. */
export function bitmapToPngDataUrl(bitmap: ImageBitmap, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

export function rgbaToPngDataUrl(rgba: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}
