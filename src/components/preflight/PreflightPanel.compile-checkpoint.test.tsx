// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckId, PreflightReport } from "@oleafly/preflight";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreflightStore } from "@/store/preflight";
import { PreflightPanel } from "./PreflightPanel";

const paper =
  "\\documentclass{article}\\section{Introduction}\\section{Methods}";
const resume =
  "\\documentclass{article}\\section{Experience}\\section{GitHub Projects}";

const allFlags = (value: boolean) =>
  Object.fromEntries(
    ["ats", "compile", "a11y", "refs", "submission", "privacy"].map(
      (id) => [id, value],
    ),
  ) as Record<CheckId, boolean>;

beforeEach(() => {
  usePreflightStore.getState().reset();
  useCompileStore.getState().reset();
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.tex",
    activePath: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    files: { "main.tex": { content: paper, dirty: false } },
  });
});

describe("Preflight document suggestion checkpoint", () => {
  it("exposes the publication-grade check set and profile selector", () => {
    render(<PreflightPanel />);
    expect(screen.getByText("Compile & layout")).toBeInTheDocument();
    expect(screen.getByText("Submission readiness")).toBeInTheDocument();
    expect(screen.getByText("Privacy & blind review")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Submission readiness"));
    expect(screen.getByText("Publication profile")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("General publication");
  });

  it("opens the reader extraction from the panel header", () => {
    usePreflightStore.setState({ pageText: ["Title\nFirst page", "Methods\nSecond page"] });
    render(<PreflightPanel />);

    const readerButton = screen.getByRole("button", { name: "Show what the reader sees" });
    expect(readerButton).toBeEnabled();
    fireEvent.click(readerButton);

    expect(screen.getByRole("dialog", { name: "What the reader sees" })).toBeInTheDocument();
    expect(screen.getByLabelText("Extracted text from page 1")).toHaveTextContent("Title First page");
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(screen.getByLabelText("Extracted text from page 2")).toHaveTextContent("Methods Second page");
  });

  it("explains each preflight check in the help popover", () => {
    render(<PreflightPanel />);
    fireEvent.click(screen.getByRole("button", { name: "About Preflight" }));

    expect(screen.getByText("What Preflight checks")).toBeInTheDocument();
    expect(screen.getByText(/Compile & layout:/)).toBeInTheDocument();
    expect(screen.getByText(/Submission readiness:/)).toBeInTheDocument();
    expect(screen.getByText(/Privacy & blind review:/)).toBeInTheDocument();
  });

  it("ignores edits and failed compile state, then refreshes on successful lastCompiledAt", async () => {
    render(<PreflightPanel />);
    const ats = screen.getByLabelText("Enable ATS readiness");
    expect(ats).toHaveAttribute("aria-checked", "false");

    // Editing the source alone intentionally does not make this large panel run
    // document detection on every keystroke.
    act(() => {
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: resume, dirty: true },
        },
      }));
    });
    // A failed compile changes status/log but must not publish a success
    // checkpoint, so the suggestion remains the prior paper suggestion.
    act(() => {
      useCompileStore.setState({ status: "error", log: "compile failed" });
      // Even an unrelated Preflight store update may re-render the panel; the
      // suggestion remains memoized until a success checkpoint changes.
      usePreflightStore.setState({ running: true });
    });
    expect(ats).toHaveAttribute("aria-checked", "false");

    act(() => {
      useCompileStore.setState({ status: "success", lastCompiledAt: 1 });
    });
    expect(await screen.findByLabelText("Enable ATS readiness")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("renders verified source and output findings with honest coverage states", () => {
    const report: PreflightReport = {
      findings: [
        {
          id: "reference-source",
          lens: "refs",
          severity: "warning",
          title: "Undefined citation",
          detail: "The bibliography key is missing.",
          file: "main.tex",
          from: 4,
          to: 8,
        },
        {
          id: "pdf-reference-output",
          lens: "refs",
          severity: "error",
          title: "Reference rendered as a placeholder",
          detail: "The current PDF contains an unresolved marker.",
          page: 1,
        },
      ],
      scores: {
        ats: 0,
        compile: 0,
        a11y: 68,
        refs: 72,
        submission: 100,
        privacy: 0,
      },
      atsScore: null,
      compileScore: null,
      a11yScore: 68,
      refsScore: 72,
      submissionScore: 100,
      privacyScore: null,
      coverage: {
        ats: "not_run",
        compile: "not_run",
        a11y: "partial",
        refs: "evaluated",
        submission: "evaluated",
        privacy: "unsupported",
      },
      ranAt: 1,
      hasPdf: false,
    };
    usePreflightStore.setState({
      report,
      enabled: allFlags(true),
      open: allFlags(true),
      ran: allFlags(true),
    });

    render(<PreflightPanel />);

    expect(screen.getByText("Project & source")).toBeInTheDocument();
    expect(screen.getByText("Compiled output")).toBeInTheDocument();
    expect(screen.getByText("Undefined citation")).toBeInTheDocument();
    expect(
      screen.getByText("Reference rendered as a placeholder"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Compile the project first/)).toBeInTheDocument();
    expect(screen.getAllByText(/PDF required/)).toHaveLength(2);
    expect(screen.getByText(/Source checks completed/)).toBeInTheDocument();
    expect(screen.getByText(/Source checks for this engine/)).toBeInTheDocument();
    expect(screen.getByText("No problems found.")).toBeInTheDocument();
  });

  it("runs one check or the complete enabled set and persists the expanded state", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    usePreflightStore.setState({
      enabled: allFlags(true),
      open: allFlags(false),
      ran: allFlags(false),
      run,
    });
    render(<PreflightPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Run Compile & layout" }));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(usePreflightStore.getState().ran.compile).toBe(true);
    expect(usePreflightStore.getState().open?.compile).toBe(true);

    fireEvent.click(screen.getByText("Run 6 enabled checks"));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(Object.values(usePreflightStore.getState().ran)).toEqual(
      Array(6).fill(true),
    );

    fireEvent.click(screen.getByLabelText("Enable ATS readiness"));
    expect(usePreflightStore.getState().enabled?.ats).toBe(false);
  });
});
