// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { IntegrationsSection } from "./IntegrationsSection";

vi.mock("@/components/settings/GitHubSection", () => ({
  GitHubSection: () => <div>GitHub settings</div>,
}));
vi.mock("@/components/settings/AlphaXivSection", () => ({
  AlphaXivSection: () => <div>alphaXiv settings</div>,
}));
vi.mock("@/components/settings/ZoteroSection", () => ({
  ZoteroSection: () => <div>Zotero settings</div>,
}));
vi.mock("@/components/settings/CitationSearchIntegrationSection", () => ({
  CitationSearchIntegrationSection: () => <div>Citation Search settings</div>,
}));

beforeEach(() => {
  useSettingsStore.setState({ settingsScrollTarget: null });
});

describe("IntegrationsSection", () => {
  it("switches between every integration", async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection />);
    expect(screen.getByText("GitHub settings")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "alphaXiv" }));
    expect(screen.getByText("alphaXiv settings")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Zotero" }));
    expect(screen.getByText("Zotero settings")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Citation Search" }));
    expect(screen.getByText("Citation Search settings")).toBeInTheDocument();
  });

  it("honors and clears settings deep links", () => {
    useSettingsStore.setState({ settingsScrollTarget: "citation-search" });
    const { rerender } = render(<IntegrationsSection />);
    expect(screen.getByText("Citation Search settings")).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();

    useSettingsStore.setState({ settingsScrollTarget: "github" });
    rerender(<IntegrationsSection />);
    expect(screen.getByText("GitHub settings")).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();
  });
});
