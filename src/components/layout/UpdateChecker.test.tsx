// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  open: vi.fn(async () => {}),
  runUpdateCheck: vi.fn(),
  installUpdate: vi.fn(),
  logError: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/updater", () => ({
  runUpdateCheck: mocks.runUpdateCheck,
  installUpdate: mocks.installUpdate,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useUpdatesStore } from "@/store/updates";
import { UpdateChecker } from "./UpdateChecker";

const copy = enShell.updateChecker;

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.open.mockClear();
  mocks.runUpdateCheck.mockReset();
  mocks.installUpdate.mockReset();
  mocks.logError.mockClear();
  useUpdatesStore.setState({ lastCheckFailed: false, lastCheckAt: null });
});

describe("UpdateChecker", () => {
  it("says nothing can be checked outside the desktop app", () => {
    mocks.isTauri.mockReturnValue(false);
    render(<UpdateChecker />);
    expect(screen.getByText(copy.unsupported)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: copy.check }),
    ).not.toBeInTheDocument();
  });

  it("reports the app is current and reopens the release notes", async () => {
    mocks.runUpdateCheck.mockResolvedValue(null);
    render(<UpdateChecker />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.check }));
    expect(await screen.findByText(copy.latest)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.releaseNotes }));
    expect(mocks.open).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: copy.checkAgain }));
    expect(mocks.runUpdateCheck).toHaveBeenCalledTimes(2);
  });

  it("offers the new version with its release body", async () => {
    mocks.runUpdateCheck.mockResolvedValue({ version: "9.9.9", body: "Fixes a bug" });
    mocks.installUpdate.mockImplementation(
      async (_update: unknown, onProgress: (percent: number) => void) => {
        onProgress(40);
        await Promise.resolve();
        onProgress(100);
      },
    );
    render(<UpdateChecker />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.check }));
    expect(
      await screen.findByText(copy.available.replace("{{version}}", "9.9.9")),
    ).toBeInTheDocument();
    expect(screen.getByText("Fixes a bug")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.updateNow }));
    await waitFor(() => expect(screen.getByText(copy.installing)).toBeInTheDocument());
    expect(screen.getByText(copy.restartNotice)).toBeInTheDocument();
  });

  it("shows the download percentage while the update arrives", async () => {
    mocks.runUpdateCheck.mockResolvedValue({ version: "9.9.9", body: "   " });
    const reports: ((percent: number) => void)[] = [];
    mocks.installUpdate.mockImplementation(
      (_update: unknown, onProgress: (percent: number) => void) =>
        new Promise(() => {
          reports.push(onProgress);
        }),
    );
    render(<UpdateChecker />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.check }));
    await user.click(await screen.findByRole("button", { name: copy.updateNow }));
    await waitFor(() => expect(reports).toHaveLength(1));
    reports[0](35);
    expect(
      await screen.findByText(copy.downloading.replace("{{percent}}", "35")),
    ).toBeInTheDocument();
  });

  it("reports a failed check and lets the reader retry", async () => {
    mocks.runUpdateCheck.mockRejectedValue(new Error("offline"));
    render(<UpdateChecker />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.check }));
    expect(await screen.findByText(copy.checkFailed)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.downloadFromGithub }));
    expect(mocks.open).toHaveBeenCalledTimes(1);
    mocks.runUpdateCheck.mockResolvedValue(null);
    await user.click(screen.getByRole("button", { name: copy.tryAgain }));
    expect(await screen.findByText(copy.latest)).toBeInTheDocument();
  });

  it("reports a failed install", async () => {
    mocks.runUpdateCheck.mockResolvedValue({ version: "9.9.9", body: null });
    mocks.installUpdate.mockRejectedValue(new Error("bad signature"));
    render(<UpdateChecker />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.check }));
    await user.click(await screen.findByRole("button", { name: copy.updateNow }));
    expect(await screen.findByText(copy.checkFailed)).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("surfaces a silent startup failure with its age", () => {
    useUpdatesStore.setState({
      lastCheckFailed: true,
      lastCheckAt: Date.now() - 90 * 1000,
    });
    render(<UpdateChecker />);
    const prefix = copy.lastCheckFailedAt.split("{{when}}")[0].trim();
    expect(
      screen.getAllByText(new RegExp(prefix)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(copy.lastCheckFailed)).not.toBeInTheDocument();
  });

  it("falls back to the undated failure notice", () => {
    useUpdatesStore.setState({ lastCheckFailed: true, lastCheckAt: null });
    render(<UpdateChecker />);
    expect(screen.getByText(copy.lastCheckFailed)).toBeInTheDocument();
  });
});
