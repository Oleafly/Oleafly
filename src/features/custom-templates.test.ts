import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readCompiledPdf: vi.fn(),
  saveProjectAsTemplate: vi.fn(),
  pdfPageToPng: vi.fn(),
  success: vi.fn(),
  logError: vi.fn(async () => {}),
  openTemplateInNewProject: vi.fn(),
  saveAllDirty: vi.fn(async () => {}),
  projectId: null as string | null,
}));

vi.mock("@/lib/tauri", () => ({
  readCompiledPdf: mocks.readCompiledPdf,
  saveProjectAsTemplate: mocks.saveProjectAsTemplate,
}));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/store/template-request", () => ({
  openTemplateInNewProject: mocks.openTemplateInNewProject,
}));
vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({ projectId: mocks.projectId, saveAllDirty: mocks.saveAllDirty }),
  },
}));

import {
  announceSavedTemplate,
  firstPagePng,
  projectPreviewPng,
  saveProjectTemplate,
  templateNameFromPath,
} from "./custom-templates";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectId = null;
  mocks.readCompiledPdf.mockResolvedValue(new ArrayBuffer(4));
  mocks.pdfPageToPng.mockResolvedValue("data:image/png;base64,QUJD");
  mocks.saveProjectAsTemplate.mockResolvedValue("tpl-1");
});

describe("custom templates", () => {
  it.each([
    ["/tmp/Lab Thesis.zip", "Lab Thesis"],
    ["/tmp/report.ZIP", "report"],
    ["C:\\Users\\ada\\Thesis Template\\", "Thesis Template"],
    ["/home/ada/beamer-theme/", "beamer-theme"],
  ])("names %s after its file or folder", (path, name) => {
    expect(templateNameFromPath(path)).toBe(name);
  });

  it("draws the first page and gives up quietly when it can't", async () => {
    await expect(firstPagePng(new ArrayBuffer(4))).resolves.toBe("data:image/png;base64,QUJD");
    expect(mocks.pdfPageToPng).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      1,
      1.5,
      "#ffffff",
      { overallTimeoutMs: 15_000 },
    );
    mocks.pdfPageToPng.mockRejectedValueOnce(new Error("worker wedged"));
    await expect(firstPagePng(new ArrayBuffer(4))).resolves.toBeNull();
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("has no project preview before a compile", async () => {
    mocks.readCompiledPdf.mockRejectedValueOnce("no compiled PDF");
    await expect(projectPreviewPng("p1")).resolves.toBeNull();
    expect(mocks.pdfPageToPng).not.toHaveBeenCalled();
  });

  it("writes the open project's edits before saving it with its preview", async () => {
    mocks.projectId = "p1";
    await expect(saveProjectTemplate("p1", "Paper")).resolves.toBe("tpl-1");
    expect(mocks.saveAllDirty).toHaveBeenCalledOnce();
    expect(mocks.saveProjectAsTemplate).toHaveBeenCalledWith(
      "p1",
      "Paper",
      "data:image/png;base64,QUJD",
    );

    mocks.readCompiledPdf.mockRejectedValueOnce("no compiled PDF");
    await saveProjectTemplate("p2", "Other");
    expect(mocks.saveAllDirty).toHaveBeenCalledOnce();
    expect(mocks.saveProjectAsTemplate).toHaveBeenLastCalledWith("p2", "Other", null);
  });

  it("announces a saved template with a shortcut that opens it", () => {
    announceSavedTemplate("tpl-1", "Paper");
    expect(mocks.success).toHaveBeenCalledWith(
      'Saved "Paper" to your templates',
      expect.objectContaining({ label: "Use template" }),
    );
    const action = mocks.success.mock.calls[0][1] as { onClick: () => void };
    action.onClick();
    expect(mocks.openTemplateInNewProject).toHaveBeenCalledWith("tpl-1");
  });
});
