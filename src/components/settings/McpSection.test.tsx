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

  it("renders the Oleafly MCP server controls directly", async () => {
    render(<McpSection />);

    expect(
      await screen.findByRole("heading", { name: "Oleafly MCP server" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable MCP server" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Assistant MCP" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Assistant MCP servers" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-pane-tab-strip")).not.toBeInTheDocument();
  });

  it("fits client tabs in one scrollable row and reveals the selected tab", async () => {
    const user = userEvent.setup();
    render(<McpSection />);

    await screen.findByRole("heading", { name: "Oleafly MCP server" });

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

});
