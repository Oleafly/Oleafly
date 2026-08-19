import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
}));
vi.mock("@oleafly/preview/pdf.worker?worker&url", () => ({ default: "worker.js" }));
vi.mock("./pdf-text", () => ({
  reconstructPdfPageText: (items: Array<{ str?: string; x?: number; y?: number; width?: number }>) => ({
    items: items
      .filter((item) => typeof item.str === "string")
      .map((item) => ({ str: item.str, x: item.x ?? 0, y: item.y ?? 0, width: item.width ?? 10 })),
    text: items.map((item) => item.str ?? "").join(" "),
  }),
}));

import { extractForPreflight } from "./pdf-extract";

function taskFor(doc: unknown, destroy = vi.fn().mockResolvedValue(undefined)) {
  return { promise: Promise.resolve(doc), destroy };
}

describe("extractForPreflight", () => {
  beforeEach(() => mocks.getDocument.mockReset());

  it("collects page geometry, structure, metadata, fonts, links, outline, and restrictions", async () => {
    const cleanup = vi.fn();
    const pages = [
      {
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: "First", fontName: "f1", x: 10, y: 20, width: 30 },
            { str: "ignored duplicate font", fontName: "f1" },
            { type: "beginMarkedContent" },
          ],
        }),
        getAnnotations: vi.fn().mockResolvedValue([{ subtype: "Link" }, { subtype: "Widget" }]),
        getViewport: vi.fn().mockReturnValue({ width: 612, height: 792, rotation: 0 }),
        commonObjs: {
          get: vi.fn().mockReturnValue({ name: "Embedded Font", data: new Uint8Array([1]) }),
        },
        getStructTree: vi.fn().mockResolvedValue({
          role: "Document",
          children: [
            { role: "H1", alt: "Heading", lang: "en", children: [] },
            { type: "content", id: "mc0" },
            null,
          ],
        }),
        cleanup,
      },
      {
        getTextContent: vi.fn().mockResolvedValue({
          items: [{ str: "Second", fontName: "f2", x: 5, y: 15, width: 25 }],
        }),
        getAnnotations: vi.fn().mockResolvedValue([{ subtype: "Link" }]),
        getViewport: vi.fn().mockReturnValue({ width: 792, height: 612, rotation: 90 }),
        commonObjs: { get: vi.fn().mockReturnValue({ missingFile: true }) },
        getStructTree: vi.fn().mockResolvedValue({
          role: "Document",
          children: [{ role: "P", children: [] }],
        }),
        cleanup,
      },
    ];
    const doc = {
      numPages: 2,
      getPage: vi.fn(async (number: number) => pages[number - 1]),
      getMetadata: vi.fn().mockResolvedValue({
        info: { Title: "  Paper  ", Language: " en-US ", Author: "Ada", Creator: "Writer", Producer: "PDF" },
        metadata: { get: vi.fn() },
      }),
      getMarkInfo: vi.fn().mockResolvedValue({ Marked: true }),
      getOutline: vi.fn().mockResolvedValue([{ items: [{ items: [] }] }]),
      getAttachments: vi.fn().mockResolvedValue({ source: {} }),
      getPermissions: vi.fn().mockResolvedValue([1]),
    };
    const destroy = vi.fn().mockResolvedValue(undefined);
    mocks.getDocument.mockReturnValue(taskFor(doc, destroy));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7 example"));

    expect(result.pageText).toEqual(["First ignored duplicate font ", "Second"]);
    expect(result).toMatchObject({ lang: "en-US", title: "Paper", tagged: true });
    expect(result.struct.root?.children.map((node) => node.role)).toEqual(["H1", "P"]);
    expect(result.extraction).toEqual({
      metadata: "ok",
      markInfo: "ok",
      structure: "ok",
      structureFailedPages: [],
    });
    expect(result.facts).toMatchObject({
      version: "1.7",
      pageCount: 2,
      outlineCount: 2,
      linkCount: 2,
      attachmentCount: 1,
      formFieldCount: 1,
      restricted: true,
      author: "Ada",
      creator: "Writer",
      producer: "PDF",
    });
    expect(result.facts.fonts).toEqual([
      { name: "Embedded Font", embedded: true },
      { name: "f2", embedded: false },
    ]);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("reports unknown facts without failing when optional PDF APIs throw", async () => {
    const page = {
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: "Text", fontName: "bad" }] }),
      getAnnotations: vi.fn().mockResolvedValue([]),
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 200, rotation: 0 }),
      commonObjs: { get: vi.fn(() => { throw new Error("font unavailable"); }) },
      getStructTree: vi.fn().mockRejectedValue(new Error("structure unavailable")),
      cleanup: vi.fn(() => { throw new Error("already cleaned"); }),
    };
    const doc = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(page),
      getMetadata: vi.fn().mockRejectedValue(new Error("metadata unavailable")),
      getMarkInfo: vi.fn().mockRejectedValue(new Error("mark info unavailable")),
      getOutline: vi.fn().mockRejectedValue(new Error("outline unavailable")),
      getAttachments: vi.fn().mockRejectedValue(new Error("attachments unavailable")),
      getPermissions: vi.fn().mockRejectedValue(new Error("permissions unavailable")),
    };
    const destroy = vi.fn().mockRejectedValue(new Error("already destroyed"));
    mocks.getDocument.mockReturnValue(taskFor(doc, destroy));

    const result = await extractForPreflight(new Uint8Array([1, 2, 3]));

    expect(result).toMatchObject({ lang: null, title: null, tagged: null });
    expect(result.struct.root).toBeNull();
    expect(result.extraction).toEqual({
      metadata: "failed",
      markInfo: "failed",
      structure: "failed",
      structureFailedPages: [1],
    });
    expect(result.facts).toMatchObject({
      version: null,
      outlineCount: 0,
      attachmentCount: 0,
      restricted: null,
      author: null,
      creator: null,
      producer: null,
      fonts: [{ name: "bad", embedded: null }],
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uses XMP fallbacks and an unmarked empty structure as an untagged result", async () => {
    const metadata = new Map([
      ["dc:title", "XMP title"],
      ["dc:language", "fr"],
      ["dc:creator", "XMP author"],
    ]);
    const doc = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        getAnnotations: vi.fn().mockResolvedValue([]),
        getViewport: vi.fn().mockReturnValue({ width: 1, height: 1, rotation: 0 }),
        commonObjs: { get: vi.fn() },
        getStructTree: vi.fn().mockResolvedValue({ role: "Document", children: [] }),
        cleanup: vi.fn(),
      }),
      getMetadata: vi.fn().mockResolvedValue({ info: {}, metadata: { get: (key: string) => metadata.get(key) } }),
      getMarkInfo: vi.fn().mockResolvedValue({ Marked: false }),
      getOutline: vi.fn().mockResolvedValue(null),
      getAttachments: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue(null),
    };
    mocks.getDocument.mockReturnValue(taskFor(doc));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-2.0"));

    expect(result).toMatchObject({ lang: "fr", title: "XMP title", tagged: false });
    expect(result.facts).toMatchObject({ version: "2.0", author: "XMP author", restricted: false });
  });
});
