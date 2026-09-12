// @vitest-environment jsdom

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@oleafly/preview/pdf.worker?worker&url", () => ({ default: "pdf.worker.js" }));
vi.mock("pdfjs-dist", async () => await import("pdfjs-dist/legacy/build/pdf.mjs"));

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const read = async (name: string) => new Uint8Array(await readFile(path.join(fixtures, name)));

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

describe("real PDF/UA-1 files from the veraPDF corpus", () => {
  it("reads a conforming file as tagged, titled, and displaying its title", async () => {
    const result = await extractForPreflight(await read("7.1-t10-pass-a.pdf"));

    expect(result.tagged).toBe(true);
    expect(result.ua.uaPart).toBe(1);
    expect(result.ua.displayDocTitle).toBe(true);
    expect(result.ua.xmpTitle).toBeTruthy();
    expect(result.ua.taggedTextRuns).toBeGreaterThan(0);
    expect(result.struct.root).not.toBeNull();

    const findings = verifyStructure(result.struct).map((finding) => finding.id);
    expect(findings).not.toContain("pdf-display-doc-title");
    expect(findings).not.toContain("pdf-ua-claim-mismatch");
    expect(findings).not.toContain("pdf-untagged-output");
    expect(findings).not.toContain("pdf-untagged-content");
  });

  it("ties every text run on a conforming file back to the structure tree", async () => {
    const result = await extractForPreflight(await read("7.1-t10-pass-a.pdf"));

    expect(result.ua.untaggedTextRuns).toBe(0);
    expect(result.textRuns).toEqual([
      { page: 1, tagged: result.ua.taggedTextRuns, untagged: 0, artifact: 0 },
    ]);
  });

  it("catches the missing DisplayDocTitle entry and the PDF/UA claim it breaks", async () => {
    const result = await extractForPreflight(await read("7.1-t10-fail-a.pdf"));

    expect(result.tagged).toBe(true);
    expect(result.ua.uaPart).toBe(1);
    expect(result.ua.displayDocTitle).toBe(false);

    const findings = verifyStructure(result.struct);
    const ids = findings.map((finding) => finding.id);
    expect(ids).toContain("pdf-display-doc-title");
    expect(ids).toContain("pdf-ua-claim-mismatch");
    const claim = findings.find((finding) => finding.id === "pdf-ua-claim-mismatch");
    expect(claim?.severity).toBe("error");
    expect(claim?.detailParts?.map((part) => part.key)).toContain(
      "rules.pdf-ua-claim-mismatch.partNoDisplayDocTitle",
    );
    expect(claim?.standards?.some((ref) => ref.verapdfRule === "5-1")).toBe(true);
  });

  it("separates the two files only by the viewer preference under test", async () => {
    const [pass, fail] = await Promise.all([
      extractForPreflight(await read("7.1-t10-pass-a.pdf")),
      extractForPreflight(await read("7.1-t10-fail-a.pdf")),
    ]);
    expect(pass.ua.displayDocTitle).not.toBe(fail.ua.displayDocTitle);
    expect(pass.tagged).toBe(fail.tagged);
  });
});
