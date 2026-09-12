// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
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
      await screen.findByRole("heading", { name: enSettings.mcp.section.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: enSettings.mcp.section.enable.ariaLabel }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Assistant MCP" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: enSettings.mcp.servers.title }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-pane-tab-strip")).not.toBeInTheDocument();
  });

  it("fits client tabs in one scrollable row and reveals the selected tab", async () => {
    const user = userEvent.setup();
    render(<McpSection />);

    await screen.findByRole("heading", { name: enSettings.mcp.section.title });

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

const mcpCopy = enSettings.mcp.section;
const RUNNING = {
  running: true,
  port: 5323,
  url: "http://127.0.0.1:5323/mcp",
  enabled: true,
};

const STOPPED = { running: false, port: null, url: null, enabled: false };

function backend(overrides: Record<string, unknown> = {}) {
  let running = false;
  mockInvoke.mockReset().mockImplementation(async (command, args) => {
    if (command in overrides) {
      const value = overrides[command as keyof typeof overrides];
      if (value instanceof Error) throw value;
      return value;
    }
    if (command === "get_config") {
      return {
        mcp_enabled: false,
        mcp_port: 5323,
        mcp_read_only: true,
        mcp_approval_policy: "ask",
        mcp_servers: [],
      } as unknown as AppConfig;
    }
    if (command === "mcp_status") return running ? RUNNING : STOPPED;
    if (command === "mcp_servers_list") return [];
    if (command === "set_config") return null;
    if (command === "mcp_connection_info") return { token: "secret-token", url: RUNNING.url };
    if (command === "mcp_set_enabled") {
      running = Boolean((args as { enabled: boolean }).enabled);
      return running ? RUNNING : STOPPED;
    }
    if (command === "mcp_restart_server") return RUNNING;
    if (command === "mcp_regenerate_token") return null;
    throw new Error(`Unexpected command: ${command}`);
  });
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("McpSection server controls", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    backend();
  });

  it("waits for the config before drawing the controls", () => {
    let release: (value: unknown) => void = () => {};
    mockInvoke.mockReset().mockImplementation(async (command) => {
      if (command === "get_config") {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return { running: false, port: null, url: null, enabled: false };
    });
    render(<McpSection />);

    expect(screen.getByTestId("oleafly-mcp-server")).toHaveTextContent(
      enCommon.state.loading,
    );
    release({ mcp_enabled: false, mcp_port: 5323, mcp_approval_policy: "ask" });
  });

  it("reports the server as off and turns it on", async () => {
    const user = userEvent.setup();
    render(<McpSection />);

    const toggle = await screen.findByTestId("mcp-enable-toggle");
    expect(screen.getByTestId("mcp-status")).toHaveTextContent(enCommon.state.off);
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    await waitFor(() =>
      expect(screen.getByTestId("mcp-status")).toHaveTextContent(
        mcpCopy.status.runningAt.replace("{{url}}", RUNNING.url),
      ),
    );
    expect(mockInvoke).toHaveBeenCalledWith("mcp_set_enabled", { enabled: true });
  });

  it("turns the server off again with the keyboard", async () => {
    const user = userEvent.setup();
    backend({
      get_config: {
        mcp_enabled: true,
        mcp_port: 5323,
        mcp_read_only: false,
        mcp_approval_policy: "ask",
        mcp_servers: [],
      } as unknown as AppConfig,
      mcp_status: RUNNING,
      mcp_set_enabled: STOPPED,
    });
    render(<McpSection />);

    const toggle = await screen.findByTestId("mcp-enable-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    toggle.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("mcp_set_enabled", { enabled: false }),
    );
  });

  it("reports a server that will not start", async () => {
    const user = userEvent.setup();
    backend({ mcp_set_enabled: new Error("port in use") });
    render(<McpSection />);

    await user.click(await screen.findByTestId("mcp-enable-toggle"));
    expect(await screen.findByText(/port in use/u)).toBeInTheDocument();
  });

  it("restarts a running server and confirms the new address", async () => {
    const user = userEvent.setup();
    backend({ mcp_status: RUNNING });
    render(<McpSection />);

    await screen.findByTestId("mcp-status");
    await user.click(
      screen.getByRole("button", { name: mcpCopy.port.restartAriaLabel }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("mcp-status")).toHaveTextContent(
        mcpCopy.status.restartedAt.replace("{{url}}", RUNNING.url),
      ),
    );
    expect(screen.getByLabelText(mcpCopy.port.ariaLabel)).toHaveValue("5323");
  });

  it("reports a restart that fails", async () => {
    const user = userEvent.setup();
    backend({ mcp_status: RUNNING, mcp_restart_server: new Error("bind refused") });
    render(<McpSection />);

    await screen.findByTestId("mcp-status");
    await user.click(
      screen.getByRole("button", { name: mcpCopy.port.restartAriaLabel }),
    );
    expect(await screen.findByText(/bind refused/u)).toBeInTheDocument();
  });

  it("writes the approval policy and the read-only switch back", async () => {
    const user = userEvent.setup();
    render(<McpSection />);

    await screen.findByText(mcpCopy.policy.legend);
    expect(screen.getByText(mcpCopy.policy.ask.description)).toBeInTheDocument();
    expect(screen.getByText(mcpCopy.policy.autoWrites.description)).toBeInTheDocument();
    expect(screen.getByText(mcpCopy.policy.trust.description)).toBeInTheDocument();

    await user.click(screen.getByTestId("mcp-policy-trust"));
    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.some(
          ([command, args]) =>
            command === "set_config" &&
            (args as { config: AppConfig }).config.mcp_approval_policy === "trust",
        ),
      ).toBe(true),
    );

    const readOnly = screen.getByRole("switch", { name: mcpCopy.readOnly.ariaLabel });
    expect(readOnly).toHaveAttribute("aria-checked", "true");
    await user.click(readOnly);
    await waitFor(() => expect(readOnly).toHaveAttribute("aria-checked", "false"));
  });

  it("reports a policy write that fails", async () => {
    const user = userEvent.setup();
    backend({ set_config: new Error("config locked") });
    render(<McpSection />);

    await screen.findByText(mcpCopy.policy.legend);
    await user.click(screen.getByTestId("mcp-policy-auto-writes"));
    expect(await screen.findByText(/config locked/u)).toBeInTheDocument();
  });

  it("reveals, hides, and copies the bearer token", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    backend({ mcp_status: RUNNING });
    render(<McpSection />);

    await screen.findByText(mcpCopy.token.label);
    await user.click(screen.getByRole("button", { name: mcpCopy.token.reveal }));
    expect(await screen.findByText("secret-token")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: mcpCopy.token.hide }));
    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("mcp-copy-token"));
    expect(writeText).toHaveBeenCalledWith("secret-token");
    expect(
      await screen.findAllByRole("button", { name: enCommon.actions.copied }),
    ).not.toHaveLength(0);

    await user.click(screen.getByTestId("mcp-copy-url"));
    expect(writeText).toHaveBeenCalledWith(RUNNING.url);
  });

  it("refuses to reveal a token while the server is off", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<McpSection />);

    await screen.findByText(mcpCopy.token.label);
    const reveal = screen.getByRole("button", { name: mcpCopy.token.reveal });
    expect(reveal).toBeDisabled();
    expect(screen.getAllByText(mcpCopy.token.enableToView).length).toBeGreaterThan(0);
    await user.click(screen.getByTestId("mcp-copy-url"));
    expect(writeText).toHaveBeenCalled();
  });

  it("regenerates the token behind a confirmation", async () => {
    const user = userEvent.setup();
    backend({ mcp_status: RUNNING });
    render(<McpSection />);

    await screen.findByText(mcpCopy.token.label);
    await user.click(screen.getByRole("button", { name: mcpCopy.token.regenerate }));
    expect(screen.getByText(mcpCopy.token.regenerateWarning)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(screen.queryByText(mcpCopy.token.regenerateWarning)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: mcpCopy.token.regenerate }));
    await user.click(screen.getByRole("button", { name: enCommon.actions.confirm }));
    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.some(([command]) => command === "mcp_regenerate_token"),
      ).toBe(true),
    );
  });

  it("reports a regeneration that fails", async () => {
    const user = userEvent.setup();
    backend({ mcp_status: RUNNING, mcp_regenerate_token: new Error("keyring locked") });
    render(<McpSection />);

    await screen.findByText(mcpCopy.token.label);
    await user.click(screen.getByRole("button", { name: mcpCopy.token.regenerate }));
    await user.click(screen.getByRole("button", { name: enCommon.actions.confirm }));
    expect(await screen.findByText(/keyring locked/u)).toBeInTheDocument();
  });

  it("stays on the loading state when the config cannot be read", async () => {
    backend({ get_config: new Error("no config file") });
    render(<McpSection />);

    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.some(([command]) => command === "get_config"),
      ).toBe(true),
    );
    expect(screen.getByTestId("oleafly-mcp-server")).toHaveTextContent(
      enCommon.state.loading,
    );
  });

  it("highlights a client snippet for every supported client", async () => {
    const user = userEvent.setup();
    backend({ mcp_status: RUNNING });
    render(<McpSection />);

    await screen.findByText(mcpCopy.clients.title);
    for (const testId of [
      "mcp-tab-claude-desktop",
      "mcp-tab-cursor",
      "mcp-tab-codex",
      "mcp-tab-grok",
      "mcp-tab-claude-code",
    ]) {
      await user.click(screen.getByTestId(testId));
      await waitFor(() =>
        expect(screen.getByTestId(testId)).toHaveAttribute("aria-selected", "true"),
      );
    }
    expect(screen.getByText(mcpCopy.footer)).toBeInTheDocument();
  });
});
