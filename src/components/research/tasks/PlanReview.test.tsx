// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { researchTaskFixture } from "./tests/task-fixtures";

const api = vi.hoisted(() => ({ loadResearchTaskPlan: vi.fn() }));

vi.mock("@/lib/research-tasks", () => api);

import { PlanReview } from "./PlanReview";

const copy = enResearchTools.tasks.plan;
const PLAN = "# Plan\n\n- [ ] Measure the baseline\n- [ ] Try dropout 0.1\n";

function planReady(generation = 1) {
  return researchTaskFixture({ id: "plan-task", status: "plan_ready", executionGeneration: generation });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("PlanReview", () => {
  beforeEach(() => {
    api.loadResearchTaskPlan.mockReset().mockResolvedValue(PLAN);
  });

  it("shows the plan with Approve and Approve edited plan", async () => {
    const onApprove = vi.fn(async () => {});
    render(<PlanReview task={planReady()} busy={false} onApprove={onApprove} onDiscard={vi.fn(async () => {})} />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.loading);
    expect(screen.getByRole("button", { name: copy.approve })).toBeDisabled();

    const editor = await screen.findByRole("textbox", { name: copy.title });
    expect(editor).toHaveValue(PLAN);
    expect(screen.getByText(copy.description)).toBeInTheDocument();
    expect(api.loadResearchTaskPlan).toHaveBeenCalledWith("plan-task");

    await userEvent.click(screen.getByRole("button", { name: copy.approve }));
    expect(onApprove).toHaveBeenLastCalledWith(undefined);

    fireEvent.change(editor, { target: { value: "- [ ] edited" } });
    expect(screen.queryByRole("button", { name: copy.approve })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: copy.approveEdited }));
    expect(onApprove).toHaveBeenLastCalledWith("- [ ] edited");
    expect(onApprove).toHaveBeenCalledTimes(2);
  });

  it("does not count added blank lines as an edit", async () => {
    const onApprove = vi.fn(async () => {});
    render(<PlanReview task={planReady()} busy={false} onApprove={onApprove} onDiscard={vi.fn(async () => {})} />);
    const editor = await screen.findByRole("textbox", { name: copy.title });

    fireEvent.change(editor, { target: { value: `\n${PLAN}\n\n` } });
    await userEvent.click(screen.getByRole("button", { name: copy.approve }));

    expect(onApprove).toHaveBeenCalledWith(undefined);
  });

  it("discards the task and ignores a rejected decision", async () => {
    const onDiscard = vi.fn(async () => {
      throw new Error("The task already finished.");
    });
    const onApprove = vi.fn(async () => {
      throw new Error("The plan changed.");
    });
    render(<PlanReview task={planReady()} busy={false} onApprove={onApprove} onDiscard={onDiscard} />);
    await screen.findByRole("textbox", { name: copy.title });

    await userEvent.click(screen.getByRole("button", { name: copy.discard }));
    await userEvent.click(screen.getByRole("button", { name: copy.approve }));

    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onApprove).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: copy.approve })).toBeEnabled();
  });

  it("says the plan is missing and keeps Approve off", async () => {
    api.loadResearchTaskPlan.mockRejectedValue(new Error("No such file"));
    render(<PlanReview task={planReady()} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.missing);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: copy.approve })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.discard })).toBeEnabled();
  });

  it("locks the plan while a decision is being saved", async () => {
    render(<PlanReview task={planReady()} busy onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />);

    expect(await screen.findByRole("textbox", { name: copy.title })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.approve })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.discard })).toBeDisabled();
  });

  it("reloads the plan for a new run and drops an answer for the old one", async () => {
    const first = deferred<string>();
    api.loadResearchTaskPlan.mockReturnValueOnce(first.promise).mockResolvedValueOnce("- [ ] second run");
    const view = render(
      <PlanReview task={planReady(1)} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />,
    );

    view.rerender(
      <PlanReview task={planReady(2)} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />,
    );
    expect(await screen.findByRole("textbox", { name: copy.title })).toHaveValue("- [ ] second run");
    await act(async () => first.resolve("- [ ] first run"));
    expect(screen.getByRole("textbox", { name: copy.title })).toHaveValue("- [ ] second run");
    expect(api.loadResearchTaskPlan).toHaveBeenCalledTimes(2);
  });

  it("ignores a failure that arrives after the task moved on", async () => {
    const first = deferred<string>();
    api.loadResearchTaskPlan.mockReturnValueOnce(first.promise).mockResolvedValueOnce(PLAN);
    const view = render(
      <PlanReview task={planReady(1)} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />,
    );
    view.rerender(
      <PlanReview task={planReady(2)} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />,
    );
    await screen.findByRole("textbox", { name: copy.title });

    await act(async () => first.reject(new Error("gone")));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("textbox", { name: copy.title })).toHaveValue(PLAN);
  });
});
