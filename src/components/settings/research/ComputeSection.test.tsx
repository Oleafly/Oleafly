// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearch from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { ComputeTestReport, ComputeView, SandboxStatus } from "./compute-api";
import { ComputeSection } from "./ComputeSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const strings = enResearch.compute;

function view(patch: Partial<ComputeView> = {}): ComputeView {
  return {
    platform: "macos",
    targets: [
      {
        kind: "ssh",
        id: "t-a",
        label: "Lab box",
        host: "lab",
        user: "jdoe",
        port: null,
        remoteRoot: null,
        prelude: "",
      },
      {
        kind: "slurm",
        id: "t-b",
        label: "Cluster",
        host: "cluster",
        user: null,
        port: null,
        remoteRoot: null,
        prelude: "",
        defaults: {},
        gpuFlag: "gres",
      },
    ],
    tested: { "t-a": { at: Date.now() - 60_000, ok: true, resolved: "jdoe@lab.example.edu:22", relay: false } },
    sshAvailable: true,
    rsyncAvailable: true,
    cuaAvailable: false,
    ...patch,
  };
}

const sandbox: SandboxStatus = { platform: "macos", available: true, reason: null, windowsEnabled: null, runtimes: [], grants: [] };

let current: ComputeView;
let report: ComputeTestReport;

describe("ComputeSection", () => {
  beforeEach(() => {
    current = view();
    report = {
      targetId: "t-a",
      checks: [
        { id: "connect", status: "pass", detail: "" },
        { id: "python", status: "pass", detail: "3.12.4" },
        { id: "rsync", status: "warn", detail: "missing" },
      ],
      hostKey: null,
      resolved: "jdoe@lab.example.edu:22",
      finishedAt: Date.now(),
      error: null,
    };
    mockInvoke.mockReset().mockImplementation(async (command, args) => {
      switch (command) {
        case "research_compute_settings":
          return current;
        case "research_sandbox_status":
          return sandbox;
        case "research_compute_target_test":
          return { ...report, targetId: (args as { targetId: string }).targetId };
        case "research_compute_trust_host_key":
          return { ...report, hostKey: null };
        case "research_compute_target_remove":
          current = { ...current, targets: current.targets.filter((target) => target.id !== (args as { targetId: string }).targetId) };
          return current;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });
  });

  it("lists this computer first and every target with its last test", async () => {
    render(<ComputeSection />);
    const lab = await screen.findByTestId("compute-target-t-a");
    const local = screen.getByTestId("compute-target-local");
    const cluster = screen.getByTestId("compute-target-t-b");
    expect(local.compareDocumentPosition(lab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lab.compareDocumentPosition(cluster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(lab).getByText("jdoe@lab.example.edu:22")).toBeTruthy();
    expect(within(cluster).getByText(strings.targets.notTested)).toBeTruthy();
  });

  it("runs a test and shows each check with its status", async () => {
    render(<ComputeSection />);
    const lab = await screen.findByTestId("compute-target-t-a");
    await userEvent.click(within(lab).getByRole("button", { name: strings.targets.test }));
    expect(mockInvoke).toHaveBeenCalledWith("research_compute_target_test", { targetId: "t-a" });
    const list = await screen.findByTestId("compute-report-t-a");
    expect(within(list).getByText(strings.test.connect)).toBeTruthy();
    expect(within(list).getByText("3.12.4")).toBeTruthy();
    expect(within(list).getByText(strings.test.warn)).toBeTruthy();
  });

  it("asks before trusting a host key and sends the shown fingerprints", async () => {
    report = {
      ...report,
      checks: [{ id: "connect", status: "fail", detail: "unknown key" }],
      hostKey: {
        host: "lab",
        keys: [{ keyType: "ssh-ed25519", fingerprint: "SHA256:KBnev/h5SIgwiDASyOnH51z2NYWfa99cXhaTQrXXW0A" }],
        changed: false,
      },
    };
    render(<ComputeSection />);
    const lab = await screen.findByTestId("compute-target-t-a");
    await userEvent.click(within(lab).getByRole("button", { name: strings.targets.test }));
    const dialog = await screen.findByTestId("compute-host-key-dialog");
    expect(within(dialog).getByText(/SHA256:KBnev/)).toBeTruthy();
    await userEvent.click(within(dialog).getByTestId("compute-host-key-trust"));
    expect(mockInvoke).toHaveBeenCalledWith("research_compute_trust_host_key", {
      targetId: "t-a",
      fingerprints: ["SHA256:KBnev/h5SIgwiDASyOnH51z2NYWfa99cXhaTQrXXW0A"],
    });
    await waitFor(() => expect(screen.queryByTestId("compute-host-key-dialog")).toBeNull());
  });

  it("shows the changed-key warning without a trust button", async () => {
    report = { ...report, checks: [], hostKey: { host: "lab", keys: [], changed: true } };
    render(<ComputeSection />);
    const lab = await screen.findByTestId("compute-target-t-a");
    await userEvent.click(within(lab).getByRole("button", { name: strings.targets.test }));
    const dialog = await screen.findByTestId("compute-host-key-dialog");
    expect(within(dialog).getByText(strings.hostKey.changedTitle)).toBeTruthy();
    expect(within(dialog).queryByTestId("compute-host-key-trust")).toBeNull();
  });

  it("confirms before removing a target", async () => {
    render(<ComputeSection />);
    const cluster = await screen.findByTestId("compute-target-t-b");
    await userEvent.click(
      within(cluster).getByRole("button", { name: strings.targets.more.replace("{{label}}", "Cluster") }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: strings.targets.remove }));
    expect(mockInvoke).not.toHaveBeenCalledWith("research_compute_target_remove", expect.anything());
    const confirm = await screen.findByRole("button", { name: strings.targets.remove });
    await userEvent.click(confirm);
    expect(mockInvoke).toHaveBeenCalledWith("research_compute_target_remove", { targetId: "t-b" });
    await waitFor(() => expect(screen.queryByTestId("compute-target-t-b")).toBeNull());
  });

  it("hides SSH import when OpenSSH is missing and explains how to install it", async () => {
    current = view({ sshAvailable: false });
    render(<ComputeSection />);
    expect(await screen.findByTestId("compute-note-ssh-missing")).toBeTruthy();
    expect(screen.queryByTestId("compute-import")).toBeNull();
    expect(screen.getByText(strings.notes.sshMissing)).toBeTruthy();
  });

  it("shows the Windows rsync note only on Windows", async () => {
    const { unmount } = render(<ComputeSection />);
    await screen.findByTestId("compute-target-t-a");
    expect(screen.queryByTestId("compute-note-windows-rsync")).toBeNull();
    unmount();
    current = view({ platform: "windows" });
    render(<ComputeSection />);
    expect(await screen.findByTestId("compute-note-windows-rsync")).toBeTruthy();
  });
});
