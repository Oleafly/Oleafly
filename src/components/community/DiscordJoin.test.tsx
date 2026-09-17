// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { DISCORD_URL } from "@/lib/community";

const mocks = vi.hoisted(() => ({ open: vi.fn(), discordCommunityStats: vi.fn() }));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  discordCommunityStats: mocks.discordCommunityStats,
}));

import { DiscordJoinButton, DiscordOnlineCount } from "./DiscordJoin";

describe("DiscordJoinButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(undefined);
  });

  it("is one quiet navigation row that opens the community invite", async () => {
    render(<DiscordJoinButton />);

    const button = screen.getByRole("button", { name: enShell.community.joinDiscord });
    // Rests like its neighbours in the Settings sidebar; Discord's colour is hover and focus only.
    expect(button).toHaveClass("text-muted-foreground", "hover:bg-[#5865F2]", "focus-visible:bg-[#5865F2]");
    expect(button.className).not.toMatch(/(^|\s)bg-\[#5865F2\]/);
    // A plain link: no count, so opening Settings never contacts Discord.
    expect(mocks.discordCommunityStats).not.toHaveBeenCalled();

    fireEvent.click(button);
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(DISCORD_URL));
  });
});

describe("DiscordOnlineCount", () => {
  it("renders the count with a spoken label, and nothing while unknown", () => {
    const { rerender } = render(<DiscordOnlineCount online={null} />);
    expect(screen.queryByTestId("discord-online-count")).toBeNull();

    rerender(<DiscordOnlineCount online={1234} />);
    expect(screen.getByLabelText("1,234 members online on Discord")).toHaveTextContent("1,234 online");
  });
});
