// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearch from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { COMPUTE_TARGETS_CHANGED, type ComputeView } from "./compute-api";
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

/** Keeps the value the way the composer does. */
function Harness({ initial, onChange }: Readonly<{ initial: Compute; onChange: (next: Compute) => void }>) {
  const [value, setValue] = useState(initial);
  return (
    <ComputeBriefFields
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("ComputeBriefFields", () => {
  beforeEach(() => {
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
