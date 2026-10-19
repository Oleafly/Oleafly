// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearch from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { SandboxStatus } from "./compute-api";
import { checkProblem, ComputeSandboxCard } from "./ComputeSandboxCard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const strings = enResearch.compute.sandbox;

function status(patch: Partial<SandboxStatus> = {}): SandboxStatus {
  return {
    platform: "macos",
    available: true,
    reason: null,
    windowsEnabled: null,
    runtimes: [
      {
        kind: "python",
        executable: "/usr/local/bin/python3",
        prefix: "/usr/local",
        source: "path",
        note: null,
      },
      {
        kind: "node",
        executable: "/usr/local/bin/node",
        prefix: "/usr/local",
        source: "path",
        note: "Node.js can hang in the Windows sandbox when it starts other programs.",
      },
    ],
    grants: [],
    ...patch,
  };
}

let current: SandboxStatus;

describe("ComputeSandboxCard", () => {
  beforeEach(() => {
    current = status();
    mockInvoke.mockReset().mockImplementation(async (command, args) => {
      switch (command) {
        case "research_sandbox_status":
          return current;
        case "research_sandbox_set_windows":
          current = { ...current, windowsEnabled: (args as { enabled: boolean }).enabled };
          return current;
        case "research_sandbox_remove_access":
          current = { ...current, grants: [] };
          return current;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });
  });

  it("offers the Windows beta switch only on Windows", async () => {
    const { unmount } = render(<ComputeSandboxCard />);
    await screen.findByTestId("compute-sandbox");
    expect(screen.queryByTestId("compute-sandbox-windows")).toBeNull();
    unmount();
    current = status({ platform: "windows", windowsEnabled: false });
    render(<ComputeSandboxCard />);
    const toggle = await screen.findByTestId("compute-sandbox-windows");
    expect(screen.getByTestId("beta-badge")).toBeTruthy();
    await userEvent.click(toggle);
    expect(mockInvoke).toHaveBeenCalledWith("research_sandbox_set_windows", { enabled: true });
  });

  it("lists interpreters with their notes and refreshes on demand", async () => {
    render(<ComputeSandboxCard />);
    await screen.findByTestId("compute-sandbox-runtimes");
    expect(screen.getByText(/can hang in the Windows sandbox/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: strings.refresh }));
    expect(mockInvoke).toHaveBeenCalledWith("research_sandbox_status", { refresh: true });
  });

  it("confirms before removing sandbox access", async () => {
    current = status({
      platform: "windows",
      windowsEnabled: true,
      grants: [{ path: "C:\\Users\\a\\miniconda3", scope: "runtimes", project: null }],
    });
    render(<ComputeSandboxCard />);
    await userEvent.click(await screen.findByTestId("compute-sandbox-remove-access"));
    expect(mockInvoke).not.toHaveBeenCalledWith("research_sandbox_remove_access");
    const buttons = await screen.findAllByRole("button", { name: strings.removeAccess });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("research_sandbox_remove_access"));
  });

  it("does not count expected failures as a broken sandbox", () => {
    const base = { platform: "windows", available: true, reason: null, privileges: null };
    expect(
      checkProblem({
        ...base,
        checks: [
          { id: "launch", ok: true, expected: "runs", detail: "" },
          { id: "python_multiprocessing", ok: false, expected: "fails", detail: "pipe refused" },
        ],
      }),
    ).toBeNull();
    expect(
      checkProblem({ ...base, checks: [{ id: "deny_outside_write", ok: false, expected: "denied", detail: "wrote" }] }),
    ).toBe("deny_outside_write: wrote");
  });
});
