// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { researchTaskFixture } from "./tests/task-fixtures";

const api = vi.hoisted(() => ({ loadResearchTaskPlan: vi.fn(), MAX_PLAN_BYTES: 64 * 1024 }));

vi.mock("@/lib/research-tasks", () => api);

import { PlanReview } from "./PlanReview";

const copy = enResearchTools.tasks.plan;
const PLAN = "# Plan\n\n- [ ] Measure the baseline\n- [ ] Try dropout 0.1\n";
const whole = (text: string) => ({ text, truncated: false });

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
    api.loadResearchTaskPlan.mockReset().mockResolvedValue(whole(PLAN));
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

  it("says why the plan didn't load, keeps Approve off and loads it again on Retry", async () => {
    api.loadResearchTaskPlan.mockRejectedValueOnce(new Error("No such file")).mockResolvedValueOnce(whole(PLAN));
    render(<PlanReview task={planReady()} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy.loadFailed);
    expect(alert).toHaveTextContent("No such file");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: copy.approve })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.discard })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));

    expect(await screen.findByRole("textbox", { name: copy.title })).toHaveValue(PLAN);
    expect(api.loadResearchTaskPlan).toHaveBeenCalledTimes(2);
  });

  it("warns that a long plan is cut and approves only an edited one", async () => {
    api.loadResearchTaskPlan.mockResolvedValue({ text: PLAN, truncated: true });
    const onApprove = vi.fn(async () => {});
    render(<PlanReview task={planReady()} busy={false} onApprove={onApprove} onDiscard={vi.fn(async () => {})} />);
    const editor = await screen.findByRole("textbox", { name: copy.title });

    expect(screen.getByTestId("research-task-plan-truncated")).toHaveTextContent(copy.truncated);
    expect(screen.getByRole("button", { name: copy.approve })).toBeDisabled();

    fireEvent.change(editor, { target: { value: "- [ ] Measure the baseline" } });
    await userEvent.click(screen.getByRole("button", { name: copy.approveEdited }));
    expect(onApprove).toHaveBeenCalledWith("- [ ] Measure the baseline");
  });

  it("measures an edited plan in bytes, as the backend does", async () => {
    render(<PlanReview task={planReady()} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />);
    const editor = await screen.findByRole("textbox", { name: copy.title });

    fireEvent.change(editor, { target: { value: "計".repeat(30_000) } });

    expect(screen.getByText(copy.tooLong)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.approveEdited })).toBeDisabled();
  });

  it("locks the plan while a decision is being saved", async () => {
    render(<PlanReview task={planReady()} busy onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />);

    expect(await screen.findByRole("textbox", { name: copy.title })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.approve })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.discard })).toBeDisabled();
  });

  it("reloads the plan for a new run and drops an answer for the old one", async () => {
    const first = deferred<{ text: string; truncated: boolean }>();
    api.loadResearchTaskPlan.mockReturnValueOnce(first.promise).mockResolvedValueOnce(whole("- [ ] second run"));
    const view = render(
      <PlanReview task={planReady(1)} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />,
    );

    view.rerender(
      <PlanReview task={planReady(2)} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />,
    );
    expect(await screen.findByRole("textbox", { name: copy.title })).toHaveValue("- [ ] second run");
    await act(async () => first.resolve(whole("- [ ] first run")));
    expect(screen.getByRole("textbox", { name: copy.title })).toHaveValue("- [ ] second run");
    expect(api.loadResearchTaskPlan).toHaveBeenCalledTimes(2);
  });

  it("drops the missing note when the next run has a plan", async () => {
    api.loadResearchTaskPlan.mockRejectedValueOnce(new Error("No such file")).mockResolvedValueOnce(whole(PLAN));
    const view = render(
      <PlanReview task={planReady(1)} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.loadFailed);

    view.rerender(
      <PlanReview task={planReady(2)} busy={false} onApprove={vi.fn(async () => {})} onDiscard={vi.fn(async () => {})} />,
    );

    expect(await screen.findByRole("textbox", { name: copy.title })).toHaveValue(PLAN);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a failure that arrives after the task moved on", async () => {
    const first = deferred<{ text: string; truncated: boolean }>();
    api.loadResearchTaskPlan.mockReturnValueOnce(first.promise).mockResolvedValueOnce(whole(PLAN));
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
