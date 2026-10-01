// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

import type { ToolApprovalRequest } from "@/lib/ai-tools";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
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

beforeEach(() => setDisplayHomes(["/Users/ada"]));

afterEach(() => {
  cleanup();
  resetDisplayHomes();
});

describe("ToolConfirm home paths", () => {
  it("shows a home path inside the command as ~, like the working directory", () => {
    const { container } = renderCard(commandRequest);
    expect(screen.getByText("cd ~/paper && latexmk -pdf main.tex")).toBeInTheDocument();
    expect(container.textContent).not.toContain("/Users/ada");
  });

  it("shows a home path in MCP arguments as ~, with no blur", () => {
    const { container } = renderCard(mcpRequest);
    const args = container.querySelector("pre") as HTMLElement;
    expect(args).toHaveTextContent('"path": "~/paper/refs.bib"');
    expect(container.textContent).not.toContain("/Users/ada");
    // Only Settings blurs paths.
    expect(container.querySelector("[data-settings-path]")).toBeNull();
  });
});
