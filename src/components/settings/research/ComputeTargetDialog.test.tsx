// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enResearch from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { emptyTarget, type ComputeTarget } from "./compute-api";
import { ComputeTargetDialog, draftOf, targetFromDraft } from "./ComputeTargetDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const form = enResearch.compute.form;

describe("ComputeTargetDialog", () => {
  it("shows Slurm resource fields only for Slurm targets", () => {
    const { unmount } = render(
      <ComputeTargetDialog target={emptyTarget("ssh")} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.queryByLabelText(form.partition)).toBeNull();
    unmount();
    render(<ComputeTargetDialog target={emptyTarget("slurm")} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText(form.partition)).toBeTruthy();
    expect(screen.getByText("--gres=gpu:N")).toBeTruthy();
  });

  it("blocks saving with an invalid port and saves camelCase fields", async () => {
    const onSave = vi.fn(async (_target: ComputeTarget) => undefined);
    const onClose = vi.fn();
    render(<ComputeTargetDialog target={emptyTarget("ssh")} onClose={onClose} onSave={onSave} />);
    await userEvent.type(screen.getByLabelText(form.label), "Lab");
    await userEvent.type(screen.getByLabelText(form.host), "cluster.example.edu");
    await userEvent.type(screen.getByLabelText(form.port), "0");
    await userEvent.click(screen.getByTestId("compute-target-save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(form.errors.port)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText(form.port));
    await userEvent.type(screen.getByLabelText(form.port), "2222");
    await userEvent.type(screen.getByLabelText(form.remoteRoot), "scratch/runs");
    await userEvent.click(screen.getByTestId("compute-target-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ssh", host: "cluster.example.edu", port: 2222, remoteRoot: "scratch/runs" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("marks setup commands that are over Rust's 4 KB and keeps the dialog open", async () => {
    const onSave = vi.fn(async (_target: ComputeTarget) => undefined);
    render(<ComputeTargetDialog target={emptyTarget("ssh")} onClose={vi.fn()} onSave={onSave} />);
    await userEvent.type(screen.getByLabelText(form.label), "Lab");
    await userEvent.type(screen.getByLabelText(form.host), "cluster.example.edu");
    const prelude = screen.getByLabelText(form.prelude);
    fireEvent.change(prelude, { target: { value: "# 模块\n".repeat(700) } });
    await userEvent.click(screen.getByTestId("compute-target-save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(prelude).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(form.errors.prelude)).toBeTruthy();
  });

  it("turns Slurm text into the saved resources", () => {
    const slurm = emptyTarget("slurm");
    const draft = { ...draftOf(slurm), label: "Cluster", host: "c", time: "2:00:00", mem: "16G", gpus: "2", partition: "gpu" };
    const { target, errors } = targetFromDraft(slurm, draft);
    expect(errors).toEqual({});
    expect(target).toMatchObject({
      kind: "slurm",
      gpuFlag: "gres",
      defaults: { timeMinutes: 120, memoryGb: 16, gpus: 2, partition: "gpu", cpus: null },
    });
    expect(targetFromDraft(slurm, { ...draft, time: "soon" }).errors).toEqual({ time: "time" });
  });

  it("keeps the Space name only for a named Space", () => {
    const cua = emptyTarget("cuaSpace");
    const { target } = targetFromDraft(cua, { ...draftOf(cua), label: "Space", space: "lab", perTask: true });
    expect(target).toMatchObject({ kind: "cuaSpace", perTask: true, space: "" });
  });
});
