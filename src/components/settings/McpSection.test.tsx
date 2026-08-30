// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";
import { McpSection } from "./McpSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/mcp-bridge", () => ({
  refreshMcpRegistry: vi.fn(),
  revokeMcpBridgeCalls: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("McpSection", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    mockInvoke.mockReset().mockImplementation(async (command) => {
      if (command === "get_config") {
        return {
          mcp_enabled: false,
          mcp_port: 5323,
          mcp_read_only: true,
          mcp_approval_policy: "ask",
          mcp_servers: [],
        } as unknown as AppConfig;
      }
      if (command === "mcp_status") {
        return { running: false, port: null, url: null, enabled: false };
      }
      if (command === "mcp_servers_list") return [];
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("separates Assistant and Oleafly MCP settings into switchable tabs", async () => {
    const user = userEvent.setup();
    render(<McpSection />);

    const assistantTab = await screen.findByRole("tab", { name: "Assistant MCP" });
    const oleaflyTab = screen.getByRole("tab", { name: "Oleafly MCP" });
    const tabStrip = screen.getByTestId("mcp-pane-tab-strip");

    expect(tabStrip).toHaveClass(
      "w-fit",
      "max-w-full",
      "overflow-x-auto",
      "no-scrollbar",
    );
    expect(tabStrip).not.toHaveClass("w-full");
    expect(assistantTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Assistant MCP servers" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Oleafly MCP server" })).not.toBeInTheDocument();

    await user.click(oleaflyTab);

    await waitFor(() => expect(oleaflyTab).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("heading", { name: "Assistant MCP servers" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Oleafly MCP server" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable MCP server" })).toBeInTheDocument();
  });

  it("fits client tabs in one scrollable row and reveals the selected tab", async () => {
    const user = userEvent.setup();
    render(<McpSection />);

    await user.click(await screen.findByRole("tab", { name: "Oleafly MCP" }));

    const tabStrip = screen.getByTestId("mcp-client-tab-strip");
    expect(tabStrip).toHaveClass(
      "flex",
      "flex-nowrap",
      "w-fit",
      "max-w-full",
      "overflow-x-auto",
      "no-scrollbar",
    );
    expect(tabStrip).not.toHaveClass("w-full");

    const cursorTab = screen.getByRole("tab", { name: "Cursor" });
    const scrollIntoView = vi.fn();
    cursorTab.scrollIntoView = scrollIntoView;
    await user.click(cursorTab);

    await waitFor(() => expect(cursorTab).toHaveAttribute("aria-selected", "true"));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("keeps server manager state mounted while switching MCP tabs", async () => {
    const user = userEvent.setup();
    render(<McpSection />);

    await screen.findByText("No servers added.");
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "mcp_servers_list"),
    ).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "Oleafly MCP" }));
    await user.click(screen.getByRole("tab", { name: "Assistant MCP" }));
    await screen.findByText("No servers added.");

    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "mcp_servers_list"),
    ).toHaveLength(1);
  });
});
