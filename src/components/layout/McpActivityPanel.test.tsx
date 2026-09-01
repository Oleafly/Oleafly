// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { useSettingsStore } from "@/store/settings";
import { McpActivityPanel } from "./McpActivityPanel";

describe("McpActivityPanel", () => {
  beforeEach(() => {
    useMcpActivityStore.setState({
      logs: [],
      serverRunning: false,
      unread: 0,
    });
    useSettingsStore.setState({
      settingsInitialSection: "general",
      settingsOpen: false,
      settingsScrollTarget: null,
    });
  });

  it("opens the Oleafly MCP server in Integrations when the server is off", () => {
    render(<McpActivityPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open MCP settings" }));

    expect(useSettingsStore.getState()).toMatchObject({
      settingsInitialSection: "integrations",
      settingsScrollTarget: "oleafly-mcp",
      settingsOpen: true,
    });
  });
});
