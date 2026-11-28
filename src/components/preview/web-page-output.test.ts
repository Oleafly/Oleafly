import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compiledOutputPath: vi.fn(),
  readCompiledPage: vi.fn(),
  saveFileBase64: vi.fn(),
  pdfSyncNoteSaved: vi.fn(),
  writeClipboardText: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  compiledOutputPath: mocks.compiledOutputPath,
  readCompiledPage: mocks.readCompiledPage,
  saveFileBase64: mocks.saveFileBase64,
  pdfSyncNoteSaved: mocks.pdfSyncNoteSaved,
  uint8ToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
}));
vi.mock("@/lib/clipboard", () => ({ writeClipboardText: mocks.writeClipboardText }));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { copyOutputPath, saveWebPage, webPageName } from "./web-page-output";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pdfSyncNoteSaved.mockResolvedValue(undefined);
});

describe("web page output", () => {
  it("names a saved page as one HTML file", () => {
    expect(webPageName("Report")).toBe("Report.html");
    expect(webPageName("Report.HTML")).toBe("Report.html");
    expect(webPageName("Report.htm")).toBe("Report.html");
    expect(webPageName("Report.pdf")).toBe("Report.pdf.html");
  });

  it("copies the full output path and says so", async () => {
    mocks.compiledOutputPath.mockResolvedValue("/Users/me/paper/.oleafly/build/_oleafly_entry.html");
    mocks.writeClipboardText.mockResolvedValue(undefined);
    await copyOutputPath("p1", "report.qmd", true);
    expect(mocks.compiledOutputPath).toHaveBeenCalledExactlyOnceWith("p1", "report.qmd", true);
    expect(mocks.writeClipboardText).toHaveBeenCalledExactlyOnceWith(
      "/Users/me/paper/.oleafly/build/_oleafly_entry.html",
    );
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(enWorkspace.files.pathCopied);
  });

  it("tells the user when the path could not be copied", async () => {
    mocks.compiledOutputPath.mockRejectedValue("no compiled PDF: this project has not been compiled");
    await copyOutputPath("p1", "main.tex", false);
    expect(mocks.writeClipboardText).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(enWorkspace.files.copyPathFailed);
    expect(mocks.logError).toHaveBeenCalledWith("copy output path", expect.anything());
  });

  it("saves the built page into the project and remembers it for sync", async () => {
    mocks.readCompiledPage.mockResolvedValue(new TextEncoder().encode("<html></html>").buffer);
    mocks.saveFileBase64.mockResolvedValue({ generation: 1 });
    await saveWebPage("p1", "report.qmd", "Report.html");
    expect(mocks.readCompiledPage).toHaveBeenCalledExactlyOnceWith("p1", "report.qmd");
    expect(mocks.saveFileBase64).toHaveBeenCalledExactlyOnceWith(
      "p1",
      "Report.html",
      Buffer.from("<html></html>").toString("base64"),
    );
    expect(mocks.pdfSyncNoteSaved).toHaveBeenCalledExactlyOnceWith("p1", "Report.html");
  });

  it("stops before writing when the page cannot be read", async () => {
    mocks.readCompiledPage.mockRejectedValue("notebook.no_html_output");
    await expect(saveWebPage("p1", "report.qmd", "Report.html")).rejects.toBe("notebook.no_html_output");
    expect(mocks.saveFileBase64).not.toHaveBeenCalled();
    expect(mocks.pdfSyncNoteSaved).not.toHaveBeenCalled();
  });
});
