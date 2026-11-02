import { describe, expect, it } from "vitest";
import {
  findDocumentMetadata,
  formatGuardDate,
  guardedDocumentMetadata,
  requestsTaggedPdf,
} from "./document-metadata";

describe("formatGuardDate", () => {
  const at = (source: string) => findDocumentMetadata(source)?.start ?? -1;

  it("reads the date of the guard Oleafly writes", () => {
    const source = `${guardedDocumentMetadata("tagging=on")}\n\\documentclass{article}`;
    expect(formatGuardDate(source, at(source))).toBe("2025-11-01");
  });

  it("allows spaces and line breaks inside the guard", () => {
    const source = "\\IfFormatAtLeastTF { 2026-06-01 }\n  {\n  \\DocumentMetadata{tagging=on}}{}";
    expect(formatGuardDate(source, at(source))).toBe("2026-06-01");
  });

  it("is null for an unguarded declaration or a guard that does not wrap it", () => {
    const plain = "\\DocumentMetadata{tagging=on}\n\\documentclass{article}";
    expect(formatGuardDate(plain, at(plain))).toBeNull();
    const elsewhere = "\\IfFormatAtLeastTF{2025-11-01}{}{}\n\\DocumentMetadata{tagging=on}";
    expect(formatGuardDate(elsewhere, at(elsewhere))).toBeNull();
  });

  it("still counts the guarded line as a request for a tagged PDF", () => {
    expect(requestsTaggedPdf(guardedDocumentMetadata("lang=en,pdfstandard=ua-2,tagging=on"))).toBe(true);
  });
});

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
