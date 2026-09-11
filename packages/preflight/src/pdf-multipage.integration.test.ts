// @vitest-environment jsdom

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  endMarkedContent,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
} from "pdf-lib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { computeScores } from "./score";
import type { StructNode } from "./structure";

vi.mock("@oleafly/preview/pdf.worker?worker&url", () => ({ default: "pdf.worker.js" }));
vi.mock("pdfjs-dist", async () => await import("pdfjs-dist/legacy/build/pdf.mjs"));

type Extract = typeof import("./pdf-extract");
let extractForPreflight: Extract["extractForPreflight"];
let verifyStructure: typeof import("./structure").verifyStructure;

beforeAll(async () => {
  vi.stubGlobal("DOMMatrix", class DOMMatrix {});
  vi.stubGlobal("ImageData", class ImageData {});
  vi.stubGlobal("Path2D", class Path2D {});
  ({ extractForPreflight } = await import("./pdf-extract"));
  ({ verifyStructure } = await import("./structure"));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const resolve = createRequire(import.meta.url).resolve;
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ).href;
});

async function tableAcrossTwoPages(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  const second = document.addPage([612, 792]);
  const beginCell = (mcid: number) =>
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of("TD"),
      document.context.obj({ MCID: mcid }) as never,
    ]);

  first.pushOperators(beginCell(0));
  first.drawText("Measured latency, first half", { x: 72, y: 700, size: 12, font });
  first.pushOperators(endMarkedContent());
  first.node.set(PDFName.of("StructParents"), PDFNumber.of(0));

  second.pushOperators(beginCell(0));
  second.drawText("Measured latency, second half", { x: 72, y: 700, size: 12, font });
  second.pushOperators(endMarkedContent());
  second.node.set(PDFName.of("StructParents"), PDFNumber.of(1));

  const structureRoot = document.context.obj({ Type: "StructTreeRoot" });
  const structureRootRef = document.context.register(structureRoot);
  const documentElement = document.context.obj({
    Type: "StructElem",
    S: "Document",
    P: structureRootRef,
  });
  const documentRef = document.context.register(documentElement);
  const table = document.context.obj({ Type: "StructElem", S: "Table", P: documentRef });
  const tableRef = document.context.register(table);

  const row = (page: typeof first) => {
    const element = document.context.obj({ Type: "StructElem", S: "TR", P: tableRef });
    const ref = document.context.register(element);
    const cell = document.context.register(
      document.context.obj({ Type: "StructElem", S: "TD", P: ref, Pg: page.ref, K: 0 }),
    );
    element.set(PDFName.of("K"), document.context.obj([cell]));
    return { ref, cell };
  };
  const firstRow = row(first);
  const secondRow = row(second);

  table.set(PDFName.of("K"), document.context.obj([firstRow.ref, secondRow.ref]));
  documentElement.set(PDFName.of("K"), document.context.obj([tableRef]));
  structureRoot.set(PDFName.of("K"), document.context.obj([documentRef]));
  structureRoot.set(
    PDFName.of("ParentTree"),
    document.context.register(
      document.context.obj({ Nums: [0, [firstRow.cell], 1, [secondRow.cell]] }),
    ),
  );
  structureRoot.set(PDFName.of("ParentTreeNextKey"), PDFNumber.of(2));
  document.catalog.set(PDFName.of("StructTreeRoot"), structureRootRef);
  document.catalog.set(PDFName.of("MarkInfo"), document.context.obj({ Marked: true }));

  return document.save({ useObjectStreams: false });
}

function rolesIn(node: StructNode, role: string): StructNode[] {
  const found = node.role === role ? [node] : [];
  return [...found, ...node.children.flatMap((child) => rolesIn(child, role))];
}

describe("one table that spans two pages", () => {
  it("is one table in the merged structure tree, with both of its rows", async () => {
    const result = await extractForPreflight(await tableAcrossTwoPages());

    expect(result.tagged).toBe(true);
    expect(result.struct.root).not.toBeNull();
    const tables = rolesIn(result.struct.root as StructNode, "Table");
    expect(tables).toHaveLength(1);
    expect(rolesIn(tables[0], "TR")).toHaveLength(2);
  });

  it("reports the missing header cells once and deducts the penalty once", async () => {
    const result = await extractForPreflight(await tableAcrossTwoPages());
    const findings = verifyStructure(result.struct, result.extraction.structureFailedPages);
    const headers = findings.filter((finding) => finding.id === "output-table-headers");

    expect(headers).toHaveLength(1);
    expect(computeScores(headers).a11y).toBe(94);
  });

  it("keeps every cell of the table tied to the page it was drawn on", async () => {
    const result = await extractForPreflight(await tableAcrossTwoPages());
    const cells = rolesIn(result.struct.root as StructNode, "TD");
    const ids = cells.flatMap((cell) => cell.ids ?? []);

    expect(cells).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

async function twoTablesOnePerPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  const second = document.addPage([612, 792]);
  const beginCell = (tag: string, mcid: number) =>
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of(tag),
      document.context.obj({ MCID: mcid }) as never,
    ]);

  first.pushOperators(beginCell("TH", 0));
  first.drawText("Latency", { x: 72, y: 700, size: 12, font });
  first.pushOperators(endMarkedContent());
  first.pushOperators(beginCell("TD", 1));
  first.drawText("12 ms", { x: 72, y: 680, size: 12, font });
  first.pushOperators(endMarkedContent());
  first.node.set(PDFName.of("StructParents"), PDFNumber.of(0));

  second.pushOperators(beginCell("TD", 0));
  second.drawText("Throughput", { x: 72, y: 700, size: 12, font });
  second.pushOperators(endMarkedContent());
  second.node.set(PDFName.of("StructParents"), PDFNumber.of(1));

  const structureRoot = document.context.obj({ Type: "StructTreeRoot" });
  const structureRootRef = document.context.register(structureRoot);
  const documentElement = document.context.obj({
    Type: "StructElem",
    S: "Document",
    P: structureRootRef,
  });
  const documentRef = document.context.register(documentElement);

  const headered = document.context.obj({ Type: "StructElem", S: "Table", P: documentRef });
  const headeredRef = document.context.register(headered);
  const headerRow = document.context.obj({ Type: "StructElem", S: "TR", P: headeredRef });
  const headerRowRef = document.context.register(headerRow);
  const headerCell = document.context.register(
    document.context.obj({ Type: "StructElem", S: "TH", P: headerRowRef, Pg: first.ref, K: 0 }),
  );
  headerRow.set(PDFName.of("K"), document.context.obj([headerCell]));
  const dataRow = document.context.obj({ Type: "StructElem", S: "TR", P: headeredRef });
  const dataRowRef = document.context.register(dataRow);
  const dataCell = document.context.register(
    document.context.obj({ Type: "StructElem", S: "TD", P: dataRowRef, Pg: first.ref, K: 1 }),
  );
  dataRow.set(PDFName.of("K"), document.context.obj([dataCell]));
  headered.set(PDFName.of("K"), document.context.obj([headerRowRef, dataRowRef]));

  const headerless = document.context.obj({ Type: "StructElem", S: "Table", P: documentRef });
  const headerlessRef = document.context.register(headerless);
  const lonelyRow = document.context.obj({ Type: "StructElem", S: "TR", P: headerlessRef });
  const lonelyRowRef = document.context.register(lonelyRow);
  const lonelyCell = document.context.register(
    document.context.obj({ Type: "StructElem", S: "TD", P: lonelyRowRef, Pg: second.ref, K: 0 }),
  );
  lonelyRow.set(PDFName.of("K"), document.context.obj([lonelyCell]));
  headerless.set(PDFName.of("K"), document.context.obj([lonelyRowRef]));

  documentElement.set(PDFName.of("K"), document.context.obj([headeredRef, headerlessRef]));
  structureRoot.set(PDFName.of("K"), document.context.obj([documentRef]));
  structureRoot.set(
    PDFName.of("ParentTree"),
    document.context.register(
      document.context.obj({ Nums: [0, [headerCell, dataCell], 1, [lonelyCell]] }),
    ),
  );
  structureRoot.set(PDFName.of("ParentTreeNextKey"), PDFNumber.of(2));
  document.catalog.set(PDFName.of("StructTreeRoot"), structureRootRef);
  document.catalog.set(PDFName.of("MarkInfo"), document.context.obj({ Marked: true }));

  return document.save({ useObjectStreams: false });
}

describe("two different tables that meet at a page break", () => {
  it("keeps them apart instead of reading them as one continued table", async () => {
    const result = await extractForPreflight(await twoTablesOnePerPage());

    const tables = rolesIn(result.struct.root as StructNode, "Table");
    expect(tables).toHaveLength(2);
    expect(tables.map((table) => rolesIn(table, "TH").length)).toEqual([1, 0]);
  });

  it("reports the headerless one and does not let the headered one cover for it", async () => {
    const result = await extractForPreflight(await twoTablesOnePerPage());
    const findings = verifyStructure(result.struct, result.extraction.structureFailedPages);
    const headers = findings.filter((finding) => finding.id === "output-table-headers");

    expect(headers).toHaveLength(1);
    expect(computeScores(headers).a11y).toBe(94);
  });
});

async function tablesEitherSideOfParagraph(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  const second = document.addPage([612, 792]);
  const begin = (tag: string, mcid: number) =>
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of(tag),
      document.context.obj({ MCID: mcid }) as never,
    ]);

  first.pushOperators(begin("TD", 0));
  first.drawText("Measured latency", { x: 72, y: 700, size: 12, font });
  first.pushOperators(endMarkedContent());
  first.pushOperators(begin("P", 1));
  first.drawText("The next table reports throughput.", { x: 72, y: 660, size: 12, font });
  first.pushOperators(endMarkedContent());
  first.node.set(PDFName.of("StructParents"), PDFNumber.of(0));

  second.pushOperators(begin("TD", 0));
  second.drawText("Throughput", { x: 72, y: 700, size: 12, font });
  second.pushOperators(endMarkedContent());
  second.node.set(PDFName.of("StructParents"), PDFNumber.of(1));

  const structureRoot = document.context.obj({ Type: "StructTreeRoot" });
  const structureRootRef = document.context.register(structureRoot);
  const documentElement = document.context.obj({
    Type: "StructElem",
    S: "Document",
    P: structureRootRef,
  });
  const documentRef = document.context.register(documentElement);

  const tableWithOneRow = (cells: (typeof first | null)[]) => {
    const table = document.context.obj({ Type: "StructElem", S: "Table", P: documentRef });
    const tableRef = document.context.register(table);
    const row = document.context.obj({ Type: "StructElem", S: "TR", P: tableRef });
    const rowRef = document.context.register(row);
    const cellRefs = cells.map((page) =>
      document.context.register(
        document.context.obj(
          page
            ? { Type: "StructElem", S: "TD", P: rowRef, Pg: page.ref, K: 0 }
            : { Type: "StructElem", S: "TD", P: rowRef },
        ),
      ),
    );
    row.set(PDFName.of("K"), document.context.obj(cellRefs));
    table.set(PDFName.of("K"), document.context.obj([rowRef]));
    return { ref: tableRef, cellRefs };
  };
  const tableA = tableWithOneRow([first, null]);
  const tableB = tableWithOneRow([null, second]);
  const paragraph = document.context.register(
    document.context.obj({ Type: "StructElem", S: "P", P: documentRef, Pg: first.ref, K: 1 }),
  );

  documentElement.set(PDFName.of("K"), document.context.obj([tableA.ref, paragraph, tableB.ref]));
  structureRoot.set(PDFName.of("K"), document.context.obj([documentRef]));
  structureRoot.set(
    PDFName.of("ParentTree"),
    document.context.register(
      document.context.obj({
        Nums: [0, [tableA.cellRefs[0], paragraph], 1, [tableB.cellRefs[1]]],
      }),
    ),
  );
  structureRoot.set(PDFName.of("ParentTreeNextKey"), PDFNumber.of(2));
  document.catalog.set(PDFName.of("StructTreeRoot"), structureRootRef);
  document.catalog.set(PDFName.of("MarkInfo"), document.context.obj({ Marked: true }));

  return document.save({ useObjectStreams: false });
}

describe("two tables with a paragraph between them, one on each page", () => {
  it("keeps them apart even though their cells fill each other's gaps", async () => {
    const result = await extractForPreflight(await tablesEitherSideOfParagraph());

    const root = result.struct.root as StructNode;
    const tables = rolesIn(root, "Table");
    expect(tables).toHaveLength(2);
    expect(tables.map((table) => rolesIn(table, "TD").length)).toEqual([2, 2]);
    expect(rolesIn(root, "P")).toHaveLength(1);
  });

  it("reports the missing headers once per table", async () => {
    const result = await extractForPreflight(await tablesEitherSideOfParagraph());
    const findings = verifyStructure(result.struct, result.extraction.structureFailedPages);
    const headers = findings.filter((finding) => finding.id === "output-table-headers");

    expect(headers).toHaveLength(2);
    expect(computeScores(headers).a11y).toBe(88);
  });
});
