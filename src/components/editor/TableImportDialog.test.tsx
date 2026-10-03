// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFolderAccessStore } from "@/store/folder-access";
import { useTableImportStore } from "@/store/table-import";

interface FilesState {
  projectId: string;
  activePath: string;
  manifestHome: string;
  tree: { path: string; is_dir: boolean }[];
  engine: { id: string };
}
const mocks = vi.hoisted(() => ({
  pick: vi.fn(), read: vi.fn(), insert: vi.fn(), notify: vi.fn(), success: vi.fn(), log: vi.fn(),
  writeLinked: vi.fn(),
  files: {} as FilesState,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickTableImportPath: mocks.pick }));
vi.mock("@/lib/tauri", () => ({ readPickedFileBase64: vi.fn(), registerPickedFileForE2E: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notify, toast: { success: mocks.success } }));
vi.mock("@/lib/log", () => ({ logError: mocks.log }));
vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: mocks.insert }));
vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign((select: (state: FilesState) => unknown) => select(mocks.files), { getState: () => mocks.files }),
}));
vi.mock("@/features/table-import", async (original) => ({
  ...await original<typeof import("@/features/table-import")>(),
  readTableFile: async (path: string) => ({ rows: await mocks.read(path), format: "csv", text: "Method,Score\n" }),
  writeLinkedTableData: mocks.writeLinked,
}));
import { TableImportDialog } from "./TableImportDialog";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function choose() {
  fireEvent.click(screen.getByRole("button", { name: /Choose (CSV|another)/ }));
  await screen.findByTestId("table-import-preview");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.files = {
    projectId: "paper",
    activePath: "main.tex",
    manifestHome: "folder",
    tree: [{ path: "main.tex", is_dir: false }],
    engine: { id: "latex" },
  };
  mocks.pick.mockResolvedValue("/tmp/results.csv");
  mocks.read.mockResolvedValue([["Method", "Score"], ["A&B", "50%"]]);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  useTableImportStore.setState({ open: true });
});

describe("TableImportDialog", () => {
  it("keeps an empty or cancelled selection out of the editor", async () => {
    mocks.pick.mockResolvedValue(null);
    render(<TableImportDialog />);
    expect(screen.getByRole("button", { name: "Copy source" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Insert at cursor" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Choose CSV/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Choose CSV/ })).toBeEnabled());
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("limits the preview while copying and inserting the full escaped table", async () => {
    mocks.read.mockResolvedValue(Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 8 }, (_, column) => `${row},${column}&`)));
    render(<TableImportDialog />);
    await choose();
    const preview = within(screen.getByTestId("table-import-preview"));
    expect(preview.getAllByRole("row")).toHaveLength(6);
    expect(preview.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.getByText(/The full table will be inserted/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Caption (optional)"), { target: { value: "  Trial & results  " } });
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: "  tab:results  " } });
    fireEvent.click(screen.getByRole("switch", { name: "First row is a header" }));
    expect(preview.queryAllByRole("columnheader")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    const source = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(source).toContain("7,7\\&");
    expect(source).toContain("\\caption{Trial \\& results}");
    expect(source).toContain("\\label{tab:results}");
    expect(screen.getByTestId("table-import-dialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    expect(mocks.insert).toHaveBeenCalledWith(`\n${source}\n`);
    expect(useTableImportStore.getState().open).toBe(false);
    expect(mocks.success).toHaveBeenLastCalledWith(expect.stringContaining("booktabs"));
  });

  it("keeps the table out of a read-only folder and says why", async () => {
    useFolderAccessStore.setState({ projectId: "paper", status: { read_only: true, synced_with: null } });
    try {
      render(<TableImportDialog />);
      await choose();
      fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
      expect(screen.getByRole("alert")).toHaveTextContent(enShell.openedFolder.readOnly.banner);
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
      expect(useTableImportStore.getState().open).toBe(true);
    } finally {
      useFolderAccessStore.getState().reset(null);
    }
  });

  it("blocks unsafe labels and accepts an omitted label after correction", async () => {
    render(<TableImportDialog />);
    await choose();
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: "tab:x}\\input{bad}" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use letters, numbers");
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    expect(mocks.insert).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: " " } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    expect(mocks.insert.mock.calls[0][0]).not.toContain("\\label{");
  });

  it("keeps the preview available when clipboard access fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    render(<TableImportDialog />);
    await choose();
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The table was not copied");
    expect(mocks.log).toHaveBeenCalledWith("copy table source", expect.any(Error));
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(screen.getByTestId("table-import-preview")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Table source copied to the clipboard."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses Typst syntax and writes the label after the figure", async () => {
    mocks.files = { ...mocks.files, activePath: "main.typ", engine: { id: "typst" } };
    mocks.pick.mockResolvedValue("C:\\tables\\results.xlsx");
    render(<TableImportDialog />);
    expect(screen.getByLabelText("Label (optional)")).toHaveValue("tab:imported");
    await choose();
    expect(screen.getByTestId("table-import-file")).toHaveTextContent(
      enEditor.tableImport.selectedSummary
        .replace("{{file}}", "results.xlsx")
        .replace("{{rows}}", "2")
        .replace("{{columns}}", "2"),
    );
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: "  tab:typst  " } });
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    const inserted = mocks.insert.mock.calls[0][0];
    expect(inserted).toContain("#figure(\n  table(\n");
    expect(inserted).toContain(") <tab:typst>");
    expect(inserted).not.toContain("\\begin{tabular}");
    expect(mocks.success).toHaveBeenCalledWith("Typst table inserted at the cursor.");
  });

  it("emits a bare Typst table when the label and caption are empty", async () => {
    mocks.files = { ...mocks.files, activePath: "main.typ", engine: { id: "typst" } };
    render(<TableImportDialog />);
    await choose();
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    const inserted = mocks.insert.mock.calls[0][0];
    expect(inserted).toContain("\n#table(\n");
    expect(inserted).not.toContain("#figure(");
  });

  it("blocks a Typst label that would break the label syntax", async () => {
    mocks.files = { ...mocks.files, activePath: "main.typ", engine: { id: "typst" } };
    render(<TableImportDialog />);
    await choose();
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: "tab:x> #panic()" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    expect(screen.getByRole("alert")).toHaveTextContent(enEditor.tableImport.invalidLabel);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(["picker", "reader", "empty"])("explains a %s failure and allows another file", async (failure) => {
    if (failure === "picker") mocks.pick.mockRejectedValueOnce(new Error("File picker unavailable"));
    if (failure === "reader") mocks.read.mockRejectedValueOnce("bad workbook");
    if (failure === "empty") mocks.read.mockResolvedValueOnce([]);
    render(<TableImportDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Choose CSV/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      failure === "picker"
        ? "File picker unavailable"
        : failure === "reader"
          ? enEditor.tableImport.readFailed
          : enEditor.tableImport.noRows,
    );
    expect(screen.getByRole("button", { name: "Insert at cursor" })).toBeDisabled();
    await choose();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert at cursor" })).toBeEnabled();
  });

  it("rejects a project change while the native picker is open", async () => {
    const pending = deferred<string>();
    mocks.pick.mockReturnValue(pending.promise);
    render(<TableImportDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Choose CSV/ }));
    mocks.files.projectId = "other";
    await act(async () => pending.resolve("/tmp/results.csv"));
    expect(screen.getByRole("alert")).toHaveTextContent("changed while the file picker was open");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("import table", expect.any(Error));
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("shows a failed read only in the open dialog and logs it", async () => {
    mocks.read.mockRejectedValueOnce(new Error("this table has more than 10 columns."));
    render(<TableImportDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Choose CSV/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("more than 10 columns");
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith("import table", expect.any(Error));
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("rejects a document change while rows are loading or before insertion", async () => {
    const pending = deferred<string[][]>();
    mocks.read.mockReturnValueOnce(pending.promise);
    render(<TableImportDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Choose CSV/ }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
    mocks.files.activePath = "other.tex";
    await act(async () => pending.resolve([["old"]]));
    expect(screen.getByRole("alert")).toHaveTextContent("changed while the table was loading");
    await choose();
    mocks.files.activePath = "third.tex";
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the table again before inserting");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("offers a linked table only for Typst documents", async () => {
    render(<TableImportDialog />);
    await choose();
    expect(screen.queryByRole("switch", { name: enEditor.tableImport.keepLinked })).not.toBeInTheDocument();
  });

  it("copies the data into data/ and inserts code that reads it at compile time", async () => {
    mocks.files = { ...mocks.files, activePath: "sections/results.typ", engine: { id: "typst" } };
    mocks.writeLinked.mockResolvedValue(undefined);
    render(<TableImportDialog />);
    await choose();
    fireEvent.click(screen.getByRole("switch", { name: enEditor.tableImport.keepLinked }));
    expect(screen.queryByRole("button", { name: "Copy source" })).not.toBeInTheDocument();
    expect(screen.getByText(enEditor.tableImport.footerLinked.replace("{{path}}", "data/results.csv"))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce());
    expect(mocks.writeLinked).toHaveBeenCalledWith("paper", {
      dataPath: "data/results.csv",
      content: "Method,Score\n",
      source: { format: "csv", path: "../data/results.csv" },
    });
    const inserted = mocks.insert.mock.calls[0][0];
    expect(inserted).toContain('#let results-data = csv("../data/results.csv")');
    expect(inserted).toContain("..results-data.slice(1).flatten(),");
    expect(inserted).toContain(") <tab:imported>");
    expect(useTableImportStore.getState().open).toBe(false);
    expect(mocks.success).toHaveBeenCalledWith(enEditor.tableImport.insertedLinked.replace("{{path}}", "data/results.csv"));
  });

  it("keeps the dialog open and inserts nothing when the data copy fails", async () => {
    mocks.files = { ...mocks.files, activePath: "main.typ", engine: { id: "typst" } };
    mocks.writeLinked.mockRejectedValue(new Error("disk full"));
    render(<TableImportDialog />);
    await choose();
    fireEvent.click(screen.getByRole("switch", { name: enEditor.tableImport.keepLinked }));
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enEditor.tableImport.linkFailed);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("link table data", expect.any(Error));
    expect(useTableImportStore.getState().open).toBe(true);
  });

  it("can reopen during a pending read without accepting its old result", async () => {
    const pending = deferred<string[][]>();
    mocks.read.mockReturnValueOnce(pending.promise);
    render(<TableImportDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Choose CSV/ }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
    act(() => useTableImportStore.getState().setOpen(false));
    act(() => useTableImportStore.getState().setOpen(true));
    expect(screen.getByRole("button", { name: /Choose CSV/ })).toBeEnabled();
    await choose();
    await act(async () => pending.resolve([["stale table"]]));
    expect(screen.getByTestId("table-import-preview")).toHaveTextContent("A&B");
    expect(screen.getByTestId("table-import-preview")).not.toHaveTextContent("stale table");
  });
});
