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
    findUpdate: vi.fn(),
    installUpdate: vi.fn(),
    UpdateDownloadStalledError,
    close: vi.fn(),
    invoke: vi.fn(),
    appVersion: vi.fn(),
    celebrate: vi.fn(),
    open: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: mocks.close }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/tauri", () => ({ appVersion: mocks.appVersion }));
vi.mock("@/lib/confetti", () => ({ celebrate: mocks.celebrate }));
vi.mock("@/lib/updater", () => ({
  findUpdate: mocks.findUpdate,
  installUpdate: mocks.installUpdate,
  UpdateDownloadStalledError: mocks.UpdateDownloadStalledError,
}));
vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("@/components/layout/LeafLogo", () => ({
  LeafLogo: () => <span />,
}));

import { UpdateWindow } from "./UpdateWindow";

describe("UpdateWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(true);
    mocks.appVersion.mockResolvedValue("0.3.13");
    mocks.findUpdate.mockResolvedValue({
      version: "0.4.0",
      currentVersion: "0.3.13",
      body: "",
    });
  });

  it("names a stalled download instead of a generic failure", async () => {
    render(<UpdateWindow />);
    const install = await screen.findByRole("button", { name: "Update now" });
    mocks.installUpdate.mockRejectedValue(new mocks.UpdateDownloadStalledError());

    fireEvent.click(install);

    expect(
      await screen.findByText(
        "The download stopped responding. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the generic wording for any other failure", async () => {
    render(<UpdateWindow />);
    const install = await screen.findByRole("button", { name: "Update now" });
    mocks.installUpdate.mockRejectedValue(new Error("signature mismatch"));

    fireEvent.click(install);

    expect(
      await screen.findByText("Something went wrong. Please try again later."),
    ).toBeInTheDocument();
  });

  it("lets the user out of a stalled download", async () => {
    render(<UpdateWindow />);
    const install = await screen.findByRole("button", { name: "Update now" });
    mocks.installUpdate.mockRejectedValue(new mocks.UpdateDownloadStalledError());

    fireEvent.click(install);
    await screen.findByText(/stopped responding/);

    const dismiss = screen.getAllByRole("button", { name: "Close" });
    expect(dismiss).toHaveLength(2);
    fireEvent.click(dismiss[dismiss.length - 1]);
    expect(mocks.close).toHaveBeenCalled();
  });

  it("hides every dismiss control only while bytes are still moving", async () => {
    render(<UpdateWindow />);
    const install = await screen.findByRole("button", { name: "Update now" });
    mocks.installUpdate.mockImplementation(() => new Promise<void>(() => {}));

    fireEvent.click(install);

    expect(await screen.findByText(/Downloading/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Close" })).toHaveLength(0);
  });
});
