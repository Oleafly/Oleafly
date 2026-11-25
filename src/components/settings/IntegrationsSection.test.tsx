// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { AppConfig } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { IntegrationsSection } from "./IntegrationsSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/components/settings/git-hosting/GitHostingSection", () => ({
  GitHostingSection: () => <div data-testid="git-hosting-settings-stub" />,
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
  useSettingsStore.setState({ settingsScrollTarget: null, settingsOpen: true });
  Element.prototype.scrollIntoView = vi.fn();
  mockInvoke.mockReset().mockImplementation(async (command) => {
    if (command === "get_config") {
      return {
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
    expect(screen.getByTestId("git-hosting-settings-stub")).toBeInTheDocument();
    expect(screen.getByTestId("integrations-tab-git-hosting")).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Zotero" }));
    expect(screen.getByTestId("zotero-settings-stub")).toBeInTheDocument();
    await user.click(
      screen.getByRole("tab", { name: enSettings.citations.title }),
    );
    expect(
      screen.getByTestId("citation-search-settings-stub"),
    ).toBeInTheDocument();

  });

  it("scrolls the integration tabs inside their own strip", () => {
    render(<IntegrationsSection />);
    const strip = screen.getByRole("tablist");
    expect(strip).toHaveClass("w-fit", "max-w-full", "overflow-x-auto", "no-scrollbar");
    expect(strip).not.toHaveClass("inline-flex");
  });

  it("honors and clears settings deep links", () => {
    useSettingsStore.setState({ settingsScrollTarget: "citation-search" });
    const { rerender } = render(<IntegrationsSection />);
    expect(
      screen.getByTestId("citation-search-settings-stub"),
    ).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();

    useSettingsStore.setState({ settingsScrollTarget: "git-hosting" });
    rerender(<IntegrationsSection />);
    expect(screen.getByTestId("git-hosting-settings-stub")).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();

    useSettingsStore.setState({ settingsScrollTarget: "zotero" });
    rerender(<IntegrationsSection />);
    expect(screen.getByTestId("integrations-tab-zotero")).toHaveAttribute("aria-selected", "true");
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();

    useSettingsStore.setState({ settingsScrollTarget: "zotero" });
    rerender(<IntegrationsSection />);
    useSettingsStore.setState({ settingsScrollTarget: "github" });
    rerender(<IntegrationsSection />);
    expect(screen.getByTestId("git-hosting-settings-stub")).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();


  });

  it("leaves a link set while Settings closes for the next time it opens", () => {
    const { rerender } = render(<IntegrationsSection />);
    useSettingsStore.setState({ settingsOpen: false, settingsScrollTarget: "zotero" });
    rerender(<IntegrationsSection />);
    expect(useSettingsStore.getState().settingsScrollTarget).toBe("zotero");
    expect(screen.getByTestId("integrations-tab-zotero")).toHaveAttribute("aria-selected", "false");

    useSettingsStore.setState({ settingsOpen: true });
    rerender(<IntegrationsSection />);
    expect(screen.getByTestId("integrations-tab-zotero")).toHaveAttribute("aria-selected", "true");
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();
  });
});
