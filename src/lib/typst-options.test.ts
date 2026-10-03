import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import type { TypstOptionsDescriptor } from "@oleafly/backend-port";
import {
  exportTypstDocument,
  setTypstProjectOptions,
  typstArchivalStandards,
  typstHtmlExport,
  typstProjectFonts,
  typstProjectOptions,
  typstStandardLabel,
  typstSupports,
  typstTagsPdfByDefault,
  validTypstPageRanges,
} from "./typst-options";

function options(over: Partial<TypstOptionsDescriptor> = {}): TypstOptionsDescriptor {
  return {
    system_fonts: true,
    reproducible: false,
    variants: [],
    font_dirs: [],
    flags: [],
    output_formats: ["pdf", "png", "svg"],
    pdf_standards: [],
    ...over,
  };
}

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("Typst page ranges", () => {
  it.each(["1", "2,5", "3-6", "8-", "-3", " 1, 2 - 4 ", "4-4"])("accepts %s", (pages) => {
    expect(validTypstPageRanges(pages)).toBe(true);
  });

  it.each(["", " ", "0", "a", "5-3", "1--2", "1,,2", "-", "0-2", ",1", "99999999999"])("refuses %j", (pages) => {
    expect(validTypstPageRanges(pages)).toBe(false);
  });
});

describe("Typst capabilities", () => {
  it("reads flags and HTML export from the descriptor", () => {
    expect(typstSupports(options({ flags: ["--pages"] }), "--pages")).toBe(true);
    expect(typstSupports(null, "--pages")).toBe(false);
    expect(typstHtmlExport(options({ flags: ["--features"], output_formats: ["html", "pdf"] }))).toBe(true);
    expect(typstHtmlExport(options({ flags: [], output_formats: ["html", "pdf"] }))).toBe(false);
    expect(typstHtmlExport(options())).toBe(false);
  });

  it("offers archival and accessible standards in a stable order", () => {
    expect(typstArchivalStandards(options({ pdf_standards: ["1.7", "a-2b"] }))).toEqual(["a-2b"]);
    expect(typstArchivalStandards(options({ pdf_standards: ["1.7", "a-2b", "a-3b"] }))).toEqual(["a-2b", "a-3b"]);
    expect(
      typstArchivalStandards(options({ pdf_standards: ["1.4", "2.0", "ua-1", "a-4f", "a-3b", "a-2b", "a-1b"] })),
    ).toEqual(["a-2b", "a-3b", "a-1b", "a-4f", "ua-1"]);
    expect(typstArchivalStandards(null)).toEqual([]);
    expect(typstStandardLabel("a-2b")).toBe("PDF/A-2b");
    expect(typstStandardLabel("ua-1")).toBe("PDF/UA-1");
    expect(typstStandardLabel("1.7")).toBe("PDF 1.7");
  });

  it("knows which versions tag PDFs by default", () => {
    expect(typstTagsPdfByDefault("0.14.2")).toBe(true);
    expect(typstTagsPdfByDefault("0.15.1")).toBe(true);
    expect(typstTagsPdfByDefault("1.0.0")).toBe(true);
    expect(typstTagsPdfByDefault("0.13.1")).toBe(false);
    expect(typstTagsPdfByDefault(null)).toBe(false);
  });
});

describe("Typst option commands", () => {
  it("call the backend with camel-case arguments", async () => {
    mocks.invoke.mockResolvedValue({});
    await typstProjectOptions("paper");
    await setTypstProjectOptions("paper", { systemFonts: false });
    await typstProjectFonts("paper");
    await exportTypstDocument("paper", "main.typ", { format: "png", ppi: 300 }, "/out/paper.png");
    expect(mocks.invoke.mock.calls).toEqual([
      ["typst_project_options", { projectId: "paper" }],
      ["set_typst_project_options", { projectId: "paper", update: { systemFonts: false } }],
      ["typst_project_fonts", { projectId: "paper" }],
      [
        "export_typst_document",
        { projectId: "paper", mainDoc: "main.typ", request: { format: "png", ppi: 300 }, dest: "/out/paper.png" },
      ],
    ]);
  });
});
