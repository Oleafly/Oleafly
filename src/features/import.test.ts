import { strFromU8, unzipSync, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/store/toast";
import { useImportStore } from "@/store/import";

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  createProjectFromPdfConversion: vi.fn(),
  refreshProjects: vi.fn(),
  openProject: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  logError: mocks.logError,
}));
vi.mock("@/lib/tauri", () => ({
  createProjectFromPdfConversion: mocks.createProjectFromPdfConversion,
  createProjectFromDocx: vi.fn(),
  hasPandoc: vi.fn(async () => true),
  writeBytesFile: vi.fn(async () => {}),
}));
vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({
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
  handleDownloadZipClick,
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

beforeEach(() => {
  mocks.logError.mockReset();
  mocks.createProjectFromPdfConversion.mockReset().mockResolvedValue("converted-project");
  mocks.refreshProjects.mockReset().mockResolvedValue(undefined);
  mocks.openProject.mockReset().mockResolvedValue(undefined);
  useToastStore.setState({ toasts: [] });
  useImportStore.getState().close();
});

describe("converted project publication", () => {
  it("sends the complete conversion to one transactional backend command", async () => {
    useImportStore.setState({
      open: true,
      fileName: "Source.pdf",
      result: makeZipDependencies().getSnapshot().result,
      figures: makeZipDependencies().getSnapshot().figures,
    });

    await createProjectFromConversion();

    expect(mocks.createProjectFromPdfConversion).toHaveBeenCalledWith(
      "Source",
      tex,
      [{ name: "figure_p1_1.png", dataBase64: "AAAA" }],
    );
    expect(mocks.refreshProjects).toHaveBeenCalledOnce();
    expect(useImportStore.getState().open).toBe(false);
    expect(mocks.openProject).toHaveBeenCalledWith("converted-project");
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        kind: "success",
        message: expect.stringContaining("Project created from PDF"),
      }),
    ]);
  });

  it("keeps the conversion open and reports failure when publication rejects", async () => {
    const error = new Error("disk full");
    mocks.createProjectFromPdfConversion.mockRejectedValue(error);
    useImportStore.setState({
      open: true,
      fileName: "Source.pdf",
      result: makeZipDependencies().getSnapshot().result,
      figures: makeZipDependencies().getSnapshot().figures,
    });

    await createProjectFromConversion();

    expect(useImportStore.getState().open).toBe(true);
    expect(mocks.refreshProjects).not.toHaveBeenCalled();
    expect(mocks.openProject).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("import", error);
    expect(
      useToastStore.getState().toasts.some((item) => item.kind === "success"),
    ).toBe(false);
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
      expect.objectContaining({ kind: "success", message: "Saved .zip" }),
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
