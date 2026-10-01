// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

import type { ToolApprovalRequest } from "@/lib/ai-tools";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { usePersonalDetailsStore } from "@/store/personal-details";
import { ToolConfirm } from "./ToolConfirm";

const COMMAND = "cd /Users/ada/paper && latexmk -pdf main.tex";

const commandRequest = {
  tool: "run_command",
  summary: `$ ${COMMAND}`,
  command: COMMAND,
  cwd: "/Users/ada/paper",
} as ToolApprovalRequest & { command: string; cwd: string };

const mcpRequest = {
  tool: "mcp__files__1a2b3c_read_file",
  summary: "Use read_file from the Files MCP server",
  mcp: {
    server: "Files",
    tool: "read_file",
    argumentsPreview: '{\n  "path": "/Users/ada/paper/refs.bib"\n}',
  },
} as ToolApprovalRequest & {
  mcp: { server: string; tool: string; argumentsPreview: string };
};

function renderCard(req: ToolApprovalRequest) {
  return render(<ToolConfirm req={req} onApprove={vi.fn()} onReject={vi.fn()} />);
}

function marked(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-private]")].map((node) => node.textContent ?? "");
}

beforeEach(() => setDisplayHomes(["/Users/ada"]));

afterEach(() => {
  cleanup();
  act(() => usePersonalDetailsStore.getState().setHidden(false));
  resetDisplayHomes();
});

describe("ToolConfirm home paths", () => {
  it("shows a home path inside the command as ~, like the working directory", () => {
    const { container } = renderCard(commandRequest);
    expect(screen.getByText("cd ~/paper && latexmk -pdf main.tex")).toBeInTheDocument();
    expect(container.textContent).not.toContain("/Users/ada");
  });

  it("marks the path in the command for screenshot mode, and keyboard focus reveals it", () => {
    act(() => usePersonalDetailsStore.getState().setHidden(true));
    const { container } = renderCard(commandRequest);
    const command = container.querySelector("pre") as HTMLElement;
    expect(command).toHaveTextContent("cd ~/paper && latexmk -pdf main.tex");
    const group = command.querySelector("[data-private-group]");
    expect(group).toHaveAttribute("tabindex", "0");
    expect(marked(command)).toEqual(["~/paper"]);
    // The working directory is marked as well.
    expect(marked(container)).toEqual(["~/paper", "~/paper"]);
  });

  it("marks a home path in MCP arguments for screenshot mode", () => {
    act(() => usePersonalDetailsStore.getState().setHidden(true));
    const { container } = renderCard(mcpRequest);
    const args = container.querySelector("pre") as HTMLElement;
    expect(args).toHaveTextContent('"path": "~/paper/refs.bib"');
    expect(marked(args)).toEqual(["~/paper/refs.bib"]);
    expect(container.textContent).not.toContain("/Users/ada");
  });
});
