// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { formatDateTime } from "@/lib/intl";
import type { ApprovalRecord } from "@/lib/research-tasks";
import { useResearchAttentionStore } from "@/store/research-attention";
import { researchTaskFixture } from "./tests/task-fixtures";

const api = vi.hoisted(() => ({
  listResearchTaskApprovals: vi.fn(),
  decideResearchTaskApproval: vi.fn(),
}));

vi.mock("@/lib/research-tasks", () => api);

import { PendingApprovals } from "./PendingApprovals";

const copy = enResearchTools.tasks.approvals;
const EXPIRES = Date.UTC(2026, 9, 20, 9, 30);

function approval(id: string, patch: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id,
    taskId: "train",
    executionGeneration: 1,
    kind: "command",
    summary: `Summary ${id}`,
    detail: `pip install --upgrade torch # ${id}`,
    status: "pending",
    createdAt: EXPIRES - 86_400_000,
    expiresAt: EXPIRES,
    decidedAt: null,
    ...patch,
  };
}

const tasks = [
  researchTaskFixture({ id: "train", title: "Train the model", status: "running", pendingApprovals: 1 }),
  researchTaskFixture({ id: "sweep", title: "Literature sweep", status: "running", pendingApprovals: 1 }),
];

const squash = (text: string) => text.replace(/\s+/g, " ");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("PendingApprovals", () => {
  beforeEach(() => {
    useResearchAttentionStore.setState({ byProject: {} });
    api.listResearchTaskApprovals.mockReset().mockResolvedValue([
      approval("a1"),
      approval("a2", { taskId: "sweep", kind: "mcp", summary: "Search the alphaXiv index", detail: "" }),
    ]);
    api.decideResearchTaskApproval.mockReset().mockImplementation(async (id: string, approve: boolean) =>
      approval(id, { status: approve ? "approved" : "denied" }),
    );
  });

  it("shows each pending request with its task and command and approves one", async () => {
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");
    expect(api.listResearchTaskApprovals).toHaveBeenCalledWith("paper");
    expect(within(section).getByRole("heading", { name: copy.title })).toBeInTheDocument();

    const [first, second] = within(section).getAllByRole("listitem");
    expect(first).toHaveTextContent(copy.kindCommand);
    expect(first).toHaveTextContent("Train the model");
    expect(first).toHaveTextContent("Summary a1");
    expect(first).toHaveTextContent("pip install --upgrade torch # a1");
    expect(first).toHaveTextContent(squash(`Waits until ${formatDateTime(new Date(EXPIRES))}`));
    expect(second).toHaveTextContent(copy.kindMcp);
    expect(second).toHaveTextContent("Literature sweep");
    expect(second).toHaveTextContent("Search the alphaXiv index");
    expect(within(second).queryByRole("button", { expanded: false })).toBeNull();

    api.listResearchTaskApprovals.mockResolvedValue([approval("a2", { taskId: "sweep", kind: "mcp", detail: "" })]);
    await userEvent.click(within(first).getByRole("button", { name: copy.approve }));

    expect(api.decideResearchTaskApproval).toHaveBeenCalledExactlyOnceWith("a1", true);
    await waitFor(() => expect(within(section).getAllByRole("listitem")).toHaveLength(1));
    expect(api.listResearchTaskApprovals).toHaveBeenCalledTimes(2);
  });

  it("denies a request and shows why a decision failed", async () => {
    api.decideResearchTaskApproval.mockRejectedValueOnce(new Error("This approval is no longer waiting."));
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");
    const [first] = within(section).getAllByRole("listitem");

    await userEvent.click(within(first).getByRole("button", { name: copy.deny }));

    expect(api.decideResearchTaskApproval).toHaveBeenCalledWith("a1", false);
    expect(await within(section).findByRole("alert")).toHaveTextContent("This approval is no longer waiting.");
    expect(within(first).getByRole("button", { name: copy.deny })).toBeEnabled();

    api.decideResearchTaskApproval.mockRejectedValueOnce("offline");
    await userEvent.click(within(first).getByRole("button", { name: copy.approve }));
    expect(await within(section).findByText("offline")).toBeInTheDocument();
  });

  it("disables a request's buttons while its decision is saved", async () => {
    const pending = deferred<ApprovalRecord>();
    api.decideResearchTaskApproval.mockReturnValueOnce(pending.promise);
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");
    const [first, second] = within(section).getAllByRole("listitem");

    await userEvent.click(within(first).getByRole("button", { name: copy.approve }));

    expect(within(first).getByRole("button", { name: copy.approve })).toBeDisabled();
    expect(within(first).getByRole("button", { name: copy.deny })).toBeDisabled();
    expect(within(second).getByRole("button", { name: copy.approve })).toBeEnabled();
    await act(async () => pending.resolve(approval("a1", { status: "approved" })));
    await waitFor(() => expect(within(first).getByRole("button", { name: copy.approve })).toBeEnabled());
  });

  it("refreshes when attention changes", async () => {
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    await screen.findByTestId("research-pending-approvals");
    expect(api.listResearchTaskApprovals).toHaveBeenCalledTimes(1);

    api.listResearchTaskApprovals.mockResolvedValue([approval("a3", { summary: "A new request" })]);
    act(() => useResearchAttentionStore.setState({ byProject: { paper: 3 } }));

    expect(await screen.findByText("A new request")).toBeInTheDocument();
    expect(api.listResearchTaskApprovals).toHaveBeenCalledTimes(2);

    act(() => useResearchAttentionStore.setState({ byProject: { paper: 3, other: 5 } }));
    expect(api.listResearchTaskApprovals).toHaveBeenCalledTimes(2);
  });

  it("refreshes when a task's waiting count changes", async () => {
    const view = render(<PendingApprovals projectId="paper" tasks={tasks} />);
    await screen.findByTestId("research-pending-approvals");

    view.rerender(<PendingApprovals projectId="paper" tasks={[{ ...tasks[0], pendingApprovals: 2 }, tasks[1]]} />);

    await waitFor(() => expect(api.listResearchTaskApprovals).toHaveBeenCalledTimes(2));
  });

  it("expands a long command and folds it again", async () => {
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");
    const toggle = within(section).getByRole("button", { expanded: false });
    const command = toggle.querySelector("pre") as HTMLElement;
    expect(command).toHaveClass("line-clamp-3");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(command).not.toHaveClass("line-clamp-3");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(command).toHaveClass("line-clamp-3");
  });

  it("shows only the task's own requests in the task banner", async () => {
    render(<PendingApprovals projectId="paper" tasks={tasks} taskId="sweep" />);
    const section = await screen.findByTestId("research-pending-approvals");

    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Search the alphaXiv index");
    expect(rows[0]).not.toHaveTextContent("Literature sweep");
  });

  it("names a run request and leaves out the title of a task it does not know", async () => {
    api.listResearchTaskApprovals.mockResolvedValue([approval("a9", { taskId: "elsewhere", kind: "run" })]);
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");

    const [row] = within(section).getAllByRole("listitem");
    expect(row).toHaveTextContent(copy.kindRun);
    expect(row).not.toHaveTextContent("Train the model");
    expect(row).not.toHaveTextContent("Literature sweep");
  });

  it("renders nothing when no request waits or the list cannot be read", async () => {
    api.listResearchTaskApprovals.mockResolvedValue([]);
    const view = render(<PendingApprovals projectId="paper" tasks={tasks} />);
    await waitFor(() => expect(api.listResearchTaskApprovals).toHaveBeenCalledOnce());
    expect(view.container.innerHTML).toBe("");

    api.listResearchTaskApprovals.mockRejectedValue(new Error("The task store is locked."));
    view.rerender(<PendingApprovals projectId="other" tasks={tasks} />);
    await waitFor(() => expect(api.listResearchTaskApprovals).toHaveBeenLastCalledWith("other"));
    expect(view.container.innerHTML).toBe("");
  });

  it("hides the requests of other tasks when filtered to one with none", async () => {
    const view = render(<PendingApprovals projectId="paper" tasks={tasks} taskId="missing" />);
    await waitFor(() => expect(api.listResearchTaskApprovals).toHaveBeenCalledOnce());
    expect(view.container.innerHTML).toBe("");
  });
});
