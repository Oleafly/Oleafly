// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { standardsFor, type Finding } from "@oleafly/preflight";
import { useFilesStore } from "@/store/files";

const mocks = vi.hoisted(() => ({
  gotoRange: vi.fn(),
  revealSourceEditor: vi.fn(),
  openFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/editor/cm/controller", () => ({ gotoRange: mocks.gotoRange }));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  revealSourceEditor: mocks.revealSourceEditor,
}));

import { FindingRow } from "./FindingRow";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: "finding",
  lens: "compile",
  severity: "error",
  title: "Compile problem",
  detail: "The detailed explanation.",
  ...overrides,
});

describe("FindingRow", () => {
  beforeEach(() => {
    mocks.gotoRange.mockReset();
    mocks.revealSourceEditor.mockReset();
    mocks.openFile.mockClear();
    useFilesStore.setState({ activePath: "main.tex", openFile: mocks.openFile });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it("shows every finding category, severity, location, and certainty label", () => {
    const findings: Finding[] = [
      finding({ id: "compile", lens: "compile", severity: "error", page: 2 }),
      finding({ id: "submission", lens: "submission", severity: "warning", certainty: "advisory" }),
      finding({ id: "privacy", lens: "privacy", severity: "info", certainty: "manual" }),
      finding({ id: "ats", lens: "ats" }),
      finding({ id: "a11y", lens: "a11y" }),
      finding({ id: "both", lens: "both" }),
      finding({ id: "refs", lens: "refs", file: "sections/methods.tex" }),
    ];
    const { container } = render(
      <div>{findings.map((item) => <FindingRow key={item.id} finding={item} />)}</div>,
    );

    for (const label of ["Compile", "Submission", "Privacy", "ATS", "Accessibility", "ATS + Accessibility", "References"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("· p.2")).toBeInTheDocument();
    expect(screen.getByText("· sections/methods.tex")).toBeInTheDocument();
    expect(screen.getByText("· Review")).toBeInTheDocument();
    expect(screen.getByText("· Manual")).toBeInTheDocument();
    expect(container.querySelector(".text-red-500")).toBeInTheDocument();
    expect(container.querySelector(".text-amber-500")).toBeInTheDocument();
    expect(container.querySelector(".text-muted-foreground")).toBeInTheDocument();
  });

  it("expands details and jumps to a source range in another file", async () => {
    useFilesStore.setState({ activePath: "main.tex", openFile: mocks.openFile });
    render(
      <FindingRow
        finding={finding({ file: "sections/results.tex", from: 12, to: 24 })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Compile problem/ }));
    expect(screen.getByText("The detailed explanation.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jump to source" }));

    await waitFor(() => expect(mocks.openFile).toHaveBeenCalledWith("sections/results.tex"));
    expect(mocks.revealSourceEditor).toHaveBeenCalledOnce();
    expect(mocks.gotoRange).toHaveBeenCalledWith(12, 24);

    fireEvent.click(screen.getByRole("button", { name: /Compile problem/ }));
    expect(screen.queryByText("The detailed explanation.")).not.toBeInTheDocument();
  });

  it("does not offer or perform a jump without a complete source range", () => {
    render(<FindingRow finding={finding({ from: 1 })} />);
    fireEvent.click(screen.getByRole("button", { name: /Compile problem/ }));
    expect(screen.queryByRole("button", { name: "Jump to source" })).not.toBeInTheDocument();
  });

  it("cites the standards behind an accessibility finding, each one linked", () => {
    render(
      <FindingRow
        finding={finding({
          id: "figure-alt",
          lens: "a11y",
          title: "Image without alt text",
          standards: standardsFor("figure-alt"),
          machineCheckable: true,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Image without alt text/ }));

    for (const label of ["PDF/UA-1 7.3", "PDF/UA-2 8.2.5.28.2", "Matterhorn 13-004", "WCAG 2.2 SC 1.1.1"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", expect.stringContaining("https://"));
    }
    expect(screen.getByRole("link", { name: "WCAG 2.2 SC 1.1.1" })).toHaveAttribute(
      "href",
      "https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF1",
    );
    expect(screen.queryByText(/Needs your judgment/)).not.toBeInTheDocument();
  });

  it("collapses repeated citation labels into one chip", () => {
    render(
      <FindingRow
        finding={finding({ id: "link-text", lens: "a11y", standards: standardsFor("link-text") })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Compile problem/ }));
    expect(screen.getAllByRole("link", { name: "WCAG 2.2 SC 2.4.4" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "WCAG 2.2 SC 2.4.4" })).toHaveAttribute(
      "title",
      expect.stringContaining("PDF11, PDF13"),
    );
  });

  it("says so when a finding needs human judgement", () => {
    render(<FindingRow finding={finding({ id: "color-only", lens: "a11y", machineCheckable: false })} />);
    fireEvent.click(screen.getByRole("button", { name: /Compile problem/ }));
    expect(screen.getByText(/Needs your judgment/)).toBeInTheDocument();
  });

  it("shows no citation line for a finding with no standard behind it", () => {
    render(<FindingRow finding={finding()} />);
    fireEvent.click(screen.getByRole("button", { name: /Compile problem/ }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
