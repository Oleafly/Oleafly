import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { strFromU8, unzipSync, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { useToastStore } from "@/store/toast";
import { useImportStore } from "@/store/import";

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  createProjectFromPdfConversion: vi.fn(),
  createProjectFromDocx: vi.fn(),
  writeBytesFile: vi.fn(),
  pickSavePath: vi.fn(),
  ensurePandoc: vi.fn(),
  refreshProjects: vi.fn(),
  openProject: vi.fn(),
  files: { projectId: null as string | null },
}));

vi.mock("@/lib/log", () => ({
  logError: mocks.logError,
}));
vi.mock("@/lib/tauri", () => ({
  createProjectFromPdfConversion: mocks.createProjectFromPdfConversion,
  createProjectFromDocx: mocks.createProjectFromDocx,
  hasPandoc: vi.fn(async () => true),
  writeBytesFile: mocks.writeBytesFile,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({
      projectId: mocks.files.projectId,
      refreshProjects: mocks.refreshProjects,
      openProject: mocks.openProject,
    }),
  },
}));

import {
  baseName,
  createZipDownloader,
  dataUrlToBase64,
  createProjectFromConversion,
  downloadFigure,
  downloadTex,
  handleDownloadZipClick,
  handlePickedFile,
  zipEntries,
  type ZipDownloadDependencies,
} from "./import";

const tex = "\\documentclass{article}\nRésumé — π";

function makeZipDependencies(
  overrides: Partial<ZipDownloadDependencies> = {},
): ZipDownloadDependencies {
  return {
    getSnapshot: () => ({
      fileName: "Résumé.pdf",
      result: {
        tex,
        report: {
          pages: 1,
          headings: 1,
          paragraphs: 1,
          equations: 0,
          figures: 1,
          likelyScanned: false,
          notes: [],
        },
      },
      figures: [
        {
          name: "figure_p1_1.png",
          page: 1,
          pngDataUrl: "data:image/png;base64,AAAA",
        },
      ],
    }),
    pickDestination: vi.fn(async () => "/exports/Résumé.zip"),
    loadZipModule: vi.fn(async () => ({ zipSync })),
    writeBytes: vi.fn(async () => {}),
    ...overrides,
  };
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) =>
    character.charCodeAt(0),
  );
}

function openSucceeds(): void {
  mocks.openProject.mockImplementation(async (id: string) => {
    mocks.files.projectId = id;
  });
}

function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

function loadConversion(): void {
  useImportStore.setState({
    open: true,
    fileName: "Source.pdf",
    result: makeZipDependencies().getSnapshot().result,
    figures: makeZipDependencies().getSnapshot().figures,
  });
}

beforeEach(() => {
  mocks.logError.mockReset();
  mocks.createProjectFromPdfConversion.mockReset().mockResolvedValue("converted-project");
  mocks.createProjectFromDocx.mockReset().mockResolvedValue("docx-project");
  mocks.writeBytesFile.mockReset().mockResolvedValue(undefined);
  mocks.pickSavePath.mockReset().mockResolvedValue("/exports/out");
  mocks.ensurePandoc.mockReset().mockResolvedValue(true);
  mocks.refreshProjects.mockReset().mockResolvedValue(undefined);
  mocks.openProject.mockReset();
  mocks.files.projectId = null;
  openSucceeds();
  useToastStore.getState().reset();
  useImportStore.getState().close();
});

describe("converted project publication", () => {
  it("sends the complete conversion to one transactional backend command and lets the opened project confirm it", async () => {
    loadConversion();

    await expect(createProjectFromConversion()).resolves.toBe(true);

    expect(mocks.createProjectFromPdfConversion).toHaveBeenCalledWith(
      "Source",
      tex,
      [{ name: "figure_p1_1.png", dataBase64: "AAAA" }],
    );
    expect(mocks.refreshProjects).toHaveBeenCalledOnce();
    expect(useImportStore.getState().open).toBe(false);
    expect(mocks.openProject).toHaveBeenCalledWith("converted-project");
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("keeps the conversion open and reports failure from the catalog when publication rejects", async () => {
    const error = new Error("disk full");
    mocks.createProjectFromPdfConversion.mockRejectedValue(error);
    loadConversion();

    await expect(createProjectFromConversion()).resolves.toBe(false);

    expect(useImportStore.getState().open).toBe(true);
    expect(mocks.refreshProjects).not.toHaveBeenCalled();
    expect(mocks.openProject).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("import", error);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        kind: "error",
        message: i18n.t(($) => $.library.newProject.createFailed),
      }),
    ]);
    expect(toastMessages().join(" ")).not.toContain("disk full");
  });

  it("creates one project when Create project is triggered twice before the first run ends", async () => {
    let finish!: (id: string) => void;
    mocks.createProjectFromPdfConversion.mockReturnValue(
      new Promise<string>((resolve) => { finish = resolve; }),
    );
    loadConversion();

    const first = createProjectFromConversion();
    const second = createProjectFromConversion();
    expect(second).toBe(first);
    finish("converted-project");
    await expect(first).resolves.toBe(true);

    expect(mocks.createProjectFromPdfConversion).toHaveBeenCalledOnce();
    expect(mocks.openProject).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("still opens the created project when refreshing the list fails", async () => {
    const error = new Error("list failed");
    mocks.refreshProjects.mockRejectedValue(error);
    loadConversion();

    await expect(createProjectFromConversion()).resolves.toBe(true);

    expect(mocks.logError).toHaveBeenCalledWith("refresh projects after PDF import", error);
    expect(mocks.openProject).toHaveBeenCalledWith("converted-project");
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("reports that nothing opened when the open was blocked", async () => {
    mocks.openProject.mockResolvedValue(undefined);
    loadConversion();

    await expect(createProjectFromConversion()).resolves.toBe(false);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

describe("picked file import", () => {
  it("shows the conversion notice once, under a stable key, after a DOCX project opens", async () => {
    await handlePickedFile(new File(["docx"], "Draft.docx"));
    await handlePickedFile(new File(["docx"], "Draft.docx"));

    expect(mocks.ensurePandoc).toHaveBeenCalledWith({ notify: true });
    expect(mocks.openProject).toHaveBeenCalledWith("docx-project");
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        key: "import-conversion",
        kind: "info",
        message: i18n.t(($) => $.core.import.conversionNotice, { format: "LaTeX" }),
      }),
    ]);
  });

  it("skips the conversion notice when the new project did not open", async () => {
    mocks.openProject.mockResolvedValue(undefined);

    await handlePickedFile(new File(["docx"], "Draft.docx"));

    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("stops quietly when pandoc setup reported its own failure", async () => {
    mocks.ensurePandoc.mockResolvedValue(false);

    await handlePickedFile(new File(["docx"], "Draft.docx"));

    expect(mocks.createProjectFromDocx).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("reports a failed import with catalog text instead of the raw error", async () => {
    const error = new Error("Error: backend exploded");
    mocks.createProjectFromDocx.mockRejectedValue(error);

    await handlePickedFile(new File(["docx"], "Draft.docx"));

    expect(mocks.logError).toHaveBeenCalledWith("import", error);
    expect(toastMessages()).toEqual([i18n.t(($) => $.core.project.importFailed)]);
  });
});

describe("converted file downloads", () => {
  it("reports a failed .tex save instead of rejecting silently", async () => {
    loadConversion();
    const error = new Error("read-only volume");
    mocks.writeBytesFile.mockRejectedValue(error);

    await expect(downloadTex()).resolves.toBeUndefined();

    expect(mocks.logError).toHaveBeenCalledWith("save converted tex", error);
    expect(toastMessages()).toEqual([i18n.t(($) => $.researchTools.converter.saveFailed)]);
  });

  it("confirms a saved .tex once", async () => {
    loadConversion();

    await downloadTex();

    expect(toastMessages()).toEqual([enCore.import.texSaved]);
  });

  it("reports a failed figure save instead of rejecting silently", async () => {
    const error = new Error("read-only volume");
    mocks.writeBytesFile.mockRejectedValue(error);

    await expect(
      downloadFigure({ name: "figure_p1_1.png", page: 1, pngDataUrl: "data:image/png;base64,AAAA" }),
    ).resolves.toBeUndefined();

    expect(mocks.logError).toHaveBeenCalledWith("save extracted figure", error);
    expect(toastMessages()).toEqual([i18n.t(($) => $.researchTools.converter.saveFailed)]);
  });
});

describe("baseName", () => {
  it("strips extension and directories", () => {
    expect(baseName("My Paper.final.pdf")).toBe("My Paper.final");
    expect(baseName("report.docx")).toBe("report");
    expect(baseName("dir/sub/report.pdf")).toBe("report");
  });

  it("keeps extensionless names", () => {
    expect(baseName("notes")).toBe("notes");
  });
});

describe("dataUrlToBase64", () => {
  it("strips the data url prefix", () => {
    expect(dataUrlToBase64("data:image/png;base64,AAAA")).toBe("AAAA");
  });
});

describe("zipEntries", () => {
  it("bundles UTF-8 main.tex and figures under assets/", () => {
    const entries = zipEntries(tex, [
      { name: "figure_p1_1.png", page: 1, pngDataUrl: "data:image/png;base64,AAAA" },
    ]);
    expect(Object.keys(entries)).toEqual(["main.tex", "assets/figure_p1_1.png"]);
    expect(entries["assets/figure_p1_1.png"]).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(entries["main.tex"])).toBe(tex);
  });
});

describe("ZIP download", () => {
  it("writes the exact chosen location with a valid archive and expected entries", async () => {
    const dependencies = makeZipDependencies();
    const download = createZipDownloader(dependencies);

    await expect(download()).resolves.toBe("saved");

    expect(dependencies.pickDestination).toHaveBeenCalledWith({
      defaultPath: "Résumé.zip",
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    expect(dependencies.loadZipModule).toHaveBeenCalledOnce();
    expect(dependencies.writeBytes).toHaveBeenCalledOnce();
    const [destination, base64Archive] = vi.mocked(
      dependencies.writeBytes,
    ).mock.calls[0];
    expect(destination).toBe("/exports/Résumé.zip");

    const archive = decodeBase64(base64Archive);
    expect(Array.from(archive.subarray(0, 4))).toEqual([
      0x50, 0x4b, 0x03, 0x04,
    ]);
    const entries = unzipSync(archive);
    expect(Object.keys(entries).sort()).toEqual([
      "assets/figure_p1_1.png",
      "main.tex",
    ]);
    expect(strFromU8(entries["main.tex"])).toBe(tex);
    expect(Array.from(entries["assets/figure_p1_1.png"])).toEqual([0, 0, 0]);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ kind: "success", message: enCore.import.zipSaved }),
    ]);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("stops after picker cancellation without loading compression code", async () => {
    const dependencies = makeZipDependencies({
      pickDestination: vi.fn(async () => null),
    });

    await expect(createZipDownloader(dependencies)()).resolves.toBe(
      "cancelled",
    );

    expect(dependencies.loadZipModule).not.toHaveBeenCalled();
    expect(dependencies.writeBytes).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("reports a dynamic compression-module import failure without writing", async () => {
    const error = new Error("chunk unavailable");
    const dependencies = makeZipDependencies({
      loadZipModule: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(createZipDownloader(dependencies)()).resolves.toBe("failed");

    expect(dependencies.writeBytes).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("ZIP export", error);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        kind: "error",
        message: "Could not save ZIP archive.",
      }),
    ]);
  });

  it("reports compression failure without creating archive bytes", async () => {
    const error = new Error("compression failed");
    const zip = vi.fn((): Uint8Array => {
      throw error;
    });
    const dependencies = makeZipDependencies({
      loadZipModule: vi.fn(async () => ({ zipSync: zip })),
    });

    await expect(createZipDownloader(dependencies)()).resolves.toBe("failed");

    expect(zip).toHaveBeenCalledOnce();
    expect(dependencies.writeBytes).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("ZIP export", error);
    expect(
      useToastStore.getState().toasts.some((toast) => toast.kind === "success"),
    ).toBe(false);
  });

  it("rejects invalid compressor output before touching the destination", async () => {
    const dependencies = makeZipDependencies({
      loadZipModule: vi.fn(async () => ({
        zipSync: () => new Uint8Array([0, 1, 2, 3]),
      })),
    });

    await expect(createZipDownloader(dependencies)()).resolves.toBe("failed");

    expect(dependencies.writeBytes).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith(
      "ZIP export",
      expect.objectContaining({
        message: "ZIP compression returned invalid archive data.",
      }),
    );
  });

  it("reports a filesystem write failure and never reports false success", async () => {
    const error = new Error("disk full");
    const dependencies = makeZipDependencies({
      writeBytes: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(createZipDownloader(dependencies)()).resolves.toBe("failed");

    expect(dependencies.writeBytes).toHaveBeenCalledOnce();
    expect(mocks.logError).toHaveBeenCalledWith("ZIP export", error);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        kind: "error",
        message: "Could not save ZIP archive.",
      }),
    ]);
  });

  it("contains an unexpected caller rejection and surfaces the standard error UX", async () => {
    const error = new Error("unexpected rejection");

    await expect(
      handleDownloadZipClick(() => Promise.reject(error)),
    ).resolves.toBeUndefined();

    expect(mocks.logError).toHaveBeenCalledWith("ZIP export", error);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        kind: "error",
        message: "Could not save ZIP archive.",
      }),
    ]);
  });
});
