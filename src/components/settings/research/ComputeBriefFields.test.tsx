// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearch from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { announceSandboxChanged, COMPUTE_TARGETS_CHANGED, type ComputeView, type SandboxStatus } from "./compute-api";
import { ComputeBriefFields, computeFor } from "./ComputeBriefFields";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const strings = enResearch.compute;

function view(patch: Partial<ComputeView> = {}): ComputeView {
  return {
    platform: "linux",
    targets: [
      {
        kind: "slurm",
        id: "t-s",
        label: "Cluster",
        host: "cluster",
        user: "jdoe",
        port: 22,
        remoteRoot: null,
        prelude: "",
        defaults: { partition: "gpu", timeMinutes: 120 },
        gpuFlag: "gres",
      },
      { kind: "cuaSpace", id: "t-c", label: "Space", space: "lab", perTask: false },
    ],
    tested: {
      "t-s": { at: 1, ok: true, resolved: "jdoe@cluster.example.edu:22", relay: false },
      "t-c": { at: 1, ok: true, resolved: null, relay: true },
    },
    sshAvailable: true,
    rsyncAvailable: true,
    cuaAvailable: true,
    ...patch,
  };
}

let current: ComputeView;
let windowsEnabled = true;
const local = { executor: "local", target: null, resources: null };

type Compute = Parameters<typeof ComputeBriefFields>[0]["value"];

function Harness({
  initial,
  onChange,
  onProblemChange,
}: Readonly<{ initial: Compute; onChange: (next: Compute) => void; onProblemChange?: (problem: boolean) => void }>) {
  const [value, setValue] = useState(initial);
  return (
    <ComputeBriefFields
      value={value}
      onProblemChange={onProblemChange}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const SLURM = { executor: "slurm", target: "t-s", resources: null };

describe("ComputeBriefFields", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    current = view();
    windowsEnabled = true;
    mockInvoke.mockReset().mockImplementation(async (command) => {
      if (command === "research_compute_settings") return current;
      if (command === "research_sandbox_status") {
        return { platform: "windows", available: true, windowsEnabled, runtimes: [], grants: [] };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("defaults to this computer", async () => {
    render(<ComputeBriefFields value={local} onChange={vi.fn()} />);
    expect(await screen.findByText(strings.brief.runsLocal)).toBeTruthy();
  });

  it("prefills Slurm resources from the target defaults", async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ executor: "slurm", target: "t-s", resources: null }} onChange={onChange} />);
    const partition = await screen.findByLabelText(strings.form.partition);
    expect((partition as HTMLInputElement).value).toBe("gpu");
    expect((screen.getByLabelText(strings.form.time) as HTMLInputElement).value).toBe("2:00:00");
    await userEvent.clear(partition);
    await userEvent.type(partition, "a");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ resources: expect.objectContaining({ partition: "a" }) }),
    );
  });

  it("names where runs will execute", async () => {
    render(<ComputeBriefFields value={{ executor: "slurm", target: "t-s", resources: null }} onChange={vi.fn()} />);
    expect(await screen.findByText("Runs on jdoe@cluster.example.edu:22")).toBeTruthy();
  });

  it("explains the Windows switch and opens Settings", async () => {
    current = view({ platform: "windows" });
    windowsEnabled = false;
    const openSettingsAt = vi.spyOn(useSettingsStore.getState(), "openSettingsAt").mockImplementation(() => {});
    render(<ComputeBriefFields value={local} onChange={vi.fn()} />);
    expect(await screen.findByText(strings.brief.windowsOff)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: strings.brief.openSettings }));
    expect(openSettingsAt).toHaveBeenCalledWith("research");
    openSettingsAt.mockRestore();
  });

  it("drops the Windows note as soon as the sandbox is turned on in Settings", async () => {
    current = view({ platform: "windows" });
    windowsEnabled = false;
    render(<ComputeBriefFields value={local} onChange={vi.fn()} />);
    expect(await screen.findByText(strings.brief.windowsOff)).toBeTruthy();

    act(() =>
      announceSandboxChanged({ platform: "windows", available: true, windowsEnabled: true } as SandboxStatus),
    );

    expect(screen.queryByText(strings.brief.windowsOff)).toBeNull();
  });

  it("lets the composer close before it opens Settings", async () => {
    current = view({ platform: "windows" });
    windowsEnabled = false;
    const openSettingsAt = vi.spyOn(useSettingsStore.getState(), "openSettingsAt").mockImplementation(() => {});
    const onOpenSettings = vi.fn();
    render(<ComputeBriefFields value={local} onChange={vi.fn()} onOpenSettings={onOpenSettings} />);
    expect(await screen.findByText(strings.brief.windowsOff)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: strings.brief.openSettings }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(openSettingsAt).not.toHaveBeenCalled();
    onOpenSettings.mock.calls[0][0]();
    expect(openSettingsAt).toHaveBeenCalledWith("research");
    openSettingsAt.mockRestore();
  });

  it("warns that a Relay Space is not isolated", async () => {
    render(<ComputeBriefFields value={{ executor: "cua-space", target: "t-c", resources: null }} onChange={vi.fn()} />);
    expect(await screen.findByText(strings.notes.relay)).toBeTruthy();
  });

  it("reloads targets after Settings changes them", async () => {
    render(<ComputeBriefFields value={local} onChange={vi.fn()} />);
    await screen.findByText(strings.brief.runsLocal);
    const calls = () => mockInvoke.mock.calls.filter(([command]) => command === "research_compute_settings").length;
    expect(calls()).toBe(1);
    act(() => {
      window.dispatchEvent(new CustomEvent(COMPUTE_TARGETS_CHANGED));
    });
    await waitFor(() => expect(calls()).toBe(2));
  });

  it("says when the task's target was removed", async () => {
    render(<ComputeBriefFields value={{ executor: "ssh", target: "t-gone", resources: null }} onChange={vi.fn()} />);
    expect(await screen.findByText(strings.brief.missing)).toBeTruthy();
  });

  it("tells the composer a removed target can't be saved", async () => {
    const onProblemChange = vi.fn();
    render(
      <ComputeBriefFields
        value={{ executor: "ssh", target: "t-gone", resources: null }}
        onChange={vi.fn()}
        onProblemChange={onProblemChange}
      />,
    );
    await screen.findByText(strings.brief.missing);
    expect(onProblemChange).toHaveBeenLastCalledWith(true);
  });

  it("reports no problem for this computer or a target that exists", async () => {
    const onProblemChange = vi.fn();
    render(<Harness initial={SLURM} onChange={vi.fn()} onProblemChange={onProblemChange} />);
    await screen.findByLabelText(strings.form.partition);
    expect(onProblemChange).toHaveBeenLastCalledWith(false);
    expect(onProblemChange).not.toHaveBeenCalledWith(true);
  });

  it("does not call a target missing when the list could not be loaded, and retries", async () => {
    mockInvoke.mockReset().mockRejectedValueOnce(new Error("The settings could not be read.")).mockImplementation(async () => current);
    const onProblemChange = vi.fn();
    render(
      <ComputeBriefFields
        value={{ executor: "ssh", target: "t-s", resources: null }}
        onChange={vi.fn()}
        onProblemChange={onProblemChange}
      />,
    );

    expect(await screen.findByText(strings.brief.loadFailed)).toBeTruthy();
    expect(screen.queryByText(strings.brief.missing)).toBeNull();
    expect(onProblemChange).not.toHaveBeenCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    await waitFor(() => expect(screen.queryByText(strings.brief.loadFailed)).toBeNull());
  });

  it("keeps a GPU count that doesn't read in its field with a message, and lets the composer know", async () => {
    const onChange = vi.fn();
    const onProblemChange = vi.fn();
    render(<Harness initial={SLURM} onChange={onChange} onProblemChange={onProblemChange} />);
    const gpus = await screen.findByLabelText(strings.form.gpus);

    await userEvent.type(gpus, "4");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ resources: expect.objectContaining({ gpus: 4 }) }));
    await userEvent.type(gpus, " GPUs");

    expect((gpus as HTMLInputElement).value).toBe("4 GPUs");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ resources: expect.objectContaining({ gpus: 4 }) }));
    expect(screen.getByText(strings.form.errors.count)).toBeTruthy();
    expect(gpus.getAttribute("aria-invalid")).toBe("true");
    expect(onProblemChange).toHaveBeenLastCalledWith(true);

    await userEvent.clear(gpus);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ resources: expect.objectContaining({ gpus: null }) }));
    expect(screen.queryByText(strings.form.errors.count)).toBeNull();
    expect(onProblemChange).toHaveBeenLastCalledWith(false);
  });

  it("refuses zero CPUs and more than the limit", async () => {
    const onProblemChange = vi.fn();
    render(<Harness initial={SLURM} onChange={vi.fn()} onProblemChange={onProblemChange} />);
    const cpus = await screen.findByLabelText(strings.form.cpus);

    await userEvent.type(cpus, "0");
    expect(screen.getByText(strings.form.errors.count)).toBeTruthy();
    expect(onProblemChange).toHaveBeenLastCalledWith(true);
    await userEvent.clear(cpus);
    await userEvent.type(cpus, "2000");
    expect(screen.getByText(strings.form.errors.count)).toBeTruthy();
    await userEvent.clear(cpus);
    await userEvent.type(cpus, "16");
    expect(screen.queryByText(strings.form.errors.count)).toBeNull();
    expect(onProblemChange).toHaveBeenLastCalledWith(false);
  });

  it("checks the partition against the same rule as a target's defaults", async () => {
    const onChange = vi.fn();
    const onProblemChange = vi.fn();
    render(<Harness initial={SLURM} onChange={onChange} onProblemChange={onProblemChange} />);
    const partition = await screen.findByLabelText(strings.form.partition);

    await userEvent.clear(partition);
    onChange.mockClear();
    await userEvent.type(partition, "gpu node");

    expect(screen.getByText(strings.form.errors.name)).toBeTruthy();
    expect(onProblemChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ resources: expect.objectContaining({ partition: "gpu" }) }));
    await userEvent.clear(partition);
    await userEvent.type(partition, "gpu,cpu");
    expect(screen.queryByText(strings.form.errors.name)).toBeNull();
    expect(onProblemChange).toHaveBeenLastCalledWith(false);
  });

  it("flags a time or memory that doesn't read and clears it when fixed", async () => {
    const onProblemChange = vi.fn();
    render(<Harness initial={SLURM} onChange={vi.fn()} onProblemChange={onProblemChange} />);
    const time = await screen.findByLabelText(strings.form.time);

    await userEvent.clear(time);
    await userEvent.type(time, "soon");
    expect(screen.getByText(strings.form.errors.time)).toBeTruthy();
    expect(onProblemChange).toHaveBeenLastCalledWith(true);
    await userEvent.clear(time);
    await userEvent.type(time, "4:00:00");
    expect(screen.queryByText(strings.form.errors.time)).toBeNull();

    const memory = screen.getByLabelText(strings.form.mem);
    await userEvent.type(memory, "lots");
    expect(screen.getByText(strings.form.errors.mem)).toBeTruthy();
    expect(onProblemChange).toHaveBeenLastCalledWith(true);
    await userEvent.clear(memory);
    expect(onProblemChange).toHaveBeenLastCalledWith(false);
  });

  it("clears a field problem when the task moves to another target", async () => {
    const onProblemChange = vi.fn();
    render(<Harness initial={SLURM} onChange={vi.fn()} onProblemChange={onProblemChange} />);
    const gpus = await screen.findByLabelText(strings.form.gpus);
    await userEvent.type(gpus, "x");
    expect(onProblemChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: strings.targets.local }));

    await waitFor(() => expect(onProblemChange).toHaveBeenLastCalledWith(false));
    expect(screen.queryByLabelText(strings.form.gpus)).toBeNull();
  });

  it("picks the executor and resources that go with a target", () => {
    const slurm = view().targets[0];
    expect(computeFor(slurm)).toEqual({
      executor: "slurm",
      target: "t-s",
      resources: {
        timeMinutes: 120,
        partition: "gpu",
        gpus: null,
        cpus: null,
        memoryGb: null,
        account: null,
        qos: null,
      },
    });
    expect(computeFor(null)).toEqual(local);
  });
});
