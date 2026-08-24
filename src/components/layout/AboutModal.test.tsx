// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appVersion: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/tauri", () => ({ appVersion: mocks.appVersion }));
vi.mock("@/components/layout/UpdateChecker", () => ({
  UpdateChecker: () => <button type="button">Check for updates</button>,
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
    expect(screen.getByText(/open-source workspace for the whole paper/i)).toBeInTheDocument();
    expect(await screen.findByText("Version 0.3.9")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Star on GitHub" }));
    fireEvent.click(screen.getByRole("button", { name: /Discussions/ }));
    fireEvent.click(screen.getByRole("button", { name: /@OleaflyHQ/ }));

    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly");
      expect(mocks.open).toHaveBeenCalledWith(
        "https://github.com/Oleafly/Oleafly/discussions",
      );
      expect(mocks.open).toHaveBeenCalledWith("https://x.com/OleaflyHQ");
    });
  });
});
