// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const opener = vi.hoisted(() => ({ openTypstPackages: vi.fn() }));

vi.mock("@/components/typst-packages/open", () => opener);
vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));
vi.mock("@/components/editor/project-info-data", () => ({ collectProjectInfo: vi.fn() }));
vi.mock("@/features/image-to-latex", () => ({
  imageToLatexAvailable: vi.fn(async () => false),
  imageToTypst: vi.fn(async () => {}),
  imageToLatex: vi.fn(async () => {}),
}));

import { TypstToolbar } from "./TypstToolbar";

describe("TypstToolbar packages button", () => {
  it("opens the Typst packages browser", () => {
    render(<TypstToolbar />);
    fireEvent.click(screen.getByRole("button", { name: en.toolbar.typstPackages }));
    expect(opener.openTypstPackages).toHaveBeenCalledOnce();
  });
});
