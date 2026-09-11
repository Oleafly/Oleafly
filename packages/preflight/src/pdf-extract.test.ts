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
            { type: "beginMarkedContentProps", tag: "P", id: "p1_mc0" },
            { str: "ignored duplicate font", fontName: "f1" },
            { type: "endMarkedContent" },
          ],
        }),
        getAnnotations: vi.fn().mockResolvedValue([
          { subtype: "Link", contentsObj: { str: "Oleafly home page" } },
          { subtype: "Link", contentsObj: { str: "  " } },
          { subtype: "Widget" },
        ]),
        getViewport: vi.fn().mockReturnValue({ width: 612, height: 792, rotation: 0 }),
        commonObjs: {
          get: vi.fn().mockReturnValue({ name: "Embedded Font", data: new Uint8Array([1]) }),
        },
        getStructTree: vi.fn().mockResolvedValue({
          role: "Document",
          children: [
            { role: "H1", alt: "Heading", lang: "en", children: [{ type: "content", id: "p1_mc0" }] },
            { type: "content", id: "p1_mc9" },
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
        metadata: {
          get: vi.fn(),
          getRaw: () => '<rdf:Description pdfuaid:part="1"></rdf:Description>',
        },
      }),
      getMarkInfo: vi.fn().mockResolvedValue({ Marked: true, Suspects: false }),
      getViewerPreferences: vi.fn().mockResolvedValue(new Map([["DisplayDocTitle", true]])),
      getOutline: vi.fn().mockResolvedValue([{ items: [{ items: [] }] }]),
      getAttachments: vi.fn().mockResolvedValue({ source: {} }),
      getPermissions: vi.fn().mockResolvedValue([1]),
    };
    const destroy = vi.fn().mockResolvedValue(undefined);
    mocks.getDocument.mockReturnValue(taskFor(doc, destroy));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7 example"));

    expect(result.pageText).toEqual(["First ignored duplicate font", "Second"]);
    expect(result).toMatchObject({ lang: "en-US", title: "Paper", tagged: true });
    expect(result.ua).toMatchObject({
      displayDocTitle: true,
      suspects: false,
      xmpTitle: null,
      infoTitle: "Paper",
      uaPart: 1,
      links: [{ hasContents: true }, { hasContents: false }, { hasContents: false }],
    });
    expect(result.textRuns).toEqual([
      { page: 1, tagged: 1, untagged: 1, artifact: 0 },
      { page: 2, tagged: 0, untagged: 1, artifact: 0 },
    ]);
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
      linkCount: 3,
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
      getViewerPreferences: vi.fn().mockRejectedValue(new Error("viewer preferences unavailable")),
      getOutline: vi.fn().mockRejectedValue(new Error("outline unavailable")),
      getAttachments: vi.fn().mockRejectedValue(new Error("attachments unavailable")),
      getPermissions: vi.fn().mockRejectedValue(new Error("permissions unavailable")),
    };
    const destroy = vi.fn().mockRejectedValue(new Error("already destroyed"));
    mocks.getDocument.mockReturnValue(taskFor(doc, destroy));

    const result = await extractForPreflight(new Uint8Array([1, 2, 3]));

    expect(result).toMatchObject({ lang: null, title: null, tagged: null });
    expect(result.ua).toMatchObject({ displayDocTitle: null, suspects: null, uaPart: null, links: [] });
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

  it("prefers the XMP title, keeps the catalog language, and reads an unmarked empty structure as untagged", async () => {
    const metadata = new Map([
      ["dc:title", "XMP title"],
      ["dc:language", "fr"],
      ["dc:creator", "XMP author"],
      ["pdfuaid:part", "2"],
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
      getMetadata: vi.fn().mockResolvedValue({
        info: { Title: "Info title" },
        metadata: { get: (key: string) => metadata.get(key) },
      }),
      getMarkInfo: vi.fn().mockResolvedValue({ Marked: false }),
      getViewerPreferences: vi.fn().mockResolvedValue(null),
      getOutline: vi.fn().mockResolvedValue(null),
      getAttachments: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue(null),
    };
    mocks.getDocument.mockReturnValue(taskFor(doc));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-2.0"));

    expect(result).toMatchObject({ lang: null, title: "XMP title", tagged: false });
    expect(result.ua).toMatchObject({
      xmpTitle: "XMP title",
      infoTitle: "Info title",
      uaPart: 2,
      displayDocTitle: false,
    });
    expect(result.facts).toMatchObject({ version: "2.0", author: "XMP author", restricted: false });
  });

  it("separates a viewer preference it could not read from one it read and found missing", async () => {
    const docWith = (viewerPreferences: unknown) => ({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        getAnnotations: vi.fn().mockResolvedValue([]),
        getViewport: vi.fn().mockReturnValue({ width: 1, height: 1, rotation: 0 }),
        commonObjs: { get: vi.fn() },
        getStructTree: vi.fn().mockResolvedValue({ role: "Document", children: [] }),
        cleanup: vi.fn(),
      }),
      getMetadata: vi.fn().mockResolvedValue({ info: {}, metadata: null }),
      getMarkInfo: vi.fn().mockResolvedValue({ Marked: true }),
      getViewerPreferences: viewerPreferences,
      getOutline: vi.fn().mockResolvedValue(null),
      getAttachments: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue(null),
    });

    mocks.getDocument.mockReturnValue(
      taskFor(docWith(vi.fn().mockRejectedValue(new Error("viewer preferences unavailable")))),
    );
    const threw = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    expect(threw.ua.displayDocTitle).toBeNull();

    mocks.getDocument.mockReturnValue(taskFor(docWith(undefined)));
    const unsupported = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    expect(unsupported.ua.displayDocTitle).toBeNull();

    mocks.getDocument.mockReturnValue(taskFor(docWith(vi.fn().mockResolvedValue(null))));
    const absent = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    expect(absent.ua.displayDocTitle).toBe(false);

    mocks.getDocument.mockReturnValue(
      taskFor(docWith(vi.fn().mockResolvedValue(new Map([["DisplayDocTitle", false]])))),
    );
    const declared = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    expect(declared.ua.displayDocTitle).toBe(false);
  });

  it("reads the PDF/UA claim even when dc:creator arrives as an array", async () => {
    const metadata = new Map<string, unknown>([
      ["dc:title", "A tagged paper"],
      ["dc:creator", ["Ada Lovelace", "Alan Turing"]],
      ["pdfuaid:part", "1"],
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
      getMetadata: vi.fn().mockResolvedValue({
        info: {},
        metadata: { get: (key: string) => metadata.get(key) },
      }),
      getMarkInfo: vi.fn().mockResolvedValue({ Marked: true }),
      getViewerPreferences: vi.fn().mockResolvedValue(new Map([["DisplayDocTitle", true]])),
      getOutline: vi.fn().mockResolvedValue(null),
      getAttachments: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue(null),
    };
    mocks.getDocument.mockReturnValue(taskFor(doc));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));

    expect(result.extraction.metadata).toBe("ok");
    expect(result.ua.uaPart).toBe(1);
    expect(result.ua.xmpTitle).toBe("A tagged paper");
    expect(result.facts.author).toBe("Ada Lovelace, Alan Turing");
  });
});

describe("extractForPreflight: structure identity across pages", () => {
  beforeEach(() => mocks.getDocument.mockReset());

  const pageWith = (tree: unknown, items: unknown[] = []) => ({
    getTextContent: vi.fn().mockResolvedValue({ items }),
    getAnnotations: vi.fn().mockResolvedValue([]),
    getViewport: vi.fn().mockReturnValue({ width: 612, height: 792, rotation: 0 }),
    commonObjs: { get: vi.fn() },
    getStructTree: vi.fn().mockResolvedValue(tree),
    cleanup: vi.fn(),
  });

  const docOf = (pages: ReturnType<typeof pageWith>[]) => ({
    numPages: pages.length,
    getPage: vi.fn(async (number: number) => pages[number - 1]),
    getMetadata: vi.fn().mockResolvedValue({ info: {}, metadata: null }),
    getMarkInfo: vi.fn().mockResolvedValue({ Marked: true }),
    getViewerPreferences: vi.fn().mockResolvedValue(null),
    getOutline: vi.fn().mockResolvedValue(null),
    getAttachments: vi.fn().mockResolvedValue(null),
    getPermissions: vi.fn().mockResolvedValue(null),
  });

  it("keeps two distinct Sect nodes apart and preserves the second one's language", async () => {
    const page = pageWith({
      role: "Root",
      children: [
        {
          role: "Sect",
          lang: "en-US",
          children: [{ role: "P", children: [{ type: "content", id: "p1_mc0" }] }],
        },
        {
          role: "Sect",
          lang: "de-DE",
          children: [{ role: "P", children: [{ type: "content", id: "p1_mc1" }] }],
        },
      ],
    });
    mocks.getDocument.mockReturnValue(taskFor(docOf([page])));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    const sections = result.struct.root?.children ?? [];

    expect(sections.map((node) => node.role)).toEqual(["Sect", "Sect"]);
    expect(sections.map((node) => node.lang)).toEqual(["en-US", "de-DE"]);
  });

  it("merges a node that both pages report, so one figure is not counted twice", async () => {
    const spanningTable = (extraRow: unknown) => ({
      role: "Root",
      children: [
        {
          role: "Document",
          children: [
            {
              role: "Table",
              children: [
                {
                  role: "TR",
                  children: [
                    { role: "TD", children: [{ role: "Figure", children: [{ type: "content", id: "p1_mc4" }] }] },
                  ],
                },
                extraRow,
              ],
            },
          ],
        },
      ],
    });
    const pages = [
      pageWith(
        spanningTable({
          role: "TR",
          children: [{ role: "TD", children: [{ type: "content", id: "p2_mc0" }] }],
        }),
      ),
      pageWith(
        spanningTable({
          role: "TR",
          children: [{ role: "TD", children: [{ type: "content", id: "p2_mc0" }] }],
        }),
      ),
    ];
    mocks.getDocument.mockReturnValue(taskFor(docOf(pages)));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    const figures: string[] = [];
    const visit = (node: { role: string; children: { role: string; children: unknown[] }[] }) => {
      if (node.role === "Figure") figures.push(node.role);
      for (const child of node.children) visit(child as never);
    };
    if (result.struct.root) visit(result.struct.root as never);

    expect(figures).toHaveLength(1);
  });

  it("keeps two pages that have nothing in common apart, with every paragraph intact", async () => {
    const pages = [
      pageWith({
        role: "Root",
        children: [{ role: "Document", children: [{ role: "P", children: [{ type: "content", id: "p1_mc0" }] }] }],
      }),
      pageWith({
        role: "Root",
        children: [{ role: "Document", children: [{ role: "P", children: [{ type: "content", id: "p2_mc0" }] }] }],
      }),
    ];
    mocks.getDocument.mockReturnValue(taskFor(docOf(pages)));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    const branches = result.struct.root?.children ?? [];

    expect(branches.map((node) => node.role)).toEqual(["Document", "Document"]);
    expect(branches.flatMap((node) => node.children.map((child) => child.ids))).toEqual([
      ["p1_mc0"],
      ["p2_mc0"],
    ]);
  });

  it("joins a table both pages repeat when each page carries only the rows it drew", async () => {
    const tableWith = (first: unknown, second: unknown) => ({
      role: "Root",
      children: [
        {
          role: "Document",
          children: [
            {
              role: "Table",
              children: [
                { role: "TR", children: [{ role: "TD", children: first ? [first] : [] }] },
                { role: "TR", children: [{ role: "TD", children: second ? [second] : [] }] },
              ],
            },
          ],
        },
      ],
    });
    const pages = [
      pageWith(tableWith({ type: "content", id: "p1_mc0" }, null)),
      pageWith(tableWith(null, { type: "content", id: "p2_mc0" })),
    ];
    mocks.getDocument.mockReturnValue(taskFor(docOf(pages)));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    const cells: { ids?: string[] }[] = [];
    const tables: unknown[] = [];
    const visit = (node: { role: string; ids?: string[]; children: unknown[] }) => {
      if (node.role === "Table") tables.push(node);
      if (node.role === "TD") cells.push(node);
      for (const child of node.children) visit(child as never);
    };
    if (result.struct.root) visit(result.struct.root as never);

    expect(tables).toHaveLength(1);
    expect(cells.map((cell) => cell.ids)).toEqual([["p1_mc0"], ["p2_mc0"]]);
  });

  it("pairs only the last element of one page with the first of the next", async () => {
    const row = (first: unknown, second: unknown) => ({
      role: "TR",
      children: [
        { role: "TD", children: first ? [first] : [] },
        { role: "TD", children: second ? [second] : [] },
      ],
    });
    const pages = [
      pageWith({
        role: "Root",
        children: [
          {
            role: "Document",
            children: [
              { role: "Table", children: [row({ type: "content", id: "p1_mc0" }, null)] },
              { role: "P", children: [{ type: "content", id: "p1_mc1" }] },
            ],
          },
        ],
      }),
      pageWith({
        role: "Root",
        children: [
          {
            role: "Document",
            children: [{ role: "Table", children: [row(null, { type: "content", id: "p2_mc0" })] }],
          },
        ],
      }),
    ];
    mocks.getDocument.mockReturnValue(taskFor(docOf(pages)));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    const cells: { ids?: string[] }[] = [];
    const tables: unknown[] = [];
    const visit = (node: { role: string; ids?: string[]; children: unknown[] }) => {
      if (node.role === "Table") tables.push(node);
      if (node.role === "TD") cells.push(node);
      for (const child of node.children) visit(child as never);
    };
    if (result.struct.root) visit(result.struct.root as never);

    expect(tables).toHaveLength(2);
    expect(cells.map((cell) => cell.ids)).toEqual([["p1_mc0"], undefined, undefined, ["p2_mc0"]]);
  });

  it("does not join two same-role containers that only happen to meet at a page break", async () => {
    const pages = [
      pageWith({
        role: "Root",
        children: [
          {
            role: "Sect",
            children: [
              { role: "H2", children: [{ type: "content", id: "p1_mc0" }] },
              { role: "P", children: [{ type: "content", id: "p1_mc1" }] },
            ],
          },
        ],
      }),
      pageWith({
        role: "Root",
        children: [
          { role: "Sect", children: [{ role: "P", children: [{ type: "content", id: "p2_mc0" }] }] },
        ],
      }),
    ];
    mocks.getDocument.mockReturnValue(taskFor(docOf(pages)));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    const branches = result.struct.root?.children ?? [];

    expect(branches.map((node) => node.role)).toEqual(["Sect", "Sect"]);
    expect(branches.map((node) => node.children.length)).toEqual([2, 1]);
  });

  it("does not join two containers whose language says they are different elements", async () => {
    const pages = [
      pageWith({
        role: "Root",
        children: [
          { role: "Sect", lang: "en-US", children: [{ role: "P", children: [{ type: "content", id: "p1_mc0" }] }] },
        ],
      }),
      pageWith({
        role: "Root",
        children: [
          { role: "Sect", lang: "de-DE", children: [{ role: "P", children: [{ type: "content", id: "p2_mc0" }] }] },
        ],
      }),
    ];
    mocks.getDocument.mockReturnValue(taskFor(docOf(pages)));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    const branches = result.struct.root?.children ?? [];

    expect(branches.map((node) => node.lang)).toEqual(["en-US", "de-DE"]);
  });

  it("does not join a heading on one page to a heading on the next", async () => {
    const pages = [
      pageWith({
        role: "Root",
        children: [
          {
            role: "Sect",
            children: [{ role: "H2", children: [{ type: "content", id: "p1_mc0" }] }],
          },
        ],
      }),
      pageWith({
        role: "Root",
        children: [
          {
            role: "Sect",
            children: [{ role: "H2", children: [{ type: "content", id: "p2_mc0" }] }],
          },
        ],
      }),
    ];
    mocks.getDocument.mockReturnValue(taskFor(docOf(pages)));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));
    const headings: { role: string; ids?: string[] }[] = [];
    const visit = (node: { role: string; ids?: string[]; children: unknown[] }) => {
      if (node.role === "H2") headings.push(node);
      for (const child of node.children) visit(child as never);
    };
    if (result.struct.root) visit(result.struct.root as never);

    expect(headings.map((node) => node.ids)).toEqual([["p1_mc0"], ["p2_mc0"]]);
  });
});

describe("extractForPreflight: marked-content membership", () => {
  beforeEach(() => mocks.getDocument.mockReset());

  it("counts a run as tagged only when its marked-content id is in the structure tree", async () => {
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { type: "beginMarkedContentProps", tag: "P", id: "p1_mc0" },
          { str: "Real tagged body text", fontName: "f1" },
          { type: "endMarkedContent" },
          { type: "beginMarkedContent", tag: "Span" },
          { str: "Loose span content", fontName: "f1" },
          { type: "endMarkedContent" },
          { type: "beginMarkedContentProps", tag: "P", id: "p1_mc7" },
          { str: "Marked but not in the tree", fontName: "f1" },
          { type: "endMarkedContent" },
          { type: "beginMarkedContentProps", tag: "Artifact", id: "p1_mc8" },
          { str: "Running header", fontName: "f1" },
          { type: "endMarkedContent" },
          { str: "Bare text with no marked content", fontName: "f1" },
        ],
      }),
      getAnnotations: vi.fn().mockResolvedValue([]),
      getViewport: vi.fn().mockReturnValue({ width: 612, height: 792, rotation: 0 }),
      commonObjs: { get: vi.fn() },
      getStructTree: vi.fn().mockResolvedValue({
        role: "Root",
        children: [{ role: "Document", children: [{ role: "P", children: [{ type: "content", id: "p1_mc0" }] }] }],
      }),
      cleanup: vi.fn(),
    };
    const doc = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(page),
      getMetadata: vi.fn().mockResolvedValue({ info: {}, metadata: null }),
      getMarkInfo: vi.fn().mockResolvedValue({ Marked: true }),
      getViewerPreferences: vi.fn().mockResolvedValue(null),
      getOutline: vi.fn().mockResolvedValue(null),
      getAttachments: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue(null),
    };
    mocks.getDocument.mockReturnValue(taskFor(doc));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));

    expect(result.textRuns).toEqual([{ page: 1, tagged: 1, untagged: 3, artifact: 1 }]);
    expect(result.ua).toMatchObject({ taggedTextRuns: 1, untaggedTextRuns: 3, artifactTextRuns: 1 });
  });

  it("treats content nested inside a tagged sequence as part of that sequence", async () => {
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { type: "beginMarkedContentProps", tag: "P", id: "p1_mc0" },
          { type: "beginMarkedContent", tag: "Span" },
          { str: "Emphasised words inside a tagged paragraph", fontName: "f1" },
          { type: "endMarkedContent" },
          { type: "endMarkedContent" },
        ],
      }),
      getAnnotations: vi.fn().mockResolvedValue([]),
      getViewport: vi.fn().mockReturnValue({ width: 612, height: 792, rotation: 0 }),
      commonObjs: { get: vi.fn() },
      getStructTree: vi.fn().mockResolvedValue({
        role: "Root",
        children: [{ role: "Document", children: [{ role: "P", children: [{ type: "content", id: "p1_mc0" }] }] }],
      }),
      cleanup: vi.fn(),
    };
    const doc = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(page),
      getMetadata: vi.fn().mockResolvedValue({ info: {}, metadata: null }),
      getMarkInfo: vi.fn().mockResolvedValue({ Marked: true }),
      getViewerPreferences: vi.fn().mockResolvedValue(null),
      getOutline: vi.fn().mockResolvedValue(null),
      getAttachments: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue(null),
    };
    mocks.getDocument.mockReturnValue(taskFor(doc));

    const result = await extractForPreflight(new TextEncoder().encode("%PDF-1.7"));

    expect(result.textRuns).toEqual([{ page: 1, tagged: 1, untagged: 0, artifact: 0 }]);
  });
});
