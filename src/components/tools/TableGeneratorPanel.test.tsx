// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const notifyError = vi.fn();

vi.mock("@/lib/toast", () => ({
  notifyError: (...args: unknown[]) => notifyError(...args),
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { TableGeneratorPanel } from "@/components/tools/TableGeneratorPanel";
import { TableToolView } from "@/components/tools/TableToolView";
import { useHomeViewStore } from "@/store/home-view";
import { toolName } from "@/lib/tool-catalog";

const writeText = vi.fn(async () => {});

function cellLabel(row: number, column: number): string {
  return enResearchTools.table.cellAria
    .replace("{{row}}", String(row))
    .replace("{{column}}", String(column));
}

function alignLabel(column: number): string {
  return enResearchTools.table.columnAlignment.replace(
    "{{column}}",
    String(column),
  );
}

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  notifyError.mockReset();
  writeText.mockReset();
  useHomeViewStore.setState({ page: "library" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("TableGeneratorPanel", () => {
  it("renders the seeded grid and its booktabs LaTeX output", () => {
    render(<TableGeneratorPanel />);
    expect(screen.getByLabelText(cellLabel(1, 1))).toHaveValue("Method");
    expect(screen.getByLabelText(cellLabel(3, 3))).toHaveValue("0.79");
    expect(screen.getByText(/\\toprule/)).toBeInTheDocument();
    expect(screen.getByText(enResearchTools.table.preview)).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.table.output),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/usepackage\{booktabs\}/),
    ).toBeInTheDocument();
  });

  it("resizes the grid when the row and column counts change", () => {
    render(<TableGeneratorPanel />);
    fireEvent.change(screen.getByLabelText(enResearchTools.table.rows), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(enResearchTools.table.columns), {
      target: { value: "4" },
    });
    expect(screen.getByLabelText(cellLabel(2, 4))).toHaveValue("");
    expect(screen.queryByLabelText(cellLabel(3, 1))).not.toBeInTheDocument();
    expect(screen.getByLabelText(alignLabel(4))).toHaveValue("c");
  });

  it("swaps to hline output and drops the booktabs hint", () => {
    render(<TableGeneratorPanel />);
    fireEvent.click(screen.getByLabelText(enResearchTools.table.booktabs));
    expect(screen.getByText(/\\hline/)).toBeInTheDocument();
    expect(
      screen.queryByText(/usepackage\{booktabs\}/),
    ).not.toBeInTheDocument();
  });

  it("writes an edited cell, an alignment and a caption into the output", () => {
    render(<TableGeneratorPanel />);
    fireEvent.change(screen.getByLabelText(cellLabel(2, 1)), {
      target: { value: "Prior work" },
    });
    fireEvent.change(screen.getByLabelText(alignLabel(2)), {
      target: { value: "r" },
    });
    fireEvent.change(
      screen.getByLabelText(enResearchTools.table.captionAria),
      { target: { value: "Ablation" } },
    );
    expect(screen.getAllByText(/Prior work/).length).toBeGreaterThan(1);
    expect(screen.getByText(/\\caption\{Ablation\}/)).toBeInTheDocument();
    expect(screen.getByText(/\\begin\{tabular\}\{lrc\}/)).toBeInTheDocument();
  });

  it("copies the generated source and toasts once the clipboard accepted it", async () => {
    render(<TableGeneratorPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.copy }),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("\\begin{table}"),
    );
    await vi.waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        enResearchTools.table.copiedSource,
      ),
    );
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("does not claim a copy that the clipboard rejected", async () => {
    const denied = new Error("Document is not focused.");
    writeText.mockRejectedValueOnce(denied);
    render(<TableGeneratorPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.copy }),
    );
    await vi.waitFor(() =>
      expect(notifyError).toHaveBeenCalledExactlyOnceWith(
        "table copy latex",
        denied,
        enResearchTools.equation.copyLatexFailed,
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("hides the header row when the header toggle is off", () => {
    render(<TableGeneratorPanel />);
    fireEvent.click(screen.getByLabelText(enResearchTools.table.headerRow));
    expect(screen.queryByText(/\\midrule/)).not.toBeInTheDocument();
  });
});

describe("TableToolView", () => {
  it("renders the generator inside the tool shell", () => {
    useHomeViewStore.setState({ page: "table" });
    render(<TableToolView />);
    expect(screen.getByTestId("table-tool-view")).toBeInTheDocument();
    expect(screen.getByText(toolName("table"))).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.table.subtitle),
    ).toBeInTheDocument();
  });
});
