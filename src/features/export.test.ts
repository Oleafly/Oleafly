import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: { projectId: "paper-a", projectName: "My paper", flushForQuit: vi.fn() },
  pdfBytes: new Uint8Array([1, 2]), exportPdf: vi.fn(), exportProjectImage: vi.fn(),
  pdfPageToPng: vi.fn(),
  pickSavePath: vi.fn(), ensurePandoc: vi.fn(), exportDocument: vi.fn(), downloadProjectZip: vi.fn(),
  notifyError: vi.fn(), success: vi.fn(), info: vi.fn(() => 42), dismiss: vi.fn(),
}));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({ pdfBytes: mocks.pdfBytes }) } }));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: "chapters/main.tex" }) }));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));
vi.mock("@/lib/tauri", () => ({ exportPdf: mocks.exportPdf, exportProjectImage: mocks.exportProjectImage, exportDocument: mocks.exportDocument, downloadProjectZip: mocks.downloadProjectZip }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError, toast: { success: mocks.success, info: mocks.info, dismiss: mocks.dismiss } }));
import { exportCurrentDocument, exportCurrentPdf, exportCurrentImagePng } from "./export";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.projectId = "paper-a";
  mocks.state.flushForQuit.mockResolvedValue(undefined);
  mocks.pickSavePath.mockResolvedValue("/tmp/paper.typ");
  mocks.ensurePandoc.mockResolvedValue(true);
  mocks.exportDocument.mockResolvedValue(undefined);
  mocks.pdfPageToPng.mockResolvedValue("data:image/png;base64,AQ==");
});

describe("document exports", () => {
  it("saves dirty buffers before exporting the captured main document", async () => {
    await exportCurrentDocument("typst");
    expect(mocks.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "My_paper.typ", filters: [{ name: "TYP", extensions: ["typ"] }] }));
    expect(mocks.state.flushForQuit).toHaveBeenCalledOnce();
    expect(mocks.exportDocument).toHaveBeenCalledWith("paper-a", "chapters/main.tex", "typst", "/tmp/paper.typ");
    expect(mocks.state.flushForQuit.mock.invocationCallOrder[0]).toBeLessThan(mocks.exportDocument.mock.invocationCallOrder[0]);
    expect(mocks.dismiss).toHaveBeenCalledWith(42);
  });
  it("stops if the project changes while the save dialog is open", async () => {
    mocks.pickSavePath.mockImplementationOnce(async () => { mocks.state.projectId = "paper-b"; return "/tmp/paper.typ"; });
    await exportCurrentDocument("typst");
    expect(mocks.exportDocument).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith("export document", expect.objectContaining({ message: expect.stringContaining("project changed") }));
  });
  it("stops when saving dirty files fails", async () => {
    mocks.state.flushForQuit.mockRejectedValueOnce(new Error("Disk full"));
    await exportCurrentDocument("docx");
    expect(mocks.exportDocument).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("saves a source archive without requiring Pandoc", async () => {
    await exportCurrentDocument("zip");
    expect(mocks.ensurePandoc).not.toHaveBeenCalled();
    expect(mocks.downloadProjectZip).toHaveBeenCalledWith("paper-a", "/tmp/paper.typ");
    expect(mocks.state.flushForQuit).toHaveBeenCalledOnce();
  });
  it("handles picker errors and lets the user retry", async () => {
    mocks.pickSavePath.mockRejectedValueOnce(new Error("Picker failed"));
    await exportCurrentDocument("typst");
    expect(mocks.notifyError).toHaveBeenCalled();
    await exportCurrentDocument("typst");
    expect(mocks.exportDocument).toHaveBeenCalledOnce();
  });
  it("does not start a second export while a picker is pending", async () => {
    let finish!: (path: string | null) => void;
    mocks.pickSavePath.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const first = exportCurrentDocument("typst");
    await exportCurrentDocument("docx");
    expect(mocks.pickSavePath).toHaveBeenCalledOnce();
    finish(null);
    await first;
    expect(mocks.exportDocument).not.toHaveBeenCalled();
  });
});


describe("compiled exports", () => {
  it.each([exportCurrentPdf, exportCurrentImagePng])("reports picker failures and permits retry", async (exportFile) => {
    mocks.pickSavePath.mockRejectedValueOnce(new Error("Picker failed"));
    await exportFile();
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    await exportFile();
    expect(mocks.success).toHaveBeenCalledOnce();
  });
  it.each([exportCurrentPdf, exportCurrentImagePng])("refuses to export after changing projects", async (exportFile) => {
    mocks.pickSavePath.mockImplementationOnce(async () => { mocks.state.projectId = "paper-b"; return "/tmp/export"; });
    await exportFile();
    expect(mocks.exportPdf).not.toHaveBeenCalled();
    expect(mocks.exportProjectImage).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledOnce();
  });
  it("stops when the project changes while rendering an image", async () => {
    mocks.pdfPageToPng.mockImplementationOnce(async () => { mocks.state.projectId = "paper-b"; return "data:image/png;base64,AQ=="; });
    await exportCurrentImagePng();
    expect(mocks.exportProjectImage).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
