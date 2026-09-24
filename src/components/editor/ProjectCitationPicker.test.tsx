// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  completions: vi.fn(),
  insertAtCursor: vi.fn(),
  wysiwygActive: vi.fn(() => false),
  wysiwygCurrent: vi.fn(() => true),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
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
vi.mock("@/components/editor/cm/controller", () => ({
  insertAtCursor: mocks.insertAtCursor,
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

import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { ProjectCitationPicker } from "./ProjectCitationPicker";

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
    expect(mocks.insertAtCursor).toHaveBeenCalledWith(String.raw`\cite{knuth1984}`);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("stays silent when the key left the project", () => {
    const row = renderPicker();
    mocks.current.mockReturnValue(snapshotWith("other"));
    fireEvent.click(row);
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("stays silent when no snapshot is accepted", () => {
    const row = renderPicker();
    mocks.current.mockReturnValue(null);
    fireEvent.click(row);
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("stays silent while visual mode analysis is pending", () => {
    const row = renderPicker();
    mocks.wysiwygActive.mockReturnValue(true);
    mocks.wysiwygCurrent.mockReturnValue(false);
    fireEvent.click(row);
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
