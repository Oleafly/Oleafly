// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useTableImportStore } from "@/store/table-import";

interface FilesState {
  projectId: string;
  activePath: string;
  engine: { id: string };
}
const mocks = vi.hoisted(() => ({
  pick: vi.fn(), read: vi.fn(), insert: vi.fn(), notify: vi.fn(), success: vi.fn(),
  files: {} as FilesState,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickTableImportPath: mocks.pick }));
vi.mock("@/lib/tauri", () => ({ readPickedFileBase64: vi.fn(), registerPickedFileForE2E: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notify, toast: { success: mocks.success } }));
vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: mocks.insert }));
vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign((select: (state: FilesState) => unknown) => select(mocks.files), { getState: () => mocks.files }),
}));
vi.mock("@/features/table-import", async (original) => ({
  ...await original<typeof import("@/features/table-import")>(), readTableRows: mocks.read,
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
  mocks.files = { projectId: "paper", activePath: "main.tex", engine: { id: "latex" } };
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
    expect(mocks.notify).toHaveBeenCalledWith("copy table source", expect.any(Error));
    expect(screen.getByTestId("table-import-preview")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Table source copied to the clipboard."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses Typst syntax and omits the LaTeX label field", async () => {
    mocks.files = { ...mocks.files, activePath: "main.typ", engine: { id: "typst" } };
    mocks.pick.mockResolvedValue("C:\\tables\\results.xlsx");
    render(<TableImportDialog />);
    expect(screen.queryByLabelText("Label (optional)")).not.toBeInTheDocument();
    await choose();
    expect(screen.getByTestId("table-import-file")).toHaveTextContent(
      enEditor.tableImport.selectedSummary
        .replace("{{file}}", "results.xlsx")
        .replace("{{rows}}", "2")
        .replace("{{columns}}", "2"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    expect(mocks.insert.mock.calls[0][0]).toContain("#table(");
    expect(mocks.insert.mock.calls[0][0]).not.toContain("\\begin{tabular}");
    expect(mocks.success).toHaveBeenCalledWith("Typst table inserted at the cursor.");
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
