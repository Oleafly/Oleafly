// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };

vi.mock("@/components/tools/ToolsModelBar", () => ({
  ToolsModelPicker: ({ compact }: { compact?: boolean }) => (
    <div data-testid="tools-model-picker" data-compact={String(Boolean(compact))} />
  ),
  ToolsModelNotice: ({ scope }: { scope: string }) => <span data-testid="tools-model-notice" data-scope={scope} />,
  ScanEstimateText: ({ sizes }: { sizes: readonly { width: number; height: number }[] }) => (
    <p data-testid="scan-estimate" data-sizes={JSON.stringify(sizes)} />
  ),
}));

import { ScanTranscribeBanner } from "./ScanTranscribeBanner";

const pages = [
  { width: 100, height: 100 },
  { width: 200, height: 200 },
  { width: 300, height: 300 },
  { width: 400, height: 400 },
];

describe("ScanTranscribeBanner", () => {
  it("shows what to do, the Tools model and where scanned pages go", () => {
    render(<ScanTranscribeBanner pages={pages} />);
    expect(screen.getByTestId("scan-transcribe-banner")).toHaveTextContent(enLibrary.pdfImport.scannedLocal);
    expect(screen.getByTestId("tools-model-picker")).toHaveAttribute("data-compact", "true");
    expect(screen.getByTestId("tools-model-notice")).toHaveAttribute("data-scope", "scans");
    expect(JSON.parse(screen.getByTestId("scan-estimate").getAttribute("data-sizes") ?? "[]")).toHaveLength(4);
  });

  it("estimates only the pages inside the chosen range", () => {
    render(<ScanTranscribeBanner pages={pages} range={[2, 3]} />);
    expect(JSON.parse(screen.getByTestId("scan-estimate").getAttribute("data-sizes") ?? "[]")).toEqual([
      { width: 200, height: 200 },
      { width: 300, height: 300 },
    ]);
  });

  it("cuts a range past the last page", () => {
    render(<ScanTranscribeBanner pages={pages} range={[3, 9]} />);
    expect(JSON.parse(screen.getByTestId("scan-estimate").getAttribute("data-sizes") ?? "[]")).toEqual([
      { width: 300, height: 300 },
      { width: 400, height: 400 },
    ]);
  });
});
