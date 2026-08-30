// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
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

  it("shows outbound server management alongside the existing Oleafly server controls", async () => {
    render(<McpSection />);

    expect(await screen.findByRole("heading", { name: "Assistant MCP servers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Oleafly MCP server" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable MCP server" })).toBeInTheDocument();
  });
});
