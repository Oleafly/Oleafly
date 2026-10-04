// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { simulateAtsParse, type CheckId, type Finding, type PreflightReport } from "@oleafly/preflight";
import enPreflight from "@/i18n/locales/en/preflight.json" with { type: "json" };

const ask = vi.hoisted(() => ({
  askAiAboutFinding: vi.fn(async () => {}),
  askAiAboutFindings: vi.fn(async () => {}),
}));

vi.mock("@/features/ask-ai-preflight", () => ask);

import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreflightStore } from "@/store/preflight";
import { PreflightPanel } from "./PreflightPanel";

const flags = (value: boolean) =>
  Object.fromEntries(
    ["ats", "compile", "a11y", "refs", "submission", "privacy"].map((id) => [id, value]),
  ) as Record<CheckId, boolean>;

const only = (id: CheckId) => ({ ...flags(false), [id]: true });

function finding(id: string, lens: CheckId, severity: Finding["severity"], from: number): Finding {
  return {
    id,
    lens,
    severity,
    title: { key: "rules.refs-undefined-cite.title", params: { key: `cite${from}` } },
    detail: { key: "rules.refs-undefined-cite.detail" },
    file: "main.tex",
    from,
    to: from + 4,
  };
}

function report(overrides: Partial<PreflightReport> = {}): PreflightReport {
  return {
    findings: [],
    scores: { ats: 90, compile: 70, a11y: 40, refs: 100, submission: 100, privacy: 100 },
    atsScore: 90,
    compileScore: 70,
    a11yScore: 40,
    refsScore: 100,
    submissionScore: 100,
    privacyScore: 100,
    coverage: {
      ats: "evaluated",
      compile: "evaluated",
      a11y: "evaluated",
      refs: "evaluated",
      submission: "evaluated",
      privacy: "evaluated",
    },
    ranAt: 1,
    hasPdf: true,
    ...overrides,
  };
}

function show(id: CheckId, value: PreflightReport) {
  usePreflightStore.setState({
    report: value,
    enabled: only(id),
    open: only(id),
    ran: only(id),
  });
  render(<PreflightPanel />);
}

beforeEach(() => {
  usePreflightStore.getState().reset();
  useCompileStore.getState().reset();
  ask.askAiAboutFinding.mockClear();
  ask.askAiAboutFindings.mockClear();
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.tex",
    activePath: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    files: { "main.tex": { content: "\\documentclass{article}", dirty: false } },
  });
});

describe("Preflight check results", () => {
  it("summarises PDF/UA coverage with its caveat once a PDF was checked", () => {
    show(
      "a11y",
      report({
        pdfUa: { total: 12, covered: 12, passed: 9, failed: [], unavailable: [], outcomes: {} },
      }),
    );

    expect(
      screen.getByText(
        enPreflight.standards.coverage.replace("{{passed}}", "9").replace("{{total}}", "12"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(enPreflight.panel.standardsCaveat)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /40/ })).toBeInTheDocument();
  });

  it("leaves the coverage summary out when the PDF/UA rules did not run", () => {
    show("a11y", report());

    expect(screen.queryByText(enPreflight.panel.standardsCaveat)).toBeNull();
  });

  it("shows what a parser extracted from a resume", () => {
    show(
      "ats",
      report({
        atsParse: simulateAtsParse(
          ["Jane Doe", "jane@example.com", "https://github.com/jane", "Experience", "Education"].join("\n"),
        ),
      }),
    );

    expect(screen.getByText(enPreflight.atsCard.title)).toBeInTheDocument();
    expect(screen.getByTestId("ats-section-experience")).toHaveAttribute("data-present", "true");
  });

  it("asks the assistant about one finding or every fixable finding", () => {
    show(
      "refs",
      report({
        findings: [
          finding("refs-a", "refs", "error", 4),
          finding("refs-b", "refs", "warning", 20),
          finding("refs-c", "refs", "info", 40),
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Fix all 2 with AI" }));
    expect(ask.askAiAboutFindings).toHaveBeenCalledWith([
      expect.objectContaining({ id: "refs-a" }),
      expect.objectContaining({ id: "refs-b" }),
    ]);
  });

  it("explains that an engine without source checks relies on the PDF", () => {
    useFilesStore.setState({
      engine: {
        ...LATEX_ENGINE,
        label: "Markdown",
        capabilities: { ...LATEX_ENGINE.capabilities, source_preflight_profile: "none" },
      },
    });
    usePreflightStore.setState({ enabled: flags(true), open: flags(true), ran: flags(false) });
    render(<PreflightPanel />);

    expect(
      screen.getAllByText(enPreflight.panel.engineUnsupported.replace("{{engine}}", "Markdown")),
    ).toHaveLength(5);
  });

  it("reports a failed run", () => {
    usePreflightStore.setState({ error: "pdf unreadable" });
    render(<PreflightPanel />);

    expect(screen.getByText("Preflight failed: pdf unreadable")).toBeInTheDocument();
  });

  it("collapses and expands a check from its chevron", () => {
    usePreflightStore.setState({ enabled: only("refs"), open: only("refs"), ran: flags(false) });
    render(<PreflightPanel />);

    fireEvent.click(screen.getAllByRole("button", { name: enPreflight.panel.collapse })[0]);
    expect(usePreflightStore.getState().open?.refs).toBe(false);
    expect(screen.queryAllByRole("button", { name: enPreflight.panel.collapse })).toHaveLength(0);

    fireEvent.click(screen.getAllByRole("button", { name: enPreflight.panel.expand })[4]);
    expect(usePreflightStore.getState().open?.refs).toBe(true);
  });

  it("switches the publication profile", async () => {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => {};
    Element.prototype.scrollIntoView ??= () => {};
    const user = userEvent.setup();
    usePreflightStore.setState({ enabled: only("submission"), open: only("submission"), ran: flags(false) });
    render(<PreflightPanel />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: enPreflight.profiles.ieee.label }));

    expect(usePreflightStore.getState().submissionProfile).toBe("ieee");
    expect(screen.getByText(enPreflight.profiles.ieee.description)).toBeInTheDocument();
  });

  it("keeps the anonymous review toggle in the privacy check", () => {
    usePreflightStore.setState({ enabled: only("privacy"), open: only("privacy"), ran: flags(false) });
    render(<PreflightPanel />);

    const before = usePreflightStore.getState().anonymousReview;
    fireEvent.click(screen.getByRole("switch", { name: enPreflight.panel.anonymousReviewToggle }));

    expect(usePreflightStore.getState().anonymousReview).toBe(!before);
  });
});

describe("finding rows", () => {
  it("asks the assistant about a single finding", () => {
    show("refs", report({ findings: [finding("refs-a", "refs", "error", 4)] }));
    expect(screen.queryByRole("button", { name: /Fix all/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /cite4/ }));
    fireEvent.click(screen.getByRole("button", { name: enPreflight.finding.fixWithAi }));

    expect(ask.askAiAboutFinding).toHaveBeenCalledWith(expect.objectContaining({ id: "refs-a" }));
  });
});

describe("score ring", () => {
  it("names the readiness score for each band and marks unevaluated checks", () => {
    show(
      "compile",
      report({ scores: { ats: 0, compile: 70, a11y: 0, refs: 0, submission: 0, privacy: 0 } }),
    );
    expect(screen.getByRole("img", { name: /70/ })).toBeInTheDocument();
  });
});
