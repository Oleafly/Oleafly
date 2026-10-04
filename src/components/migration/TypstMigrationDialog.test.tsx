// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  openLocation: vi.fn(async () => true),
  openProject: vi.fn(async () => {}),
  refreshProjects: vi.fn(async () => {}),
}));

vi.mock("@/features/latex-to-typst-migration", () => ({
  runLatexToTypstMigration: mocks.run,
}));
vi.mock("@/store/typst-toolchain", () => ({
  useTypstToolchainStore: { getState: () => ({ ensureLoaded: async () => ({ defaultVersion: "0.15.1" }) }) },
}));
vi.mock("@/lib/open-location", () => ({ openProjectLocation: mocks.openLocation }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { MigrationReport } from "@/features/latex-to-typst-migration";
import { useFilesStore } from "@/store/files";
import { useTypstMigrationStore } from "@/store/typst-migration";
import { TypstMigrationDialog } from "./TypstMigrationDialog";

const copy = enShell.typstMigration;

const REPORT: MigrationReport = {
  projectId: "typst-project",
  projectName: "Thesis (Typst)",
  mainFile: "main.typ",
  files: ["main.typ", "chapters/one.typ", "refs.bib"],
  converted: {
    sources: [
      { source: "main.tex", target: "main.typ" },
      { source: "chapters/one.tex", target: "chapters/one.typ" },
    ],
    figures: 3,
    tables: 1,
    equations: 12,
    mathFixed: 2,
    references: 9,
    bibliographies: ["refs.bib"],
    copied: 4,
    style: "ieee",
  },
  attention: [
    { kind: "missingImage", detail: "figures/plot" },
    { kind: "pandoc", detail: String.raw`Skipped '\begin{tikzpicture}'`, source: { file: "chapters/one.tex", line: 30 } },
  ],
  compile: {
    ok: false,
    problems: [
      { severity: "error", message: "unknown variable: foo", file: "chapters/one.typ", line: 3 },
      { severity: "warning", message: "font fallback", file: null, line: null },
    ],
  },
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.run.mockReset();
  useFilesStore.setState({
    projectId: "latex-project",
    projectName: "Thesis",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    files: { "main.tex": { content: "\\begin{document}\\end{document}", dirty: true } },
    openProject: mocks.openProject,
    refreshProjects: mocks.refreshProjects,
  } as never);
  useTypstMigrationStore.setState({ open: true, phase: { kind: "idle" }, report: null });
});

describe("TypstMigrationDialog", () => {
  it("renders nothing while it is closed", () => {
    useTypstMigrationStore.setState({ open: false });
    const { container } = render(<TypstMigrationDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("converts the open LaTeX project into a new project and shows the report", async () => {
    mocks.run.mockImplementation(async (_request, _deps, onStep: (step: string) => void) => {
      onStep("converting");
      return REPORT;
    });
    render(<TypstMigrationDialog />);
    const user = userEvent.setup();
    const name = screen.getByLabelText(copy.nameLabel);
    expect(name).toHaveValue("Thesis (Typst)");
    expect(screen.getByText(copy.intro)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: copy.convert }));

    expect(await screen.findByTestId("typst-migration-report")).toBeInTheDocument();
    const [request] = mocks.run.mock.calls[0] as [Record<string, unknown>];
    expect(request).toMatchObject({ projectId: "latex-project", mainDoc: "main.tex", name: "Thesis (Typst)", typstVersion: "0.15.1" });
    expect((request.buffers as Map<string, string>).get("main.tex")).toBe("\\begin{document}\\end{document}");
    expect(screen.getByText("Created Thesis (Typst).")).toBeInTheDocument();
    expect(screen.getByText("It does not compile yet. 1 error needs a fix.")).toBeInTheDocument();
    expect(screen.getByText("3 figures")).toBeInTheDocument();
    expect(screen.getByText("2 formulas fixed by the math converter")).toBeInTheDocument();
    expect(screen.getByText("chapters/one.tex to chapters/one.typ")).toBeInTheDocument();
    expect(screen.getByText("The image figures/plot was not found.")).toBeInTheDocument();
    expect(screen.getByText("chapters/one.tex, line 30")).toBeInTheDocument();
    expect(useTypstMigrationStore.getState().report).toBe(REPORT);
    expect(mocks.refreshProjects).toHaveBeenCalled();
  });

  it("opens the new project at a compile error", async () => {
    useTypstMigrationStore.setState({ phase: { kind: "done", report: REPORT }, report: REPORT });
    render(<TypstMigrationDialog />);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: /font fallback/u })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Open chapters/one.typ at line 3" }));

    await waitFor(() => expect(mocks.openLocation).toHaveBeenCalledWith({ path: "chapters/one.typ", line: 3 }));
    expect(mocks.openProject).toHaveBeenCalledWith("typst-project");
    expect(useTypstMigrationStore.getState().open).toBe(false);
    expect(useTypstMigrationStore.getState().report).toBe(REPORT);
  });

  it("explains a failure and offers another try", async () => {
    mocks.run.mockRejectedValue(Object.assign(new Error("pandoc"), { code: "pandoc" }));
    render(<TypstMigrationDialog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.convert }));
    expect(await screen.findByText(copy.errors.pandoc)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.retry })).toBeEnabled();
  });

  it("only converts LaTeX projects", () => {
    useFilesStore.setState({
      engine: { ...LATEX_ENGINE, capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" } },
    });
    render(<TypstMigrationDialog />);
    expect(screen.getByText(copy.notLatex)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.convert })).toBeDisabled();
  });
});

describe("TypstMigrationDialog report details", () => {
  const note = (kind: MigrationReport["attention"][number]["kind"]) => ({ kind, detail: "x.tex" });

  it.each([
    ["missingInclude", copy.notes.missingInclude],
    ["lostInclude", copy.notes.lostInclude],
    ["unsupportedImage", copy.notes.unsupportedImage],
    ["math", copy.notes.math],
    ["bibliographyStyle", copy.notes.bibliographyStyle],
    ["skippedFile", copy.notes.skippedFile],
    ["unreadableFile", copy.notes.unreadableFile],
    ["equationLabel", copy.notes.equationLabel],
  ] as const)("explains a %s note", (kind, text) => {
    const report = { ...REPORT, attention: [note(kind)] };
    useTypstMigrationStore.setState({ phase: { kind: "done", report }, report });
    render(<TypstMigrationDialog />);

    expect(
      within(screen.getByTestId("typst-migration-attention")).getByText(text.replace("{{detail}}", "x.tex")),
    ).toBeInTheDocument();
  });

  it("reports a clean conversion without extra rows", () => {
    const report: MigrationReport = {
      ...REPORT,
      converted: { ...REPORT.converted, mathFixed: 0, style: null },
      attention: [],
      compile: { ok: true, problems: [] },
    };
    useTypstMigrationStore.setState({ phase: { kind: "done", report }, report });
    render(<TypstMigrationDialog />);

    expect(screen.getByText(copy.report.compiled)).toBeInTheDocument();
    expect(screen.getByText(copy.report.noAttention)).toBeInTheDocument();
    expect(screen.queryByText(/formulas fixed/)).toBeNull();
    expect(screen.queryByText(/Bibliography style/)).toBeNull();
    expect(screen.queryByTestId("typst-migration-problems")).toBeNull();
  });

  it("says when the new project could not be compiled at all", () => {
    const report: MigrationReport = { ...REPORT, compile: null, compileFailure: "typst missing" };
    useTypstMigrationStore.setState({ phase: { kind: "done", report }, report });
    render(<TypstMigrationDialog />);

    expect(screen.getByText("Oleafly could not compile it: typst missing")).toBeInTheDocument();
    expect(screen.queryByTestId("typst-migration-problems")).toBeNull();
  });

  it("opens the new project from the footer without jumping to a file", async () => {
    useTypstMigrationStore.setState({ phase: { kind: "done", report: REPORT }, report: REPORT });
    render(<TypstMigrationDialog />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.report.open }));

    await waitFor(() => expect(mocks.openProject).toHaveBeenCalledWith("typst-project"));
    expect(mocks.refreshProjects).toHaveBeenCalled();
    expect(mocks.openLocation).not.toHaveBeenCalled();
  });

  it("jumps straight to the file when the new project is already open", async () => {
    useFilesStore.setState({ projectId: "typst-project" });
    useTypstMigrationStore.setState({ phase: { kind: "done", report: REPORT }, report: REPORT });
    render(<TypstMigrationDialog />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open chapters/one.typ at line 3" }));

    await waitFor(() => expect(mocks.openLocation).toHaveBeenCalledWith({ path: "chapters/one.typ", line: 3 }));
    expect(mocks.openProject).not.toHaveBeenCalled();
  });
});

describe("TypstMigrationDialog progress and errors", () => {
  it.each([
    ["reading", copy.progress.reading],
    ["converting", copy.progress.converting],
    ["creating", copy.progress.creating],
    ["compiling", copy.progress.compiling],
  ] as const)("names the %s step while it runs", (step, label) => {
    useTypstMigrationStore.setState({ phase: { kind: "running", step } });
    render(<TypstMigrationDialog />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it.each([
    ["noMain", copy.errors.noMain],
    ["emptyOutput", copy.errors.emptyOutput],
    [null, copy.errors.failed.replace("{{detail}}", "disk full")],
  ] as const)("explains a %s failure", (code, text) => {
    useTypstMigrationStore.setState({ phase: { kind: "failed", code, message: "disk full" } });
    render(<TypstMigrationDialog />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("starts from the name field with Enter and needs a name", async () => {
    mocks.run.mockResolvedValue(REPORT);
    render(<TypstMigrationDialog />);
    const user = userEvent.setup();
    const name = screen.getByLabelText(copy.nameLabel);

    await user.clear(name);
    await user.type(name, "{Enter}");
    expect(mocks.run).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: copy.convert })).toBeDisabled();

    await user.type(name, "Paper (Typst){Enter}");

    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect((mocks.run.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({ name: "Paper (Typst)" });
  });

  it("falls back to the app name for an unnamed project", () => {
    useFilesStore.setState({ projectName: "" });
    render(<TypstMigrationDialog />);

    expect(screen.getByLabelText(copy.nameLabel)).toHaveValue(copy.defaultName.replace("{{name}}", "Oleafly"));
  });
});
