// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class UpdateDownloadStalledError extends Error {
    constructor() {
      super("The update download stopped responding");
      this.name = "UpdateDownloadStalledError";
    }
  }
  return {
    runUpdateCheck: vi.fn(),
    installUpdate: vi.fn(),
    UpdateDownloadStalledError,
    open: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/updater", () => ({
  runUpdateCheck: mocks.runUpdateCheck,
  installUpdate: mocks.installUpdate,
  UpdateDownloadStalledError: mocks.UpdateDownloadStalledError,
}));
vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { UpdateChecker } from "./UpdateChecker";

const UPDATE = { version: "0.4.0", currentVersion: "0.3.13", body: "" };

async function reachUpdateAvailable() {
  render(<UpdateChecker />);
  mocks.runUpdateCheck.mockResolvedValue(UPDATE);
  fireEvent.click(screen.getByRole("button", { name: /Check for updates/ }));
  return screen.findByRole("button", { name: "Update now" });
}

describe("UpdateChecker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names a stalled download instead of a generic failure", async () => {
    const install = await reachUpdateAvailable();
    mocks.installUpdate.mockRejectedValue(new mocks.UpdateDownloadStalledError());

    fireEvent.click(install);

    expect(
      await screen.findByText(
        "The download stopped responding. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the generic wording for any other failure", async () => {
    const install = await reachUpdateAvailable();
    mocks.installUpdate.mockRejectedValue(new Error("disk full"));

    fireEvent.click(install);

    expect(await screen.findByText("Couldn't check for updates.")).toBeInTheDocument();
  });

  it("offers a retry and a manual download after a stall", async () => {
    const install = await reachUpdateAvailable();
    mocks.installUpdate.mockRejectedValue(new mocks.UpdateDownloadStalledError());

    fireEvent.click(install);
    await screen.findByText(/stopped responding/);

    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download from GitHub/ })).toBeInTheDocument();
  });
});
