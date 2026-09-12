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

import enReferences from "@/i18n/locales/en/references.json" with { type: "json" };
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
    bibPath: "references.bib",
  });
});

async function chooseZoteroFile(text = "<rdf:RDF />") {
  const input = document.querySelector<HTMLInputElement>('input[accept=".rdf"]');
  const file = {
    name: "zotero-library.rdf",
    text: vi.fn().mockResolvedValue(text),
  } as unknown as File;
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
  await waitFor(() => {
    expect(mocks.addCitations).toHaveBeenCalled();
  });
}

async function chooseEndnoteFile(name = "library.ris") {
  const input = document.querySelector<HTMLInputElement>(
    'input[accept=".xml,.ris,.bib"]',
  );
  const file = {
    name,
    text: vi.fn().mockResolvedValue("TY  - JOUR"),
  } as unknown as File;
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
  await waitFor(() => {
    expect(mocks.parseCitationFile).toHaveBeenCalled();
  });
}

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
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "1 reference added to references.bib.",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("names the bibliography and pluralizes the count", async () => {
    mocks.addCitations.mockResolvedValue({
      imported: 3,
      duplicates: 0,
      errors: [],
      bibPath: "lib/refs.bib",
    });
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);

    await chooseZoteroFile();

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "3 references added to lib/refs.bib.",
      );
    });
  });

  it("reports how many references were already there", async () => {
    mocks.addCitations.mockResolvedValue({
      imported: 0,
      duplicates: 4,
      errors: [],
      bibPath: "references.bib",
    });
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);

    await chooseZoteroFile();

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Those 4 references are already in references.bib.",
      );
    });
  });

  it("counts the problems when more than one reference fails", async () => {
    const onOpenChange = vi.fn();
    mocks.addCitations.mockResolvedValue({
      imported: 0,
      duplicates: 0,
      errors: ["Could not write references.bib", "The project changed."],
      bibPath: "references.bib",
    });
    render(<ImportReferenceLibraryDialog open onOpenChange={onOpenChange} />);

    await chooseZoteroFile();

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "2 problems during import. Could not write references.bib. The project changed.",
      );
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes on an import that added nothing but hit no problem", async () => {
    const onOpenChange = vi.fn();
    const onImported = vi.fn();
    mocks.addCitations.mockResolvedValue({
      imported: 0,
      duplicates: 2,
      errors: [],
      bibPath: "references.bib",
    });
    render(
      <ImportReferenceLibraryDialog
        open
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );

    await chooseZoteroFile();

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledOnce();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("tells the panel to show the citations after a successful import", async () => {
    const onImported = vi.fn();
    render(
      <ImportReferenceLibraryDialog
        open
        onOpenChange={vi.fn()}
        onImported={onImported}
      />,
    );

    await chooseZoteroFile();

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledOnce();
    });
  });

  it("rejects a file format it cannot parse", async () => {
    mocks.parseCitationFile.mockReturnValue(null);
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    await chooseEndnoteFile("notes.docx");
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        enReferences.import.unrecognized.replace("{{name}}", "notes.docx"),
      ),
    );
    expect(mocks.addCitations).not.toHaveBeenCalled();
  });

  it("rejects a file that holds no reference", async () => {
    mocks.parseCitationFile.mockReturnValue([]);
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    await chooseEndnoteFile();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(enReferences.import.empty),
    );
  });

  it("reports a single problem on its own", async () => {
    mocks.addCitations.mockResolvedValue({
      imported: 0,
      duplicates: 0,
      errors: ["Could not write references.bib"],
      bibPath: "references.bib",
    });
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    await chooseZoteroFile();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not write references.bib.",
      ),
    );
  });

  it("falls back to the generic failure for an empty problem list", async () => {
    mocks.addCitations.mockResolvedValue({
      imported: 0,
      duplicates: 0,
      errors: ["   "],
      bibPath: "references.bib",
    });
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    await chooseZoteroFile();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(enReferences.import.failed),
    );
  });

  it("names the default bibliography when the backend reports none", async () => {
    mocks.addCitations.mockResolvedValue({
      imported: 0,
      duplicates: 0,
      errors: [],
      bibPath: "",
    });
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    await chooseZoteroFile();
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        enReferences.import.nothingNew.replace(
          "{{target}}",
          enReferences.import.defaultTarget,
        ),
      ),
    );
  });

  it("reports a file it could not read", async () => {
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    const input = document.querySelector<HTMLInputElement>('input[accept=".rdf"]');
    const file = {
      name: "zotero-library.rdf",
      text: vi.fn().mockRejectedValue(new Error("unreadable")),
    } as unknown as File;
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "import references",
        expect.anything(),
        enReferences.import.readFailed,
      ),
    );
  });

  it("ignores a change event that carries no file", () => {
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    const input = document.querySelector<HTMLInputElement>('input[accept=".rdf"]');
    fireEvent.change(input as HTMLInputElement, { target: { files: [] } });
    expect(mocks.parseCitationFile).not.toHaveBeenCalled();
  });

  it("opens the file picker from the visible button", async () => {
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    const input = document.querySelector<HTMLInputElement>('input[accept=".rdf"]');
    if (!input) throw new Error("no zotero input");
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(
      screen.getByRole("button", { name: enReferences.import.zotero.button }),
    );
    expect(click).toHaveBeenCalled();
  });
});
