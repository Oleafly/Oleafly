import { describe, expect, it } from "vitest";
import { requestsTaggedPdf } from "./document-metadata";

describe("requestsTaggedPdf", () => {
  it("is false without \\DocumentMetadata or with metadata that leaves tagging off", () => {
    expect(requestsTaggedPdf("\\documentclass{article}")).toBe(false);
    expect(requestsTaggedPdf("\\DocumentMetadata{pdfversion=2.0,lang=en}")).toBe(false);
    expect(requestsTaggedPdf("\\DocumentMetadata{tagging=off,pdfstandard=ua-2}")).toBe(false);
    expect(requestsTaggedPdf("\\DocumentMetadata{pdfstandard=a-2b}")).toBe(false);
  });

  it("is true when tagging is on, a test phase is loaded, or a PDF/UA standard is set", () => {
    expect(requestsTaggedPdf("\\DocumentMetadata{lang=en,tagging=on}")).toBe(true);
    expect(requestsTaggedPdf("\\DocumentMetadata{tagging={draft}}")).toBe(true);
    expect(requestsTaggedPdf("\\DocumentMetadata{testphase=phase-III}")).toBe(true);
    expect(requestsTaggedPdf("\\DocumentMetadata{pdfstandard=ua-2}")).toBe(true);
    expect(requestsTaggedPdf("\\DocumentMetadata{pdfstandard={a-4f,ua-2}}")).toBe(true);
    expect(requestsTaggedPdf("\\DocumentMetadata{ tagging = on , lang = en }")).toBe(true);
    expect(requestsTaggedPdf("\\DocumentMetadata{pdfstandard=UA-2}")).toBe(true);
    expect(requestsTaggedPdf("\\DocumentMetadata{tagging=OFF}")).toBe(false);
  });

  it("ignores a commented-out \\DocumentMetadata", () => {
    expect(requestsTaggedPdf("% \\DocumentMetadata{tagging=on}\n\\documentclass{article}")).toBe(false);
  });
});
