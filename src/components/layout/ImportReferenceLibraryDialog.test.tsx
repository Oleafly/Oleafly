// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addCitations: vi.fn(),
  notifyError: vi.fn(),
  parseCitationFile: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/features/citation", () => ({
  addCitations: mocks.addCitations,
  parseCitationFile: mocks.parseCitationFile,
}));

vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

import { ImportReferenceLibraryDialog } from "./ImportReferenceLibraryDialog";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseCitationFile.mockReturnValue([
    {
      type: "article",
      key: "smith2023paper",
      fields: { title: "A paper", doi: "10.1000/paper" },
    },
  ]);
  mocks.addCitations.mockResolvedValue({
    imported: 1,
    duplicates: 0,
    errors: [],
  });
});

describe("ImportReferenceLibraryDialog", () => {
  it("explains every supported library format", () => {
    render(
      <ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Import reference library" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Zotero")).toBeInTheDocument();
    expect(screen.getByText("EndNote, RIS, or BibTeX")).toBeInTheDocument();
    expect(screen.getByTestId("zotero-logo")).toBeInTheDocument();
    expect(screen.getByTestId("endnote-logo")).toBeInTheDocument();

    const inputs = document.querySelectorAll<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveAttribute("accept", ".rdf");
    expect(inputs[1]).toHaveAttribute("accept", ".xml,.ris,.bib");
  });

  it("imports the selected file and closes after adding references", async () => {
    const onOpenChange = vi.fn();
    render(
      <ImportReferenceLibraryDialog
        open
        onOpenChange={onOpenChange}
      />,
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".rdf"]',
    );
    const file = {
      name: "zotero-library.rdf",
      text: vi.fn().mockResolvedValue("<rdf:RDF />"),
    } as unknown as File;

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(mocks.parseCitationFile).toHaveBeenCalledWith(
        "zotero-library.rdf",
        "<rdf:RDF />",
      );
    });
    expect(mocks.addCitations).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("1 reference imported");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
