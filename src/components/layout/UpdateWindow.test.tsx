// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUpdate: vi.fn(),
  installUpdate: vi.fn(),
  isDownloadStalled: vi.fn(),
  close: vi.fn(),
  invoke: vi.fn(),
  openUrl: vi.fn(),
  logError: vi.fn(),
  celebrate: vi.fn(),
  appVersion: vi.fn(),
}));

vi.mock("@/lib/updater", () => ({
  findUpdate: mocks.findUpdate,
  installUpdate: mocks.installUpdate,
  isDownloadStalled: mocks.isDownloadStalled,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: mocks.close }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.openUrl }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/confetti", () => ({ celebrate: mocks.celebrate }));
vi.mock("@/lib/tauri", () => ({ appVersion: mocks.appVersion }));

import { UpdateWindow } from "./UpdateWindow";

describe("UpdateWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appVersion.mockResolvedValue("0.3.13");
    mocks.invoke.mockResolvedValue(true);
    mocks.openUrl.mockResolvedValue(undefined);
    mocks.logError.mockResolvedValue(undefined);
    mocks.isDownloadStalled.mockReturnValue(false);
    mocks.findUpdate.mockResolvedValue({
      version: "0.3.14",
      currentVersion: "0.3.13",
      body: "notes",
    });
  });

  it("hides the close button only while the download is healthy", async () => {
    let finish!: () => void;
    mocks.installUpdate.mockImplementation(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    render(<UpdateWindow />);

    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Downloading/)).toBeInTheDocument();
    finish();
  });

  it("offers a way out when the download stalls", async () => {
    mocks.installUpdate.mockRejectedValue(new Error("stalled"));
    mocks.isDownloadStalled.mockReturnValue(true);
    render(<UpdateWindow />);

    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));

    expect(await screen.findByText("Download stalled")).toBeInTheDocument();
    expect(screen.getByText(/The download stopped responding/)).toBeInTheDocument();

    const closers = screen.getAllByRole("button", { name: "Close" });
    expect(closers).toHaveLength(2);
    for (const closer of closers) {
      fireEvent.click(closer);
      expect(mocks.close).toHaveBeenCalled();
      mocks.close.mockClear();
    }

    fireEvent.click(screen.getByRole("button", { name: "View release" }));
    await waitFor(() => {
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://github.com/Oleafly/Oleafly/releases/latest",
      );
    });
  });

  it("keeps the generic error screen for a failure that is not a stall", async () => {
    mocks.installUpdate.mockRejectedValue(new Error("network down"));
    render(<UpdateWindow />);

    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));

    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText("Download stalled")).not.toBeInTheDocument();
  });
});
