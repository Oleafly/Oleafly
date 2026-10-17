// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  completions: vi.fn(),
  insertCitationKey: vi.fn(),
  wysiwygActive: vi.fn(() => false),
  wysiwygCurrent: vi.fn(() => true),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  insertTypstCitation: vi.fn(async () => {}),
}));

vi.mock("@/components/editor/typst-commands", () => ({
  insertTypstCitation: mocks.insertTypstCitation,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@/lib/project-intelligence/current", () => ({
  currentProjectIntelligence: mocks.current,
}));
vi.mock("@/lib/project-intelligence/selectors", () => ({
  citationCompletions: mocks.completions,
}));
vi.mock("@/features/cite-insert", () => ({
  insertCitationKey: mocks.insertCitationKey,
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  isWysiwygActive: () => mocks.wysiwygActive(),
  getWysiwygProjectIntelligenceCurrent: () => mocks.wysiwygCurrent(),
  subscribeWysiwygProjectIntelligence: () => () => {},
}));
vi.mock("@/lib/toast", () => ({
  toast: { info: mocks.info, error: mocks.error, success: mocks.success },
  notifyError: vi.fn(),
}));

import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useCitationStore } from "@/store/citation";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { ProjectCitationPicker } from "./ProjectCitationPicker";

const citations = en.citations;

function setAnalysis(state: Record<string, unknown>) {
  useIndexStore.setState({
    intelligenceState: { status: "success", identity: null, data: null, stale: false, ...state },
  } as never);
}

const KNUTH = {
  id: "refs.bib#knuth",
  key: "knuth1984",
  label: "knuth1984",
  detail: "book",
  type: "book",
  location: {
    file: "refs.bib",
    range: { from: 0, to: 10, startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
  },
  duplicate: false,
  duplicateIndex: 0,
  duplicateCount: 1,
};

function snapshotWith(...keys: string[]) {
  return {
    snapshot: {
      status: "success",
      bibliography: {
        entries: keys.map((key, index) => ({ id: `entry-${index}`, key })),
      },
    },
  };
}

function renderPicker() {
  render(<ProjectCitationPicker variant="menu" />);
  const row = screen.getByText(KNUTH.key).closest("button");
  if (!row) throw new Error("citation row missing");
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wysiwygActive.mockReturnValue(false);
  mocks.wysiwygCurrent.mockReturnValue(true);
  mocks.current.mockReturnValue(snapshotWith(KNUTH.key));
  mocks.completions.mockReturnValue([KNUTH]);
  useFilesStore.setState({
    projectId: "paper",
    activePath: "main.tex",
    files: { "main.tex": { content: "", dirty: false } },
  } as never);
  useIndexStore.setState({
    intelligenceState: {
      status: "success",
      identity: null,
      data: null,
      stale: false,
    },
  } as never);
});

describe("ProjectCitationPicker", () => {
  it("inserts a key that a newer snapshot still has", () => {
    const row = renderPicker();
    mocks.current.mockReturnValue(snapshotWith("other", KNUTH.key));
    fireEvent.click(row);
    expect(mocks.insertCitationKey).toHaveBeenCalledWith("knuth1984");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("stays silent when the key left the project", () => {
    const row = renderPicker();
    mocks.current.mockReturnValue(snapshotWith("other"));
    fireEvent.click(row);
    expect(mocks.insertCitationKey).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("stays silent when no snapshot is accepted", () => {
    const row = renderPicker();
    mocks.current.mockReturnValue(null);
    fireEvent.click(row);
    expect(mocks.insertCitationKey).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("stays silent while visual mode analysis is pending", () => {
    const row = renderPicker();
    mocks.wysiwygActive.mockReturnValue(true);
    mocks.wysiwygCurrent.mockReturnValue(false);
    fireEvent.click(row);
    expect(mocks.insertCitationKey).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("cites with Typst syntax in a Typst file, even inside a LaTeX project", () => {
    useFilesStore.setState({
      activePath: "notes.typ",
      files: { "notes.typ": { content: "", dirty: false } },
    } as never);
    const row = renderPicker();
    fireEvent.click(row);
    expect(mocks.insertTypstCitation).toHaveBeenCalledWith("knuth1984", "refs.bib");
    expect(mocks.insertCitationKey).not.toHaveBeenCalled();
  });

  it("cites Markdown entries through the shared caret insertion", () => {
    useFilesStore.setState({
      activePath: "README.md",
      files: { "README.md": { content: "", dirty: false } },
    } as never);
    fireEvent.click(renderPicker());
    expect(mocks.insertCitationKey).toHaveBeenCalledWith("knuth1984");
    expect(mocks.insertTypstCitation).not.toHaveBeenCalled();
  });

  it("marks duplicate keys with their position", () => {
    mocks.completions.mockReturnValue([{ ...KNUTH, duplicate: true, duplicateIndex: 1, duplicateCount: 3 }]);
    render(<ProjectCitationPicker variant="bar" />);
    expect(screen.getByText(citations.duplicate.replace("{{index}}", "2").replace("{{total}}", "3"))).toBeInTheDocument();
  });

  it("filters by the typed query and says when nothing matches", () => {
    render(<ProjectCitationPicker variant="menu" />);
    mocks.completions.mockReturnValue([]);
    fireEvent.change(screen.getByLabelText(citations.filterLabel), { target: { value: "zzz" } });
    expect(mocks.completions).toHaveBeenLastCalledWith(expect.anything(), "zzz", 80);
    expect(screen.getByText(citations.noMatches)).toBeInTheDocument();
  });

  it("shows a new search's results from the top of the list", () => {
    const list = renderPicker().closest(".overflow-y-auto") as HTMLElement;
    list.scrollTop = 240;

    fireEvent.change(screen.getByLabelText(citations.filterLabel), { target: { value: "knuth" } });

    expect(mocks.completions).toHaveBeenLastCalledWith(expect.anything(), "knuth", 80);
    expect(list.scrollTop).toBe(0);
  });

  it("says when the project has no bibliography entries", () => {
    mocks.completions.mockReturnValue([]);
    render(<ProjectCitationPicker variant="menu" />);
    expect(screen.getByText(citations.noEntries)).toBeInTheDocument();
  });

  it.each([
    [{ status: "running" }],
    [{ status: "not_run" }],
    [{ stale: true }],
  ])("shows progress while analysis is %o", (state) => {
    setAnalysis(state);
    render(<ProjectCitationPicker variant="menu" />);
    expect(screen.getByText(citations.updatingList)).toBeInTheDocument();
    expect(screen.queryByText(KNUTH.key)).not.toBeInTheDocument();
  });

  it("shows progress while the visual editor waits for analysis", () => {
    mocks.wysiwygActive.mockReturnValue(true);
    mocks.wysiwygCurrent.mockReturnValue(false);
    render(<ProjectCitationPicker variant="menu" />);
    expect(screen.getByText(citations.updatingList)).toBeInTheDocument();
  });

  it("explains a failed analysis", () => {
    setAnalysis({ status: "error", failure: { message: "Worker crashed" } });
    const { unmount } = render(<ProjectCitationPicker variant="menu" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Worker crashed");
    unmount();
    setAnalysis({ status: "unavailable" });
    render(<ProjectCitationPicker variant="menu" />);
    expect(screen.getByRole("alert")).toHaveTextContent(citations.unavailable);
  });

  it("warns that a partial catalog may miss entries", () => {
    setAnalysis({ status: "partial" });
    render(<ProjectCitationPicker variant="menu" />);
    expect(screen.getByText(citations.partialCatalog)).toBeInTheDocument();
  });

  it("opens the citation search to add a new entry", () => {
    useCitationStore.setState({ open: false });
    mocks.completions.mockReturnValue([]);
    render(<ProjectCitationPicker variant="menu" />);
    fireEvent.click(screen.getByText(citations.addNew));
    expect(useCitationStore.getState().open).toBe(true);
  });
});
