// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useHomeViewStore } from "@/store/home-view";

const mocks = vi.hoisted(() => ({
  resolveCitation: vi.fn(),
  bibtexForHit: vi.fn(),
  pickSavePath: vi.fn(),
  writeBytesFile: vi.fn(),
  writeText: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  formatCitations: vi.fn(),
}));

vi.mock("@/features/citation", () => ({
  resolveCitation: mocks.resolveCitation,
  bibtexForHit: mocks.bibtexForHit,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/tauri", () => ({ writeBytesFile: mocks.writeBytesFile }));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => null }));
vi.mock("@/lib/reference-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reference-tools")>();
  const formatted = (bibtex: string) => {
    const entries = bibtex.match(/@\w+\s*[{(]/g)?.length ?? 0;
    return {
      bibliography: bibtex,
      inText: entries > 0 ? "(Local citation)" : "",
      entries,
    };
  };
  return {
    ...actual,
    formatCitations: (bibtex: string, style: string) => mocks.formatCitations(bibtex, style),
    formatAllStyles: (bibtex: string) => actual.CITATION_STYLES.map((style) => ({
      ...style,
      ...formatted(bibtex),
    })),
  };
});
vi.mock("@/components/tools/CodeField", () => ({
  CodeField: ({ value, onChange, testId, readOnly }: {
    value: string;
    onChange: (value: string) => void;
    testId: string;
    readOnly?: boolean;
  }) => (
    <textarea
      data-testid={testId}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { ReferenceToolView } from "./ReferenceToolView";

const TURING = `@article{turing1950computing,
  author = {Turing, Alan},
  title = {Computing Machinery and Intelligence},
  journal = {Mind},
  year = {1950},
  volume = {59},
  pages = {433--460}
}`;

function open(tool: NonNullable<ReturnType<typeof useHomeViewStore.getState>["activeReferenceTool"]>) {
  useHomeViewStore.setState({ page: "reference", activeReferenceTool: tool });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pickSavePath.mockResolvedValue(null);
  mocks.writeBytesFile.mockResolvedValue(undefined);
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  mocks.resolveCitation.mockResolvedValue({ bibtex: TURING });
  mocks.bibtexForHit.mockResolvedValue(TURING);
  mocks.formatCitations.mockImplementation((bibtex: string) => {
    const entries = bibtex.match(/@\w+\s*[{(]/g)?.length ?? 0;
    return {
      bibliography: bibtex,
      inText: entries > 0 ? "(Local citation)" : "",
      entries,
    };
  });
  open("citation-generator");
});

describe("ReferenceToolView", () => {
  it("starts the general citation tool with an editable local example", () => {
    render(<ReferenceToolView />);
    expect(screen.getByText("Citation Generator")).toBeVisible();
    expect(screen.getByTestId("formatted-citation-output")).toHaveTextContent(/Vaswani/i);
    expect(screen.getByText("Local formatter ready")).toBeVisible();
  });

  it("updates local output, changes styles, and copies each output form", async () => {
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A Revised Local Result" } });
    for (const [label, value] of [
      ["Volume", "42"],
      ["Issue", "3"],
      ["Pages", "10--20"],
      ["DOI", "https://doi.org/10.1000/revised"],
      ["ISBN", "9780262035613"],
      ["PMID", "12345678"],
      ["URL", "https://example.org/revised"],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText("Reference type"), { target: { value: "book" } });
    fireEvent.change(screen.getByLabelText("Publisher"), { target: { value: "Example Press" } });
    expect(screen.getByTestId("formatted-citation-output")).toHaveTextContent("A Revised Local Result");
    fireEvent.change(screen.getByLabelText("Citation style"), { target: { value: "ieee" } });
    fireEvent.click(screen.getByRole("button", { name: "In-text" }));
    expect(screen.getByTestId("formatted-citation-output")).not.toHaveTextContent(
      "Add enough reference details",
    );
    fireEvent.click(screen.getByRole("button", { name: /^BibTeX$/ }));
    expect((screen.getByTestId("reference-bibtex-output") as HTMLTextAreaElement).value).toContain(
      "A Revised Local Result",
    );
    fireEvent.change(screen.getByTestId("reference-bibtex-output"), {
      target: { value: "This read-only result must not replace the source" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Copy$/ }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(
      expect.stringContaining("A Revised Local Result"),
    ));
  });

  it("loads pasted BibTeX locally and explains an empty lookup", () => {
    render(<ReferenceToolView />);
    const input = screen.getByTestId("reference-lookup-input");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter doi, arxiv id/i);
    fireEvent.change(input, { target: { value: TURING } });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    expect(screen.getByDisplayValue("Computing Machinery and Intelligence")).toBeVisible();
    expect(screen.getByText("BibTeX loaded locally")).toBeVisible();
    expect(mocks.resolveCitation).not.toHaveBeenCalled();
  });

  it("retrieves DOI metadata and keeps every returned field editable", async () => {
    open("doi-to-bibtex");
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByTestId("reference-lookup-input"), {
      target: { value: "10.1000/example" },
    });
    fireEvent.keyDown(screen.getByTestId("reference-lookup-input"), { key: "Enter" });
    expect(await screen.findByDisplayValue("Computing Machinery and Intelligence")).toBeVisible();
    expect(mocks.resolveCitation).toHaveBeenCalledWith("10.1000/example");
    expect(screen.getByText(/Review the fields before exporting/)).toBeVisible();
  });

  it("rejects the wrong identifier before making a network request", () => {
    open("isbn-to-bibtex");
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByTestId("reference-lookup-input"), {
      target: { value: "not an isbn" },
    });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    expect(screen.getByRole("alert")).toHaveTextContent("valid ISBN");
    expect(mocks.resolveCitation).not.toHaveBeenCalled();
  });

  it("builds an editable generic webpage entry locally", () => {
    open("url-to-bibtex");
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByTestId("reference-lookup-input"), {
      target: { value: "https://example.org/research" },
    });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    expect(screen.getByDisplayValue("Untitled webpage")).toBeVisible();
    expect(screen.getByText(/private, editable webpage entry locally/i)).toBeVisible();
    expect(mocks.resolveCitation).not.toHaveBeenCalled();
  });

  it("rejects an incomplete webpage address", () => {
    open("url-to-bibtex");
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByTestId("reference-lookup-input"), {
      target: { value: "example dot org" },
    });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    expect(screen.getByRole("alert")).toHaveTextContent("complete http or https");
  });

  it("shows lookup service errors and a no-match recovery path", async () => {
    mocks.resolveCitation.mockResolvedValueOnce({ error: "Catalog unavailable" });
    render(<ReferenceToolView />);
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog unavailable");

    fireEvent.change(screen.getByTestId("reference-lookup-input"), {
      target: { value: "another title" },
    });
    mocks.resolveCitation.mockResolvedValueOnce({ hits: [] });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No matching reference");
  });

  it("keeps malformed service BibTeX editable and reports its formatting problem", async () => {
    mocks.resolveCitation.mockResolvedValueOnce({ bibtex: "not BibTeX" });
    render(<ReferenceToolView />);
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No complete BibTeX entries");
  });

  it("offers title matches and converts the selected result", async () => {
    mocks.resolveCitation.mockResolvedValueOnce({
      hits: [{
        doi: "10.1000/turing",
        title: "Computing Machinery and Intelligence",
        authors: ["Alan Turing"],
        year: "1950",
        venue: "Mind",
        type: "journal-article",
      }],
    });
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByTestId("reference-lookup-input"), {
      target: { value: "Computing machinery" },
    });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    fireEvent.click(await screen.findByRole("button", { name: /Computing Machinery and Intelligence/ }));
    expect(await screen.findByDisplayValue("Computing Machinery and Intelligence")).toBeVisible();
    expect(mocks.bibtexForHit).toHaveBeenCalledOnce();
  });

  it("keeps the search results available when one cannot be converted", async () => {
    mocks.resolveCitation.mockResolvedValueOnce({
      hits: [{
        doi: null,
        title: "A difficult record",
        authors: [],
        year: null,
        venue: null,
        type: null,
      }],
    });
    mocks.bibtexForHit.mockRejectedValueOnce(new Error("Record conversion failed"));
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByTestId("reference-lookup-input"), { target: { value: "difficult" } });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    fireEvent.click(await screen.findByRole("button", { name: "A difficult record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Record conversion failed");
  });

  it("ignores a lookup result after the input changes", async () => {
    let finish: ((value: { bibtex: string }) => void) | undefined;
    mocks.resolveCitation.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    open("doi-to-bibtex");
    render(<ReferenceToolView />);
    const input = screen.getByTestId("reference-lookup-input");
    fireEvent.change(input, { target: { value: "10.1000/old" } });
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    fireEvent.change(input, { target: { value: "10.1000/new" } });
    finish?.({ bibtex: TURING });
    await waitFor(() => expect(screen.queryByDisplayValue("Computing Machinery and Intelligence")).not.toBeInTheDocument());
  });

  it("ignores a selected search result after a newer edit supersedes it", async () => {
    let finish: ((value: string) => void) | undefined;
    mocks.resolveCitation.mockResolvedValueOnce({
      hits: [{ doi: "10.1000/slow", title: "Slow result", authors: [], year: null, venue: null, type: null }],
    });
    mocks.bibtexForHit.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<ReferenceToolView />);
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    fireEvent.click(await screen.findByRole("button", { name: "Slow result" }));
    fireEvent.change(screen.getByTestId("reference-lookup-input"), { target: { value: "newer edit" } });
    finish?.(TURING);
    await waitFor(() => expect(screen.queryByDisplayValue("Computing Machinery and Intelligence")).not.toBeInTheDocument());
  });

  it("uses a helpful fallback when a result conversion rejects with a non-Error value", async () => {
    mocks.resolveCitation.mockResolvedValueOnce({
      hits: [{ doi: null, title: "Unusual record", authors: [], year: null, venue: null, type: null }],
    });
    mocks.bibtexForHit.mockRejectedValueOnce("untyped failure");
    render(<ReferenceToolView />);
    fireEvent.click(screen.getByTestId("reference-lookup-button"));
    fireEvent.click(await screen.findByRole("button", { name: "Unusual record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't build this reference");
  });

  it("adds structured entries to a multi-reference bibliography", () => {
    open("bibliography-generator");
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A New Result" } });
    fireEvent.change(screen.getByLabelText("Authors"), { target: { value: "Grace Hopper" } });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "1952" } });
    fireEvent.change(screen.getByLabelText("Journal"), { target: { value: "Research Notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to bibliography" }));
    expect(screen.getByText("3 references")).toBeVisible();
    expect(screen.getByText("Reference added to the bibliography")).toBeVisible();
  });

  it("validates bibliography input and supports each structured source type", () => {
    open("bibliography-generator");
    render(<ReferenceToolView />);
    fireEvent.click(screen.getByRole("button", { name: "Add to bibliography" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a title");

    const type = screen.getByLabelText("Reference type");
    fireEvent.change(type, { target: { value: "book" } });
    expect(screen.getByLabelText("Publisher")).toBeVisible();
    expect(screen.queryByLabelText("Journal")).not.toBeInTheDocument();
    fireEvent.change(type, { target: { value: "inproceedings" } });
    expect(screen.getByLabelText("Conference or proceedings")).toBeVisible();
    fireEvent.change(type, { target: { value: "incollection" } });
    expect(screen.getByLabelText("Book title")).toBeVisible();
    fireEvent.change(type, { target: { value: "misc" } });
    expect(screen.getByLabelText("Container title")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Edit BibTeX" }));
    fireEvent.change(screen.getByTestId("bibliography-bibtex-input"), {
      target: { value: "not BibTeX" },
    });
    expect(screen.getByText("This reference needs attention")).toBeVisible();
    expect(screen.getAllByText("No complete BibTeX entries were found.").length).toBeGreaterThan(0);
  });

  it("compares, copies, and saves one reference across all eight bundled styles", async () => {
    mocks.pickSavePath.mockResolvedValue("/tmp/styles.bib");
    open("citation-styles");
    render(<ReferenceToolView />);
    for (const style of ["APA 7", "MLA 9", "Chicago", "IEEE", "Harvard", "Vancouver", "AMA 11", "ACS"]) {
      expect(await screen.findByRole("heading", { name: style })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "Copy BibTeX" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(expect.stringContaining("Attention Is All You Need")));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.writeBytesFile).toHaveBeenCalledWith("/tmp/styles.bib", expect.any(String)));
    fireEvent.click(screen.getAllByRole("button", { name: /^Copy$/ })[0]);
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Copied APA 7 citation"));
  });

  it("isolates a failed style while keeping the remaining comparisons usable", async () => {
    mocks.formatCitations.mockImplementation((bibtex: string, style: string) => {
      if (style === "mla") throw new Error("MLA formatter unavailable");
      return { bibliography: bibtex, inText: "(Local citation)", entries: 1 };
    });
    open("citation-styles");
    render(<ReferenceToolView />);
    expect(await screen.findByText("MLA formatter unavailable")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "ACS" })).toBeVisible();
  });

  it("reports an unreadable formatter failure without crashing the workspace", () => {
    mocks.formatCitations.mockImplementationOnce(() => { throw "untyped failure"; });
    render(<ReferenceToolView />);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't format this BibTeX");
  });

  it("reports malformed style-comparison input and resets the example", async () => {
    open("citation-styles");
    render(<ReferenceToolView />);
    fireEvent.change(screen.getByTestId("citation-styles-bibtex-input"), {
      target: { value: "not BibTeX" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("No complete BibTeX entries");
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }));
    expect(await screen.findByRole("heading", { name: "APA 7" })).toBeVisible();
  });

  it("saves the exact BibTeX shown in the workspace", async () => {
    mocks.pickSavePath.mockResolvedValue("/tmp/references.bib");
    render(<ReferenceToolView />);
    fireEvent.click(screen.getByRole("button", { name: "Save .bib" }));
    await waitFor(() => expect(mocks.writeBytesFile).toHaveBeenCalledWith(
      "/tmp/references.bib",
      expect.any(String),
    ));
    expect(mocks.success).toHaveBeenCalledWith("Saved references.bib");
  });

  it("handles save and clipboard failures without an unhandled rejection", async () => {
    mocks.pickSavePath.mockResolvedValue("/tmp/references.bib");
    mocks.writeBytesFile.mockRejectedValueOnce(new Error("Disk is full"));
    mocks.writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    render(<ReferenceToolView />);
    fireEvent.click(screen.getByRole("button", { name: /^Copy$/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Clipboard unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Save .bib" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Disk is full"));
  });

  it("renders nothing until a reference tool has been selected", () => {
    useHomeViewStore.setState({ page: "reference", activeReferenceTool: null });
    const { container } = render(<ReferenceToolView />);
    expect(container).toBeEmptyDOMElement();
  });
});
