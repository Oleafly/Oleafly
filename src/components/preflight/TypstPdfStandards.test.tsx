// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enPreflight from "@/i18n/locales/en/preflight.json" with { type: "json" };

const mocks = vi.hoisted(() => ({ exportCurrentTypst: vi.fn(async () => {}) }));
vi.mock("@/features/export", () => ({ exportCurrentTypst: mocks.exportCurrentTypst }));

import type { TypstOptionsDescriptor } from "@oleafly/backend-port";
import { TypstPdfStandards } from "./TypstPdfStandards";

const copy = enPreflight.typstStandards;

function options(pdf_standards: string[]): TypstOptionsDescriptor {
  return {
    system_fonts: true,
    reproducible: false,
    variants: [],
    font_dirs: [],
    flags: pdf_standards.length ? ["--pdf-standard"] : [],
    output_formats: ["pdf"],
    pdf_standards,
  };
}

const fill = (text: string, version: string) => text.replace("{{version}}", version);

beforeEach(() => {
  mocks.exportCurrentTypst.mockClear();
});

describe("Typst PDF standards in export preparation", () => {
  it("exports PDF/A-2b by default and says newer Typst tags PDFs itself", async () => {
    const user = userEvent.setup();
    render(<TypstPdfStandards options={options(["1.7", "a-2b", "a-3b", "ua-1"])} version="0.15.1" />);
    expect(screen.getByText(fill(copy.tagged, "0.15.1"))).toBeInTheDocument();
    expect(screen.getByTestId("typst-pdf-standard")).toHaveTextContent("PDF/A-2b");
    await user.click(screen.getByTestId("typst-pdf-standard-export"));
    expect(mocks.exportCurrentTypst).toHaveBeenCalledWith({ format: "pdf", pdfStandard: "a-2b" });
  });

  it("says an older Typst does not tag PDFs", () => {
    render(<TypstPdfStandards options={options(["1.7", "a-2b", "a-3b"])} version="0.13.1" />);
    expect(screen.getByText(fill(copy.untagged, "0.13.1"))).toBeInTheDocument();
    expect(screen.queryByText(copy.uaNote)).not.toBeInTheDocument();
  });

  it("offers nothing to export when the version has no standards", () => {
    render(<TypstPdfStandards options={options([])} version="0.11.1" />);
    expect(screen.getByText(fill(copy.none, "0.11.1"))).toBeInTheDocument();
    expect(screen.queryByTestId("typst-pdf-standard-export")).not.toBeInTheDocument();
  });
});
