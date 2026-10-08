// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDiscordCommunityStatsCache } from "@/lib/community";
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

describe("Settings text selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(undefined);
    mocks.appVersion.mockResolvedValue("0.4.5");
    mocks.libraryRoot.mockResolvedValue("");
    mocks.githubGetPublicRepoStats.mockResolvedValue({ stars: 1, forks: 1 });
    mocks.discordCommunityStats.mockResolvedValue({ online: 1 });
    resetDiscordCommunityStatsCache();
    useSettingsStore.setState({ settingsOpen: true, settingsInitialSection: "help" });
  });

  it("lets people select the content pane, including the version, but not the navigation", async () => {
    render(<SettingsModal />);

    const about = await screen.findByTestId("about-oleafly-section");
    const navigation = screen.getByRole("navigation");

    expect(about.closest(".select-text")).not.toBeNull();
    expect(navigation.closest(".select-text")).toBeNull();
    expect(navigation.querySelector(".select-text")).toBeNull();
  });
});
