// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
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
let extra: Record<string, (args: Record<string, unknown>) => unknown>;

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
    extra = {};
    mockInvoke.mockReset().mockImplementation(async (command, args) => {
      if (command in extra) return extra[command]((args ?? {}) as Record<string, unknown>);
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

  it("shows only the latest test's host key when a target is tested again before the first test ends", async () => {
    const answers: ((hostKey: ComputeTestReport["hostKey"]) => void)[] = [];
    extra.research_compute_target_test = (args) =>
      new Promise((resolve) => {
        answers.push((hostKey) =>
          resolve({ ...report, targetId: args.targetId as string, checks: [{ id: "connect", status: "fail", detail: "unknown key" }], hostKey }),
        );
      });
    extra.research_compute_target_save = () => current;
    const key = (host: string) => ({
      host,
      keys: [{ keyType: "ssh-ed25519", fingerprint: `SHA256:${host}-fingerprint` }],
      changed: false,
    });
    render(<ComputeSection />);
    const lab = await screen.findByTestId("compute-target-t-a");
    await userEvent.click(within(lab).getByRole("button", { name: strings.targets.test }));
    await waitFor(() => expect(answers).toHaveLength(1));

    await userEvent.click(within(lab).getByRole("button", { name: strings.targets.more.replace("{{label}}", "Lab box") }));
    await userEvent.click(await screen.findByRole("menuitem", { name: strings.targets.edit }));
    const form = await screen.findByTestId("compute-target-dialog");
    await userEvent.click(within(form).getByTestId("compute-target-save"));
    await waitFor(() => expect(answers).toHaveLength(2));

    answers[0](key("old-lab"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("compute-host-key-dialog")).toBeNull();

    answers[1](key("new-lab"));
    const dialog = await screen.findByTestId("compute-host-key-dialog");
    expect(dialog).toHaveTextContent("new-lab-fingerprint");
    expect(dialog).not.toHaveTextContent("old-lab-fingerprint");
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
  describe("host keys, one at a time", () => {
    const key = (host: string) => ({
      host,
      keys: [{ keyType: "ssh-ed25519", fingerprint: `SHA256:${host}-fingerprint` }],
      changed: false,
    });

    beforeEach(() => {
      extra.research_compute_target_test = async (args) => {
        const targetId = args.targetId as string;
        await new Promise((resolve) => setTimeout(resolve, targetId === "t-a" ? 5 : 60));
        return {
          ...report,
          targetId,
          checks: [{ id: "connect", status: "fail", detail: "unknown key" }],
          hostKey: key(targetId === "t-a" ? "lab" : "cluster"),
        };
      };
    });

    it("keeps the prompt on screen when another host's test also asks, and shows that one after", async () => {
      render(<ComputeSection />);
      const lab = await screen.findByTestId("compute-target-t-a");
      const cluster = screen.getByTestId("compute-target-t-b");

      fireEvent.click(within(lab).getByRole("button", { name: strings.targets.test }));
      fireEvent.click(within(cluster).getByRole("button", { name: strings.targets.test }));
      const dialog = await screen.findByTestId("compute-host-key-dialog");
      expect(dialog).toHaveTextContent("lab-fingerprint");
      await waitFor(() => expect(within(cluster).getByTestId("compute-host-key-t-b")).toBeTruthy());

      const stillOpen = screen.getByTestId("compute-host-key-dialog");
      expect(stillOpen).toHaveTextContent("lab-fingerprint");
      expect(stillOpen).not.toHaveTextContent("cluster-fingerprint");

      await userEvent.click(within(stillOpen).getByTestId("compute-host-key-trust"));
      expect(mockInvoke).toHaveBeenCalledWith("research_compute_trust_host_key", {
        targetId: "t-a",
        fingerprints: ["SHA256:lab-fingerprint"],
      });
      await waitFor(() => expect(screen.getByTestId("compute-host-key-dialog")).toHaveTextContent("cluster-fingerprint"));
      expect(screen.getByTestId("compute-host-key-dialog")).not.toHaveTextContent("lab-fingerprint");

      await userEvent.click(within(screen.getByTestId("compute-host-key-dialog")).getByTestId("compute-host-key-trust"));
      expect(mockInvoke).toHaveBeenCalledWith("research_compute_trust_host_key", {
        targetId: "t-b",
        fingerprints: ["SHA256:cluster-fingerprint"],
      });
      await waitFor(() => expect(screen.queryByTestId("compute-host-key-dialog")).toBeNull());
    });

    it("brings the question back from the row after the user closed it", async () => {
      render(<ComputeSection />);
      const lab = await screen.findByTestId("compute-target-t-a");
      await userEvent.click(within(lab).getByRole("button", { name: strings.targets.test }));
      const dialog = await screen.findByTestId("compute-host-key-dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: strings.form.cancel }));
      await waitFor(() => expect(screen.queryByTestId("compute-host-key-dialog")).toBeNull());

      await userEvent.click(within(lab).getByTestId("compute-host-key-t-a"));

      expect(await screen.findByTestId("compute-host-key-dialog")).toHaveTextContent("lab-fingerprint");
    });

    it("offers the host key check only on a row whose test asked about one", async () => {
      extra = {};
      render(<ComputeSection />);
      const lab = await screen.findByTestId("compute-target-t-a");
      await userEvent.click(within(lab).getByRole("button", { name: strings.targets.test }));
      await screen.findByTestId("compute-report-t-a");
      expect(within(lab).queryByTestId("compute-host-key-t-a")).toBeNull();
    });
  });

  describe("importing SSH hosts", () => {
    const hosts = [{ alias: "h1" }, { alias: "h2" }, { alias: "h3" }];
    let saved: string[];
    let active: number;
    let busiest: number;
    let tested: string[];

    beforeEach(() => {
      saved = [];
      active = 0;
      busiest = 0;
      tested = [];
      extra.research_compute_ssh_hosts = () => hosts;
      extra.research_compute_target_save = (args) => {
        const target = args.target as { label: string };
        if (target.label === "h2") throw new Error("Up to 32 targets.");
        saved.push(target.label);
        const added = {
          kind: "ssh" as const,
          id: `id-${target.label}`,
          label: target.label,
          host: target.label,
          user: null,
          port: null,
          remoteRoot: null,
          prelude: "",
        };
        current = { ...current, targets: [...current.targets, added] };
        return current;
      };
      extra.research_compute_target_test = async (args) => {
        const targetId = args.targetId as string;
        active += 1;
        busiest = Math.max(busiest, active);
        tested.push(targetId);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ...report, targetId, hostKey: null };
      };
    });

    async function chooseHosts(...aliases: string[]) {
      await userEvent.click(await screen.findByTestId("compute-import"));
      const dialog = await screen.findByTestId("compute-ssh-import-dialog");
      for (const alias of aliases) await userEvent.click(await within(dialog).findByRole("checkbox", { name: new RegExp(alias) }));
      return dialog;
    }

    it("tests the added hosts one after another", async () => {
      render(<ComputeSection />);
      await screen.findByTestId("compute-target-t-a");
      const dialog = await chooseHosts("h1", "h3");

      await userEvent.click(within(dialog).getByTestId("compute-ssh-import-add"));

      await waitFor(() => expect(tested).toEqual(["id-h1", "id-h3"]));
      await waitFor(() => expect(active).toBe(0));
      expect(busiest).toBe(1);
    });

    it("shows the hosts it added when a later one is refused, and says which were skipped", async () => {
      render(<ComputeSection />);
      await screen.findByTestId("compute-target-t-a");
      const dialog = await chooseHosts("h1", "h2", "h3");

      await userEvent.click(within(dialog).getByTestId("compute-ssh-import-add"));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Not added: h2. Up to 32 targets.");
      expect(saved).toEqual(["h1", "h3"]);
      expect(await screen.findByTestId("compute-target-id-h1")).toBeTruthy();
      expect(screen.getByTestId("compute-target-id-h3")).toBeTruthy();
      await waitFor(() => expect(tested).toEqual(["id-h1", "id-h3"]));
      expect(within(dialog).getByTestId("compute-ssh-import-add")).toHaveTextContent("Add 1 host");
      await userEvent.click(within(dialog).getByTestId("compute-ssh-import-add"));
      await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Not added: h2"));
      expect(saved).toEqual(["h1", "h3"]);
    });

    it("reports every host as skipped when none could be added", async () => {
      extra.research_compute_target_save = () => {
        throw new Error("The target store is locked.");
      };
      render(<ComputeSection />);
      await screen.findByTestId("compute-target-t-a");
      const dialog = await chooseHosts("h1");

      await userEvent.click(within(dialog).getByTestId("compute-ssh-import-add"));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Not added: h1. The target store is locked.");
      expect(tested).toEqual([]);
    });
  });

  it("offers a retry when the targets could not be loaded", async () => {
    extra.research_compute_settings = () => {
      throw new Error("The settings could not be read.");
    };
    render(<ComputeSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The settings could not be read.");
    expect(screen.getByTestId("compute-add")).toBeDisabled();

    extra = {};
    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));

    expect(await screen.findByTestId("compute-target-t-a")).toBeTruthy();
    expect(screen.queryByText("The settings could not be read.")).toBeNull();
    expect(screen.getByTestId("compute-add")).toBeEnabled();
  });

  it("warns that tasks waiting to start on a removed target will fail", async () => {
    render(<ComputeSection />);
    const cluster = await screen.findByTestId("compute-target-t-b");
    await userEvent.click(
      within(cluster).getByRole("button", { name: strings.targets.more.replace("{{label}}", "Cluster") }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: strings.targets.remove }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(strings.targets.removeConfirm);
    expect(strings.targets.removeConfirm).toContain("Tasks waiting to start on it will fail.");
  });
});
