// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  appVersion: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/tauri", () => ({ appVersion: mocks.appVersion }));
vi.mock("@/components/layout/UpdateChecker", () => ({
  UpdateChecker: () => <button type="button">{enShell.updateChecker.check}</button>,
}));

import { AboutModal } from "./AboutModal";

describe("AboutModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appVersion.mockResolvedValue("0.3.9");
    mocks.open.mockResolvedValue(undefined);
  });

  it("presents product and community links from the native About command", async () => {
    render(<AboutModal open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Oleafly" })).toBeInTheDocument();
    expect(screen.getByText(enShell.about.tagline)).toBeInTheDocument();
    expect(
      await screen.findByText(i18n.t(($) => $.shell.about.version, { version: "0.3.9" })),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: enShell.about.star }));
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(enShell.about.links.discussions.label) }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(enShell.about.links.social.label) }),
    );

    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly");
      expect(mocks.open).toHaveBeenCalledWith(
        "https://github.com/Oleafly/Oleafly/discussions",
      );
      expect(mocks.open).toHaveBeenCalledWith("https://x.com/OleaflyHQ");
    });
  });
});
