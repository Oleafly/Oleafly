// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addCitations: vi.fn(),
  getConnectorKey: vi.fn(),
  logError: vi.fn(),
  parseCitationFile: vi.fn(),
  setConnectorKey: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  zoteroLibraryBibtex: vi.fn(),
  zoteroVerify: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getConnectorKey: mocks.getConnectorKey,
  setConnectorKey: mocks.setConnectorKey,
  zoteroLibraryBibtex: mocks.zoteroLibraryBibtex,
  zoteroVerify: mocks.zoteroVerify,
}));

vi.mock("@/features/citation", () => ({
  addCitations: mocks.addCitations,
  parseCitationFile: mocks.parseCitationFile,
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enReferences from "@/i18n/locales/en/references.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { useZoteroConnectorStore } from "@/store/zotero-connector";
import { ImportReferenceLibraryDialog } from "./ImportReferenceLibraryDialog";

const zoteroText = enReferences.import.zotero;

function connectZotero() {
  mocks.getConnectorKey.mockImplementation(async (id: string) =>
    id === "zotero-api-key" ? "zk-key" : null,
  );
}

async function expectInlineError(message: string) {
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
  expect(mocks.toastError).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectorKey.mockResolvedValue(null);
  mocks.zoteroLibraryBibtex.mockResolvedValue({
    bibtex: "@article{smith_2023,\n\ttitle = {A paper},\n}",
    count: 1,
    total: 1,
  });
  useZoteroConnectorStore.setState({
    connected: false,
    loading: false,
    username: null,
    error: null,
  });
  useSettingsStore.setState({
    settingsOpen: false,
    settingsInitialSection: "general",
    settingsScrollTarget: null,
  });
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

    await expectInlineError(
      "2 problems during import. Could not write references.bib. The project changed.",
    );
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
    await expectInlineError(
      enReferences.import.unrecognized.replace("{{name}}", "notes.docx"),
    );
    expect(mocks.addCitations).not.toHaveBeenCalled();
  });

  it("rejects a file that holds no reference", async () => {
    mocks.parseCitationFile.mockReturnValue([]);
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    await chooseEndnoteFile();
    await expectInlineError(enReferences.import.empty);
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
    await expectInlineError(
      "Could not write references.bib.",
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
    await expectInlineError(enReferences.import.failed);
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
    await expectInlineError(enReferences.import.readFailed);
    expect(mocks.logError).toHaveBeenCalledWith(
      "import references",
      expect.any(Error),
    );
    expect(mocks.addCitations).not.toHaveBeenCalled();
  });

  it("reports a failed import step as an import failure, not a read failure", async () => {
    const onOpenChange = vi.fn();
    mocks.addCitations.mockRejectedValue(new Error("main.typ is read-only"));
    render(<ImportReferenceLibraryDialog open onOpenChange={onOpenChange} />);
    await chooseZoteroFile();
    await expectInlineError(enReferences.import.failed);
    expect(mocks.logError).toHaveBeenCalledWith(
      "import references",
      expect.any(Error),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("clears the previous error when the reader tries another file", async () => {
    mocks.parseCitationFile.mockReturnValueOnce([]);
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    await chooseEndnoteFile();
    await expectInlineError(enReferences.import.empty);
    await chooseZoteroFile();
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "1 reference added to references.bib.",
    );
  });

  it("forgets the error once the dialog closes", async () => {
    mocks.parseCitationFile.mockReturnValueOnce([]);
    const { rerender } = render(
      <ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />,
    );
    await chooseEndnoteFile();
    await expectInlineError(enReferences.import.empty);
    rerender(<ImportReferenceLibraryDialog open={false} onOpenChange={vi.fn()} />);
    rerender(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a change event that carries no file", () => {
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);
    const input = document.querySelector<HTMLInputElement>('input[accept=".rdf"]');
    fireEvent.change(input as HTMLInputElement, { target: { files: [] } });
    expect(mocks.parseCitationFile).not.toHaveBeenCalled();
  });

  it("offers to connect Zotero in Settings when no account is saved", async () => {
    const onOpenChange = vi.fn();
    render(<ImportReferenceLibraryDialog open onOpenChange={onOpenChange} />);

    await waitFor(() =>
      expect(mocks.getConnectorKey).toHaveBeenCalledWith("zotero-api-key"),
    );
    expect(
      screen.queryByRole("button", { name: zoteroText.importLibrary }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zoteroText.connect }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "integrations",
      settingsScrollTarget: "zotero",
    });
    expect(mocks.zoteroLibraryBibtex).not.toHaveBeenCalled();
  });

  it("imports the whole connected Zotero library through the shared import path", async () => {
    connectZotero();
    const onOpenChange = vi.fn();
    const onImported = vi.fn();
    render(
      <ImportReferenceLibraryDialog
        open
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );

    expect(await screen.findByText(zoteroText.connectedDescription)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: zoteroText.connect }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: zoteroText.button })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zoteroText.importLibrary }));

    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(mocks.zoteroLibraryBibtex).toHaveBeenCalledOnce();
    expect(mocks.parseCitationFile).toHaveBeenCalledWith(
      "zotero-library.bib",
      "@article{smith_2023,\n\ttitle = {A paper},\n}",
    );
    expect(mocks.addCitations).toHaveBeenCalledWith([
      expect.objectContaining({ key: "smith2023paper" }),
    ]);
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("1 reference added to references.bib.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reports duplicates from a Zotero import like a file import", async () => {
    connectZotero();
    mocks.addCitations.mockResolvedValue({
      imported: 2,
      duplicates: 3,
      errors: [],
      bibPath: "references.bib",
    });
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: zoteroText.importLibrary }));

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "2 references added to references.bib, 3 already there.",
      ),
    );
  });

  it("says when only part of a very large Zotero library was read", async () => {
    connectZotero();
    mocks.zoteroLibraryBibtex.mockResolvedValue({
      bibtex: "@article{a,\n}",
      count: 5000,
      total: 7200,
    });
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: zoteroText.importLibrary }));

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        `1 reference added to references.bib. ${zoteroText.limited
          .replace("{{fetched}}", "5000")
          .replace("{{total}}", "7200")}`,
      ),
    );
  });

  it("shows why the Zotero library could not be fetched", async () => {
    connectZotero();
    const onOpenChange = vi.fn();
    mocks.zoteroLibraryBibtex.mockRejectedValue(
      `@oleafly/error:${JSON.stringify({ code: "zotero.rate_limited" })}`,
    );
    render(<ImportReferenceLibraryDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(await screen.findByRole("button", { name: zoteroText.importLibrary }));

    await expectInlineError(enErrors.zotero.rate_limited);
    expect(mocks.logError).toHaveBeenCalledWith(
      "import Zotero library",
      expect.stringContaining("zotero.rate_limited"),
    );
    expect(mocks.addCitations).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: zoteroText.importLibrary })).toBeEnabled();
  });

  it("explains an empty Zotero library", async () => {
    connectZotero();
    mocks.zoteroLibraryBibtex.mockResolvedValue({ bibtex: "", count: 0, total: 0 });
    mocks.parseCitationFile.mockReturnValue([]);
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: zoteroText.importLibrary }));

    await expectInlineError(zoteroText.empty);
    expect(mocks.addCitations).not.toHaveBeenCalled();
  });

  it("disables both Zotero buttons while the library downloads", async () => {
    connectZotero();
    let finish: (value: { bibtex: string; count: number; total: number }) => void = () => {};
    mocks.zoteroLibraryBibtex.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ImportReferenceLibraryDialog open onOpenChange={vi.fn()} />);

    const importButton = await screen.findByRole("button", { name: zoteroText.importLibrary });
    fireEvent.click(importButton);

    await waitFor(() => expect(importButton).toBeDisabled());
    expect(screen.getByRole("button", { name: zoteroText.button })).toBeDisabled();
    finish({ bibtex: "@article{a,\n}", count: 1, total: 1 });
    await waitFor(() => expect(mocks.addCitations).toHaveBeenCalledOnce());
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
