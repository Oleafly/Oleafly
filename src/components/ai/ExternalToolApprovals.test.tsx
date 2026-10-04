// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@/components/editor/cm/controller", () => ({ gotoLine: vi.fn() }));

import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import type { ToolApprovalRequest } from "@/lib/ai-tools";
import { useMcpApprovalStore } from "@/store/mcp-approvals";
import { ExternalToolApprovals } from "./ExternalToolApprovals";

const approval = enAi.approval;

function ask(req: Partial<ToolApprovalRequest>) {
  let decision!: Promise<boolean>;
  act(() => {
    decision = useMcpApprovalStore.getState().request({ summary: "Run", ...req } as ToolApprovalRequest);
  });
  return decision;
}

afterEach(() => {
  act(() => useMcpApprovalStore.getState().cancelAll());
});

describe("ExternalToolApprovals", () => {
  it("stays hidden with nothing to approve", () => {
    const { container } = render(<ExternalToolApprovals />);
    expect(container).toBeEmptyDOMElement();
  });

  it("approves and rejects queued requests one at a time", async () => {
    render(<ExternalToolApprovals />);
    const first = ask({ tool: "run_command", summary: "$ make" });
    const second = ask({ tool: "delete_file", summary: "Delete notes.tex" });

    expect(screen.getByText(approval.external.title)).toBeInTheDocument();
    expect(screen.getByText(approval.external.moreWaiting_one.replace("{{count}}", "1"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: approval.alwaysAllow })).toBeNull();
    fireEvent.click(screen.getByTestId("tool-confirm-approve"));
    await expect(first).resolves.toBe(true);

    expect(screen.queryByText(/more waiting/)).toBeNull();
    fireEvent.click(screen.getByTestId("tool-confirm-reject"));
    await expect(second).resolves.toBe(false);
    expect(screen.queryByTestId("mcp-approval-panel")).toBeNull();
  });

  it("can allow file writes for the rest of the session", async () => {
    render(<ExternalToolApprovals />);
    const write = ask({ tool: "write_file", summary: "Write main.tex", path: "main.tex" });

    fireEvent.click(screen.getByRole("button", { name: approval.alwaysAllow }));

    await expect(write).resolves.toBe(true);
    expect(useMcpApprovalStore.getState().sessionAutoApprove).toBe(true);
    await expect(ask({ tool: "write_file", summary: "Write again", path: "main.tex" })).resolves.toBe(true);
    expect(screen.queryByTestId("mcp-approval-panel")).toBeNull();
  });
});
