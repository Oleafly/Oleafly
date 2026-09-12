// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { AppConfig } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { IntegrationsSection } from "./IntegrationsSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/mcp-bridge", () => ({
  refreshMcpRegistry: vi.fn(),
  revokeMcpBridgeCalls: vi.fn(),
}));
vi.mock("@/components/settings/GitHubSection", () => ({
  GitHubSection: () => <div data-testid="github-settings-stub" />,
}));
vi.mock("@/components/settings/AlphaXivSection", () => ({
  AlphaXivSection: () => <div data-testid="alphaxiv-settings-stub" />,
}));
vi.mock("@/components/settings/ZoteroSection", () => ({
  ZoteroSection: () => <div data-testid="zotero-settings-stub" />,
}));
vi.mock("@/components/settings/CitationSearchIntegrationSection", () => ({
  CitationSearchIntegrationSection: () => (
    <div data-testid="citation-search-settings-stub" />
  ),
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  useSettingsStore.setState({ settingsScrollTarget: null });
  Element.prototype.scrollIntoView = vi.fn();
  mockInvoke.mockReset().mockImplementation(async (command) => {
    if (command === "get_config") {
      return {
        mcp_enabled: false,
        mcp_port: 5323,
        mcp_read_only: false,
        mcp_approval_policy: "ask",
      } as unknown as AppConfig;
    }
    if (command === "mcp_status") {
      return { running: false, port: null, url: null, enabled: false };
    }
    throw new Error(`Unexpected command: ${command}`);
  });
});

describe("IntegrationsSection", () => {
  it("switches between every integration", async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection />);
    expect(screen.getByTestId("github-settings-stub")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "alphaXiv" }));
    expect(screen.getByTestId("alphaxiv-settings-stub")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Zotero" }));
    expect(screen.getByTestId("zotero-settings-stub")).toBeInTheDocument();
    await user.click(
      screen.getByRole("tab", { name: enSettings.citations.title }),
    );
    expect(
      screen.getByTestId("citation-search-settings-stub"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Oleafly MCP" }));
    expect(
      await screen.findByRole("heading", { name: enSettings.mcp.section.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: enSettings.mcp.section.enable.ariaLabel }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "GitHub" }));
    await user.click(screen.getByRole("tab", { name: "Oleafly MCP" }));
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "get_config"),
    ).toHaveLength(1);
  });

  it("honors and clears settings deep links", () => {
    useSettingsStore.setState({ settingsScrollTarget: "citation-search" });
    const { rerender } = render(<IntegrationsSection />);
    expect(
      screen.getByTestId("citation-search-settings-stub"),
    ).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();

    useSettingsStore.setState({ settingsScrollTarget: "github" });
    rerender(<IntegrationsSection />);
    expect(screen.getByTestId("github-settings-stub")).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();

    useSettingsStore.setState({ settingsScrollTarget: "oleafly-mcp" });
    rerender(<IntegrationsSection />);
    expect(screen.getByRole("tab", { name: "Oleafly MCP" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();
    return waitFor(() => {
      expect(
        screen.getByRole("heading", { name: enSettings.mcp.section.title }),
      ).toBeInTheDocument();
    });
  });
});
