// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
  mcpServersList: vi.fn(),
  mcpServerAdd: vi.fn(),
  mcpServerUpdateValidated: vi.fn(),
  mcpServerRemove: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  getConnectorKey: mocks.getConnectorKey,
  setConnectorKey: mocks.setConnectorKey,
  mcpServersList: mocks.mcpServersList,
  mcpServerAdd: mocks.mcpServerAdd,
  mcpServerUpdateValidated: mocks.mcpServerUpdateValidated,
  mcpServerRemove: mocks.mcpServerRemove,
}));
vi.mock("@/lib/mcp-agent-tools", () => ({ notifyMcpAgentToolsChanged: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useAlphaXivConnectorStore } from "@/store/alphaxiv-connector";
import { AlphaXivSection } from "./AlphaXivSection";

const alphaxiv = enSettings.integrations.alphaxiv;
const actions = enSettings.integrations.actions;

const managed = (config: McpServerConfig) => ({
  config,
  validation: { name: config.name, status: "connected", tools: [], error: null },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectorKey.mockResolvedValue("");
  mocks.setConnectorKey.mockResolvedValue(undefined);
  mocks.mcpServersList.mockResolvedValue([]);
  mocks.mcpServerAdd.mockImplementation(async (config: McpServerConfig) => managed(config));
  mocks.mcpServerRemove.mockResolvedValue(undefined);
  useAlphaXivConnectorStore.setState({
    connected: false,
    loading: false,
    failure: null,
    serverName: null,
  });
});

describe("AlphaXivSection", () => {
  it("asks for a key and links to alphaXiv and its MCP docs", async () => {
    render(<AlphaXivSection />);

    expect(await screen.findByText(alphaxiv.description)).toBeInTheDocument();
    expect(screen.getByLabelText(alphaxiv.apiKeyLabel)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "alphaxiv.org" })).toHaveAttribute(
      "href",
      "https://www.alphaxiv.org",
    );
    expect(screen.getByRole("link", { name: "MCP server" })).toHaveAttribute(
      "href",
      "https://www.alphaxiv.org/docs/mcp",
    );
    expect(screen.queryByText(/axv1_/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: actions.connect })).toBeDisabled();
  });

  it("connects with a trimmed key, clears the field and says the assistant asks first", async () => {
    const user = userEvent.setup();
    render(<AlphaXivSection />);

    await user.type(await screen.findByLabelText(alphaxiv.apiKeyLabel), " axv2_key ");
    await user.click(screen.getByRole("button", { name: actions.connect }));

    await waitFor(() =>
      expect(mocks.mcpServerAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://api.alphaxiv.org/mcp/v1",
          headers: { Authorization: "Bearer axv2_key" },
        }),
      ),
    );
    expect(await screen.findByText(alphaxiv.connected)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: actions.disconnect })).toBeInTheDocument();
    expect(screen.queryByLabelText(alphaxiv.apiKeyLabel)).not.toBeInTheDocument();
  });

  it("keeps the key in the field and explains when alphaXiv refuses it", async () => {
    mocks.mcpServerAdd.mockRejectedValue(new Error("HTTP 401"));
    const user = userEvent.setup();
    render(<AlphaXivSection />);

    const field = await screen.findByLabelText(alphaxiv.apiKeyLabel);
    await user.type(field, "wrong{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(alphaxiv.connectFailed);
    expect(field).toHaveValue("wrong");
    expect(screen.queryByText(alphaxiv.connected)).not.toBeInTheDocument();
  });

  it("disconnects by removing the alphaXiv MCP server", async () => {
    mocks.mcpServersList.mockResolvedValue([
      managed({
        name: "alphaXiv",
        enabled: true,
        transport: "remote",
        url: "https://api.alphaxiv.org/mcp/v1",
        headers: {},
      }),
    ]);
    const user = userEvent.setup();
    render(<AlphaXivSection />);

    await user.click(await screen.findByRole("button", { name: actions.disconnect }));
    await waitFor(() => expect(mocks.mcpServerRemove).toHaveBeenCalledWith("alphaXiv"));
    expect(await screen.findByLabelText(alphaxiv.apiKeyLabel)).toBeInTheDocument();
  });
});
