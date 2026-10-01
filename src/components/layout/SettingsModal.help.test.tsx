// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISCORD_URL, resetDiscordCommunityStatsCache } from "@/lib/community";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  appVersion: vi.fn(),
  libraryRoot: vi.fn(),
  githubGetPublicRepoStats: vi.fn(),
  discordCommunityStats: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  appVersion: mocks.appVersion,
  libraryRoot: mocks.libraryRoot,
  discordCommunityStats: mocks.discordCommunityStats,
}));
vi.mock("@/components/layout/UpdateChecker", () => ({
  UpdateChecker: () => null,
}));
vi.mock("@/lib/github", () => ({
  githubGetPublicRepoStats: mocks.githubGetPublicRepoStats,
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: "dark",
    theme: "dark",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

import { SettingsModal } from "./SettingsModal";

describe("Settings Help & About support callout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(undefined);
    mocks.appVersion.mockResolvedValue("0.3.6");
    mocks.libraryRoot.mockResolvedValue("");
    mocks.githubGetPublicRepoStats.mockResolvedValue({ stars: 128, forks: 14 });
    mocks.discordCommunityStats.mockResolvedValue({ online: 9 });
    resetDiscordCommunityStatsCache();
    useSettingsStore.setState({
      settingsOpen: true,
      settingsInitialSection: "help",
    });
  });

  it("shows the mascot GitHub message in Help & About", async () => {
    render(<SettingsModal />);

    const aboutHeading = await screen.findByRole("heading", { name: "Oleafly" });
    const aboutSection = screen.getByTestId("about-oleafly-section");
    expect(aboutSection).toHaveClass(
      "grid",
      "grid-cols-[minmax(0,1fr)_auto]",
      "rounded-md",
      "border",
      "p-4",
    );
    expect(aboutSection).toContainElement(aboutHeading);
    // The version arrives from an async call after the heading renders.
    expect(await screen.findByText("v0.3.6")).toBeInTheDocument();
    expect(
      screen.getByText(/Write, compile, proofread, manage citations/),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("128 GitHub stars")).toBeInTheDocument();
    expect(screen.getByLabelText("14 GitHub forks")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Oleafly AI assistant mascot" })).toBeInTheDocument();
    const supportNote = screen.getByRole("note", { name: "Support Oleafly" });
    expect(supportNote).toHaveTextContent(
      "If Oleafly helps your work",
    );
    expect(
      supportNote.compareDocumentPosition(aboutSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Community is Discord and X only: every conversation is pointed at one place.
    expect(screen.getByRole("button", { name: /^Discord/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Discussions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Issues/ })).toBeNull();
    expect(screen.queryByText("@OleaflyHQ")).toBeNull();
    // The citation card closes the page, after Community, Project and Resources.
    const citeCard = screen.getByTestId("cite-oleafly-card");
    expect(
      screen.getByText("Resources").compareDocumentPosition(citeCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(citeCard.parentElement?.lastElementChild).toBe(citeCard);

    fireEvent.click(screen.getByRole("button", { name: "star the project on GitHub" }));

    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly");
    });

    fireEvent.click(screen.getByRole("button", { name: /Follow releases and development/ }));
    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalledWith("https://x.com/OleaflyHQ");
    });
  });

  it("pins community and docs icon links under the navigation, and keeps the Discord row", async () => {
    render(<SettingsModal />);

    const footer = await screen.findByTestId("settings-footer-links");
    const navigation = screen.getByRole("navigation", { name: "Settings sections" });
    expect(navigation).toContainElement(footer);
    // Pinned under the scrolling list, so it stays visible however long the list grows.
    expect(screen.getByTestId("settings-section-scroll")).not.toContainElement(footer);
    // Icons only: the names live in aria-label and the tooltip, never as visible text.
    expect(footer).toHaveTextContent(/^$/);

    const links: [string, string][] = [
      ["Join our Discord", DISCORD_URL],
      ["Follow us on X", "https://x.com/OleaflyHQ"],
      ["Star on GitHub", "https://github.com/Oleafly/Oleafly"],
      ["Documentation", "https://oleafly.com/docs/"],
    ];
    expect(within(footer).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(
      links.map(([label]) => label),
    );
    for (const [label, url] of links) {
      mocks.open.mockClear();
      fireEvent.click(within(footer).getByRole("button", { name: label }));
      await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(url));
    }

    const communityRow = screen.getByRole("button", { name: /Ask questions, report bugs, and share ideas/ });
    expect(await within(communityRow).findByText("9 online")).toBeInTheDocument();
    expect(mocks.discordCommunityStats).toHaveBeenCalledTimes(1);

    mocks.open.mockClear();
    fireEvent.click(communityRow);
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(DISCORD_URL));
  });

  it("marks the active section with a border, not a shadow", () => {
    render(<SettingsModal />);

    const active = screen.getByTestId("settings-section-help");
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("border", "border-border", "bg-background");
    expect(active.className).not.toMatch(/(^|\s)shadow/);
    expect(screen.getByTestId("settings-section-appearance")).toHaveClass("border", "border-transparent");
  });

  it("keeps the settings section list scrollable at larger app font sizes", () => {
    useSettingsStore.setState({
      settingsOpen: true,
      settingsInitialSection: "appearance",
      appFontSize: 20,
    });

    render(<SettingsModal />);

    const sectionList = screen.getByTestId("settings-section-scroll");
    expect(sectionList).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    // The Show Advanced toggle was removed; every section is always listed.
    expect(screen.queryByTestId("settings-toggle-advanced")).toBeNull();
    expect(screen.getByTestId("settings-section-dictionary")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-engine")).toBeInTheDocument();
  });

  it("uses the responsive Settings layout with a height floor", () => {
    render(<SettingsModal />);

    expect(screen.getByRole("dialog", { name: "Settings" })).toHaveClass(
      "w-[min(880px,94vw)]",
      "h-[min(900px,88vh)]",
      "min-h-[min(540px,88vh)]",
    );
  });

  it("does not list MCP as a top-level settings section", () => {
    render(<SettingsModal />);

    const navigation = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(navigation).queryByRole("button", { name: "MCP" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-mcp")).not.toBeInTheDocument();
  });

});

describe("Settings Help & About changelog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(undefined);
    mocks.appVersion.mockResolvedValue("0.3.6");
    mocks.libraryRoot.mockResolvedValue("");
    mocks.githubGetPublicRepoStats.mockResolvedValue({ stars: 128, forks: 14 });
    mocks.discordCommunityStats.mockResolvedValue({ online: 9 });
    resetDiscordCommunityStatsCache();
    useSettingsStore.setState({ settingsOpen: true, settingsInitialSection: "help" });
  });

  it("opens the in-app changelog from the About card and from Resources, never the browser", async () => {
    render(<SettingsModal />);
    fireEvent.click(await screen.findByTestId("about-whats-new"));
    const dialog = await screen.findByRole("dialog", { name: "What's new" });
    expect(await within(dialog).findByTestId("changelog-status")).toHaveTextContent("You're on v0.3.6");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "What's new" })).not.toBeInTheDocument());

    const entries = screen.getAllByRole("button", { name: "What's new" });
    fireEvent.click(entries[entries.length - 1]);
    expect(await screen.findByRole("dialog", { name: "What's new" })).toBeInTheDocument();
    expect(mocks.open).not.toHaveBeenCalledWith(expect.stringContaining("CHANGELOG"));
  });
});
