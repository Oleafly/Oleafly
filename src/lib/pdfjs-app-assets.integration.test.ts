import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMainThreadPdfWorker } from "@oleafly/preview/mainThreadWorker";
import { pdfDocumentOptions } from "@oleafly/preview/pdfDocumentOptions";
import { pdfjsAssets } from "../../vite.config";

type PdfJs = typeof import("pdfjs-dist");
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>;
type DecodedImage = { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray };
type PdfObject = { header: string; stream?: Uint8Array };

const RED_LEFT_BLUE_RIGHT_16X8_J2K =
  "/0//UQAvAAAAAAAQAAAACAAAAAAAAAAAAAAAEAAAAAgAAAAAAAAAAAADBwEBBwEBBwEB/1IADAAAAAEBAAQEAAH/XAAEQED/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAA7AAH/k8+0PBFQVK6ndU/wAAAAADCQl9+AUDu5Dymjol0BaD/fgFgUAFsZCq5Fih//f//Z";

const builtApp = new Map<string, Uint8Array>();
const requested: string[] = [];
let pdfjs: PdfJs;

class BuiltAppRequest {
  status = 0;
  response: ArrayBuffer | null = null;
  responseType = "";
  private url = "";

  open(_method: string, url: string) {
    this.url = url;
  }

  send() {
    requested.push(this.url);
    const bytes = builtApp.get(this.url);
    this.status = bytes ? 200 : 404;
    this.response = bytes ? bytes.slice().buffer : null;
  }
}

async function fetchFromBuiltApp(url: string | URL): Promise<Response> {
  requested.push(String(url));
  const bytes = builtApp.get(String(url));
  return bytes ? new Response(bytes.slice()) : new Response(null, { status: 404, statusText: "Not Found" });
}

function pdfWith(page: string, content: string, objects: PdfObject[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = ({ header, stream }: PdfObject) => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n${header}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };
  const contents = encoder.encode(content);
  push("%PDF-1.7\n");
  object({ header: "<< /Type /Catalog /Pages 2 0 R >>" });
  object({ header: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" });
  object({ header: `<< /Type /Page /Parent 2 0 R ${page} /Contents 4 0 R >>` });
  object({ header: `<< /Length ${contents.length} >>`, stream: contents });
  for (const extra of objects) object(extra);
  const xref = length;
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const pdf = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    pdf.set(part, at);
    at += part.length;
  }
  return pdf;
}

function jpxPdf(): Uint8Array {
  const codestream = Uint8Array.from(atob(RED_LEFT_BLUE_RIGHT_16X8_J2K), (char) => char.charCodeAt(0));
  return pdfWith("/MediaBox [0 0 16 8] /Resources << /XObject << /Im1 5 0 R >> >>", "q 16 0 0 8 0 0 cm /Im1 Do Q", [
    {
      header: `<< /Type /XObject /Subtype /Image /Width 16 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /Length ${codestream.length} >>`,
      stream: codestream,
    },
  ]);
}

function symbolPdf(): Uint8Array {
  return pdfWith("/MediaBox [0 0 200 50] /Resources << /Font << /F1 5 0 R >> >>", "BT /F1 12 Tf 10 20 Td (abg) Tj ET", [
    { header: "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>" },
  ]);
}

function shiftJisPdf(): Uint8Array {
  return pdfWith("/MediaBox [0 0 200 50] /Resources << /Font << /F1 5 0 R >> >>", "BT /F1 12 Tf 10 20 Td <93FA967B> Tj ET", [
    {
      header:
        "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3-90ms-RKSJ-H /Encoding /90ms-RKSJ-H /DescendantFonts [6 0 R] >>",
    },
    {
      header:
        "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R >>",
    },
    {
      header:
        "<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 6 /FontBBox [0 -141 1000 859] /ItalicAngle 0 /Ascent 859 /Descent -141 /CapHeight 709 /StemV 69 >>",
    },
  ]);
}

function cmykPdf(): Uint8Array {
  return pdfWith("/MediaBox [0 0 10 10]", "0 1 1 0 k 0 0 10 10 re f", []);
}

async function firstPage(data: Uint8Array, extra: Record<string, unknown> = {}) {
  const task = pdfjs.getDocument({ ...pdfDocumentOptions({ data }), ...extra });
  const page: PdfPage = await (await task.promise).getPage(1);
  return { page, close: () => task.destroy() };
}

function pixel(image: DecodedImage, x: number, y: number): number[] {
  const channels = image.data.length / (image.width * image.height);
  const at = (y * image.width + x) * channels;
  return [...image.data.slice(at, at + 3)];
}

beforeAll(async () => {
  const generateBundle = pdfjsAssets().generateBundle as unknown as (this: unknown) => void;
  generateBundle.call({
    emitFile: ({ fileName, source }: { fileName: string; source: Uint8Array }) =>
      builtApp.set(`/${fileName}`, new Uint8Array(source)),
  });
  vi.stubGlobal("fetch", fetchFromBuiltApp);
  vi.stubGlobal("XMLHttpRequest", BuiltAppRequest);
  await installMainThreadPdfWorker();
  pdfjs = await import("pdfjs-dist");
});

beforeEach(() => {
  requested.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "pdfjsWorker");
});

describe("pdf.js reading the files the app ships from inside its worker", () => {
  it("decodes a JPEG 2000 image with the shipped OpenJPEG decoder", async () => {
    const { page, close } = await firstPage(jpxPdf());
    try {
      const operators = await page.getOperatorList();
      const index = operators.fnArray.indexOf(pdfjs.OPS.paintImageXObject);
      expect(index).toBeGreaterThanOrEqual(0);
      const id = String((operators.argsArray[index] as unknown[])[0]);
      const image = await new Promise<DecodedImage>((resolve) => page.objs.get(id, resolve));
      expect(image).toMatchObject({ width: 16, height: 8 });
      expect(pixel(image, 0, 0)).toEqual([255, 0, 0]);
      expect(pixel(image, 7, 7)).toEqual([255, 0, 0]);
      expect(pixel(image, 8, 0)).toEqual([0, 0, 255]);
      expect(pixel(image, 15, 7)).toEqual([0, 0, 255]);
      expect(requested).toContain("/pdfjs/wasm/openjpeg.wasm");
    } finally {
      await close();
    }
  });

  it("loads a non-embedded Symbol font from the shipped standard font data", async () => {
    const { page, close } = await firstPage(symbolPdf(), { fontExtraProperties: true, useSystemFonts: true });
    try {
      const operators = await page.getOperatorList();
      const id = String((operators.argsArray[operators.fnArray.indexOf(pdfjs.OPS.setFont)] as unknown[])[0]);
      const font = page.commonObjs.get(id) as { missingFile?: boolean; data?: Uint8Array };
      expect(font.missingFile).toBe(false);
      expect(font.data?.length).toBeGreaterThan(0);
      expect(requested).toContain("/pdfjs/standard_fonts/FoxitSymbol.pfb");
    } finally {
      await close();
    }
  });

  it("reads Shift-JIS text in a non-embedded Japanese font through the shipped CMaps", async () => {
    const { page, close } = await firstPage(shiftJisPdf());
    try {
      const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("");
      expect(text).toBe("日本");
      expect(requested).toEqual(
        expect.arrayContaining(["/pdfjs/cmaps/90ms-RKSJ-H.bcmap", "/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap"]),
      );
    } finally {
      await close();
    }
  });

  it("converts a CMYK fill through the shipped ICC profile and colour engine", async () => {
    const { page, close } = await firstPage(cmykPdf());
    try {
      const operators = await page.getOperatorList();
      const index = operators.fnArray.indexOf(pdfjs.OPS.setFillRGBColor);
      expect(index).toBeGreaterThanOrEqual(0);
      const hex = String((operators.argsArray[index] as unknown[])[0]);
      const profileRed = [236, 31, 37];
      for (const [channel, at] of [1, 3, 5].entries()) {
        const value = Number.parseInt(hex.slice(at, at + 2), 16);
        expect(Math.abs(value - profileRed[channel]), hex).toBeLessThanOrEqual(6);
      }
      expect(requested).toEqual(
        expect.arrayContaining(["/pdfjs/wasm/qcms_bg.wasm", "/pdfjs/iccs/CGATS001Compat-v2-micro.icc"]),
      );
    } finally {
      await close();
    }
  });
});
