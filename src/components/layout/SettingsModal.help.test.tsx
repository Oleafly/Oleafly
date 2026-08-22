// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  appVersion: vi.fn(),
  libraryRoot: vi.fn(),
  githubGetPublicRepoStats: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  appVersion: mocks.appVersion,
  libraryRoot: mocks.libraryRoot,
}));
vi.mock("@/components/layout/UpdateChecker", () => ({
  UpdateChecker: () => null,
}));
vi.mock("@/lib/github", () => ({
  githubGetPublicRepoStats: mocks.githubGetPublicRepoStats,
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
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
    useSettingsStore.setState({
      settingsOpen: true,
      settingsInitialSection: "help",
    });
  });

  it("shows the mascot GitHub message in Help & About", async () => {
    render(<SettingsModal />);

    const aboutHeading = await screen.findByRole("heading", { name: "Oleafly" });
    const aboutSection = screen.getByTestId("about-oleafly-section");
    expect(aboutSection).toHaveClass("rounded-md", "border", "p-4");
    expect(aboutSection).toContainElement(aboutHeading);
    expect(screen.getByText("v0.3.6")).toBeInTheDocument();
    expect(
      screen.getByText("An open-source modern workspace for all your research work."),
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

    fireEvent.click(screen.getByRole("button", { name: "starring the project on GitHub" }));

    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly");
    });
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
    expect(sectionList).not.toContainElement(
      screen.getByTestId("settings-toggle-advanced"),
    );
  });
});
