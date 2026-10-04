import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runLatexToTypstMigration: vi.fn(),
  ensureLoaded: vi.fn(),
  refreshProjects: vi.fn(),
}));

vi.mock("@/features/latex-to-typst-migration", () => ({
  runLatexToTypstMigration: mocks.runLatexToTypstMigration,
}));
vi.mock("@/store/typst-toolchain", () => ({
  useTypstToolchainStore: { getState: () => ({ ensureLoaded: mocks.ensureLoaded }) },
}));

import type { MigrationReport } from "@/features/latex-to-typst-migration";
import { useFilesStore } from "@/store/files";
import { useTypstMigrationStore } from "./typst-migration";

const report = {
  projectId: "typst-copy",
  projectName: "Paper (Typst)",
  mainFile: "main.typ",
  files: ["main.typ"],
} as unknown as MigrationReport;

beforeEach(() => {
  mocks.runLatexToTypstMigration.mockReset();
  mocks.ensureLoaded.mockReset().mockResolvedValue({ defaultVersion: "0.14.2" });
  mocks.refreshProjects.mockReset().mockResolvedValue(undefined);
  useTypstMigrationStore.setState({ open: false, phase: { kind: "idle" }, report: null });
  useFilesStore.setState({
    projectId: "latex-paper",
    mainDoc: "main.tex",
    files: {
      "main.tex": { content: "\\documentclass{article}", dirty: true },
      "refs.bib": { content: "@misc{a}", dirty: false },
      "appendix.LTX": { content: "\\section{A}", dirty: false },
    },
    refreshProjects: mocks.refreshProjects,
  });
});

describe("LaTeX to Typst migration store", () => {
  it("converts the open project with its unsaved LaTeX buffers and the default Typst version", async () => {
    mocks.runLatexToTypstMigration.mockImplementation(async (_request, _deps, onStep) => {
      onStep("converting");
      expect(useTypstMigrationStore.getState().phase).toEqual({ kind: "running", step: "converting" });
      return report;
    });

    await useTypstMigrationStore.getState().start("Paper (Typst)");

    const [request] = mocks.runLatexToTypstMigration.mock.calls[0];
    expect(request).toMatchObject({
      projectId: "latex-paper",
      mainDoc: "main.tex",
      name: "Paper (Typst)",
      typstVersion: "0.14.2",
    });
    expect([...request.buffers.keys()].sort()).toEqual(["appendix.LTX", "main.tex"]);
    expect(useTypstMigrationStore.getState()).toMatchObject({ phase: { kind: "done", report }, report });
    expect(mocks.refreshProjects).toHaveBeenCalled();
  });

  it("migrates without a pinned version when the toolchain cannot be read", async () => {
    mocks.ensureLoaded.mockRejectedValue(new Error("offline"));
    mocks.runLatexToTypstMigration.mockResolvedValue(report);

    await useTypstMigrationStore.getState().start("Copy");

    expect(mocks.runLatexToTypstMigration.mock.calls[0][0].typstVersion).toBeNull();
  });

  it("migrates without a pinned version when no default is installed", async () => {
    mocks.ensureLoaded.mockResolvedValue(null);
    mocks.runLatexToTypstMigration.mockResolvedValue(report);

    await useTypstMigrationStore.getState().start("Copy");

    expect(mocks.runLatexToTypstMigration.mock.calls[0][0].typstVersion).toBeNull();
  });

  it("reports a coded migration failure", async () => {
    mocks.runLatexToTypstMigration.mockRejectedValue(Object.assign(new Error("noMain"), { code: "noMain" }));

    await useTypstMigrationStore.getState().start("Copy");

    expect(useTypstMigrationStore.getState().phase).toEqual({ kind: "failed", code: "noMain", message: "noMain" });
  });

  it("reports an uncoded failure with its text", async () => {
    mocks.runLatexToTypstMigration.mockRejectedValue("pandoc crashed");

    await useTypstMigrationStore.getState().start("Copy");

    expect(useTypstMigrationStore.getState().phase).toEqual({
      kind: "failed",
      code: null,
      message: "pandoc crashed",
    });
  });

  it("does not start without a project or while a migration runs", async () => {
    useFilesStore.setState({ projectId: null });
    await useTypstMigrationStore.getState().start("Copy");

    useFilesStore.setState({ projectId: "latex-paper" });
    useTypstMigrationStore.setState({ phase: { kind: "running", step: "creating" } });
    await useTypstMigrationStore.getState().start("Copy");

    expect(mocks.runLatexToTypstMigration).not.toHaveBeenCalled();
  });

  it("opens on the start screen, or on the progress of a running migration", () => {
    useTypstMigrationStore.setState({ phase: { kind: "failed", code: null, message: "x" } });
    useTypstMigrationStore.getState().openDialog();
    expect(useTypstMigrationStore.getState()).toMatchObject({ open: true, phase: { kind: "idle" } });

    useTypstMigrationStore.getState().close();
    useTypstMigrationStore.setState({ phase: { kind: "running", step: "compiling" } });
    useTypstMigrationStore.getState().openDialog();
    expect(useTypstMigrationStore.getState()).toMatchObject({
      open: true,
      phase: { kind: "running", step: "compiling" },
    });
  });

  it("reopens the last report only when there is one", () => {
    useTypstMigrationStore.getState().showReport();
    expect(useTypstMigrationStore.getState().open).toBe(false);

    useTypstMigrationStore.setState({ report });
    useTypstMigrationStore.getState().showReport();
    expect(useTypstMigrationStore.getState()).toMatchObject({ open: true, phase: { kind: "done", report } });
  });
});
