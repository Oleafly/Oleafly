// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai/AiToolsList", () => ({
  AiToolsGrid: () => <div data-testid="ai-tools-grid" />,
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useMcpActivityStore } from "@/store/mcp-activity";
import { useSettingsStore } from "@/store/settings";
import { McpActivityPanel } from "./McpActivityPanel";

const copy = enShell.mcpActivity;

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: "project_read",
  status: "ok" as const,
  ts: Date.UTC(2026, 0, 2, 3, 4, 5),
  args: { path: "main.tex" },
  durationMs: 42,
  summary: "read 12 lines",
  ...overrides,
});

beforeEach(() => {
  useMcpActivityStore.setState({ logs: [], serverRunning: false, unread: 3 });
  useSettingsStore.setState({
    settingsInitialSection: "general",
    settingsOpen: false,
    settingsScrollTarget: null,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe("McpActivityPanel", () => {
  it("clears the unread badge on mount and reports the server is off", () => {
    render(<McpActivityPanel />);
    expect(useMcpActivityStore.getState().unread).toBe(0);
    expect(screen.getByText(copy.off)).toBeInTheDocument();
    expect(screen.getByText(copy.serverOff)).toBeInTheDocument();
  });

  it("waits for calls while the server runs", () => {
    useMcpActivityStore.setState({ serverRunning: true });
    render(<McpActivityPanel />);
    expect(screen.getByText(copy.live)).toBeInTheDocument();
    expect(screen.getByText(copy.waiting)).toBeInTheDocument();
    expect(screen.getByText(copy.waitingHint)).toBeInTheDocument();
  });

  it("lists a finished call with its duration, arguments and summary", () => {
    useMcpActivityStore.setState({ serverRunning: true, logs: [entry()] });
    render(<McpActivityPanel />);
    const row = screen.getByTestId("mcp-log-entry");
    expect(row).toHaveTextContent("project_read");
    expect(row).toHaveTextContent("42ms");
    expect(row).toHaveTextContent("read 12 lines");
  });

  it("shows a running and a failed call", () => {
    useMcpActivityStore.setState({
      serverRunning: true,
      logs: [
        entry({ id: 2, status: "running", durationMs: undefined, summary: "" }),
        entry({ id: 3, status: "error", summary: "denied" }),
      ],
    });
    render(<McpActivityPanel />);
    const rows = screen.getAllByTestId("mcp-log-entry");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("denied");
  });

  it("clears the log from its button", async () => {
    useMcpActivityStore.setState({ serverRunning: true, logs: [entry()] });
    render(<McpActivityPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(copy.clearLogAriaLabel));
    await waitFor(() =>
      expect(useMcpActivityStore.getState().logs).toHaveLength(0),
    );
  });

  it("disables the clear button with an empty log", () => {
    render(<McpActivityPanel />);
    expect(screen.getByLabelText(copy.clearLogAriaLabel)).toBeDisabled();
  });

  it("explains the tools available over MCP", async () => {
    render(<McpActivityPanel />);
    const user = userEvent.setup();
    await user.hover(screen.getByLabelText(copy.toolsTitle));
    expect(await screen.findByTestId("ai-tools-grid")).toBeInTheDocument();
  });
});
