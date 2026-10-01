// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiscordOnlineCount } from "./DiscordJoin";

describe("DiscordOnlineCount", () => {
  it("renders the count with a spoken label, and nothing while unknown", () => {
    const { rerender } = render(<DiscordOnlineCount online={null} />);
    expect(screen.queryByTestId("discord-online-count")).toBeNull();

    rerender(<DiscordOnlineCount online={1234} />);
    expect(screen.getByLabelText("1,234 members online on Discord")).toHaveTextContent("1,234 online");
  });
});
