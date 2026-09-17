// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { DISCORD_URL, resetDiscordCommunityStatsCache } from "@/lib/community";

const mocks = vi.hoisted(() => ({
  appVersion: vi.fn(),
  discordCommunityStats: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/tauri", () => ({
  appVersion: mocks.appVersion,
  discordCommunityStats: mocks.discordCommunityStats,
}));
vi.mock("@/components/layout/UpdateChecker", () => ({
  UpdateChecker: () => <button type="button">{enShell.updateChecker.check}</button>,
}));

import { AboutModal } from "./AboutModal";

describe("AboutModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appVersion.mockResolvedValue("0.3.9");
    mocks.discordCommunityStats.mockResolvedValue({ online: 7 });
    mocks.open.mockResolvedValue(undefined);
    resetDiscordCommunityStatsCache();
  });

  it("presents product and community links from the native About command", async () => {
    render(<AboutModal open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Oleafly" })).toBeInTheDocument();
    expect(screen.getByText(enShell.about.tagline)).toBeInTheDocument();
    expect(
      await screen.findByText(i18n.t(($) => $.shell.about.version, { version: "0.3.9" })),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: enShell.about.star }));
    // Conversation lives on Discord now, so the GitHub Discussions and Issues links are gone.
    expect(screen.queryByRole("button", { name: /Discussions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Issues/ })).toBeNull();
    expect(await screen.findByLabelText("7 members online on Discord")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("about-join-discord"));
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(enShell.about.links.social.description) }),
    );

    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly");
      expect(mocks.open).toHaveBeenCalledWith(DISCORD_URL);
      expect(mocks.open).toHaveBeenCalledWith("https://x.com/OleaflyHQ");
    });
  });
});
