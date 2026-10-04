// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gotoLine: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@/components/editor/cm/controller", () => ({ gotoLine: mocks.gotoLine }));
vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: ({ oldText, newText, scrollToLine }: { oldText: string; newText: string; scrollToLine?: number }) => (
    <pre data-testid="inline-diff" data-scroll-line={scrollToLine}>{`${oldText} -> ${newText}`}</pre>
  ),
}));

import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import type { ToolApprovalRequest } from "@/lib/ai-tools";
import { useFilesStore } from "@/store/files";
import { firstChangedLine, ToolConfirm } from "./ToolConfirm";

const approval = enAi.approval;

const writeRequest = {
  tool: "write_file",
  summary: "Write chapters/intro.tex",
  diff: { path: "chapters/intro.tex", oldText: "a\nb\nc", newText: "a\nb\nC" },
} as ToolApprovalRequest;

const openFile = vi.fn(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.gotoLine.mockClear();
  openFile.mockClear();
  useFilesStore.setState({ activePath: "main.tex", openFile } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("firstChangedLine", () => {
  it("finds the first line that differs, including added and removed lines", () => {
    expect(firstChangedLine("a\nb", "a\nB")).toBe(2);
    expect(firstChangedLine("a", "a\nb")).toBe(2);
    expect(firstChangedLine("a\nb", "a")).toBe(2);
    expect(firstChangedLine("same", "same")).toBe(1);
  });
});

describe("ToolConfirm edits", () => {
  it("shows where the edit starts and takes the editor there", async () => {
    render(<ToolConfirm req={writeRequest} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText(approval.line.replace("{{line}}", "3"))).toBeInTheDocument();
    expect(screen.getByText(approval.firstChange.replace("{{line}}", "3"))).toBeInTheDocument();
    expect(screen.getByTestId("inline-diff")).toHaveAttribute("data-scroll-line", "3");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(openFile).toHaveBeenCalledWith("chapters/intro.tex", { opener: "assistant" });
    expect(mocks.gotoLine).toHaveBeenCalledWith(3);
  });

  it("stays put when the card goes away before the editor is ready", async () => {
    useFilesStore.setState({ activePath: "chapters/intro.tex" } as never);
    const { unmount } = render(<ToolConfirm req={writeRequest} onApprove={vi.fn()} onReject={vi.fn()} />);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(openFile).not.toHaveBeenCalled();
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("offers session and project approval for an auto-approvable write", () => {
    const onApproveSession = vi.fn();
    const onApproveProject = vi.fn();
    render(
      <ToolConfirm
        req={writeRequest}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onApproveSession={onApproveSession}
        onApproveProject={onApproveProject}
        sessionAutoApprove
      />,
    );

    expect(screen.getByText(approval.sessionAutoApprove)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: approval.alwaysAllow }));
    fireEvent.click(screen.getByTestId("tool-confirm-approve-project"));

    expect(onApproveSession).toHaveBeenCalledOnce();
    expect(onApproveProject).toHaveBeenCalledOnce();
  });

  it("previews a figure and renders without its chrome when embedded", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <ToolConfirm
        req={{ tool: "insert_figure", summary: "Insert figure", image: "data:image/png;base64,AA" } as ToolApprovalRequest}
        onApprove={onApprove}
        onReject={onReject}
        embedded
      />,
    );

    expect(screen.getByRole("img", { name: approval.figureAlt })).toHaveAttribute("src", "data:image/png;base64,AA");
    expect(container.firstElementChild).toHaveAttribute("role", "alertdialog");
    expect(screen.queryByRole("button", { name: approval.alwaysAllow })).toBeNull();
    fireEvent.click(screen.getByTestId("tool-confirm-approve"));
    fireEvent.click(screen.getByTestId("tool-confirm-reject"));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("falls back to the summary for a command without its own text and treats a malformed MCP request as an edit", () => {
    render(
      <ToolConfirm
        req={{ tool: "replace_in_file", summary: "Edit refs", mcp: { server: "Papers" } } as unknown as ToolApprovalRequest}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: approval.confirm.edit })).toBeInTheDocument();

    render(
      <ToolConfirm req={{ tool: "run_command", summary: "$ make" } as ToolApprovalRequest} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(screen.getByText("$ make")).toBeInTheDocument();
  });
});
