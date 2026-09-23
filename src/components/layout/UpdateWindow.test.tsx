// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUpdate: vi.fn(), installUpdate: vi.fn(), close: vi.fn(), invoke: vi.fn(),
  open: vi.fn(), celebrate: vi.fn(), logError: vi.fn(), setTitle: vi.fn(),
}));
vi.mock("@/lib/updater", () => ({ findUpdate: mocks.findUpdate, installUpdate: mocks.installUpdate }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: mocks.close, setTitle: mocks.setTitle }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/confetti", () => ({ celebrate: mocks.celebrate }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/tauri", () => ({ appVersion: async () => "0.4.0" }));
import { UpdateWindow } from "./UpdateWindow";
import { clearReleasePageCache } from "@/lib/release-history";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

beforeEach(() => {
  vi.resetAllMocks();
  clearReleasePageCache();
  window.history.replaceState({}, "", "/?manual=1");
  mocks.invoke.mockImplementation(async (command: string) => (command === "release_notes_page" ? [] : true));
  mocks.findUpdate.mockResolvedValue({ version: "0.4.1", currentVersion: "0.4.0", body: "Release notes" });
  mocks.close.mockResolvedValue(undefined);
  mocks.setTitle.mockResolvedValue(undefined);
  mocks.logError.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

it("keeps installation single-flight and restores close controls after failure", async () => {
  let fail!: (error: Error) => void;
  let progress!: (percent: number) => void;
  mocks.installUpdate.mockImplementation((_update, onProgress) => {
    progress = onProgress;
    return new Promise((_resolve, reject) => { fail = reject; });
  });
  render(<UpdateWindow />);
  const install = await screen.findByRole("button", { name: enShell.updateChecker.updateNow });
  act(() => { fireEvent.click(install); fireEvent.click(install); });
  expect(mocks.installUpdate).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: enCommon.actions.close })).not.toBeInTheDocument();
  act(() => progress(100));
  expect(screen.getByText(enShell.updateChecker.installing)).toBeInTheDocument();
  await act(async () => fail(new Error("save failed")));
  expect(await screen.findByText("Error: save failed")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: enCommon.actions.close })[0]);
  expect(mocks.close).toHaveBeenCalledOnce();
});

it("reports an up-to-date manual check without closing the window", async () => {
  mocks.findUpdate.mockResolvedValue(null);
  render(<UpdateWindow />);
  expect(await screen.findByText("Oleafly v0.4.0 is the latest version")).toBeInTheDocument();
  expect(mocks.close).not.toHaveBeenCalled();
  // The status text commits before the passive celebration effect runs.
  await waitFor(() => expect(mocks.celebrate).toHaveBeenCalledOnce());
});

it("closes an automatic check when no update is available", async () => {
  window.history.replaceState({}, "", "/");
  mocks.findUpdate.mockResolvedValue(null);
  render(<UpdateWindow />);
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
});

it("shows check errors with a route to the release download", async () => {
  mocks.findUpdate.mockRejectedValue(new Error("service unavailable"));
  render(<UpdateWindow />);
  expect(await screen.findByText("Error: service unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: enShell.updateChecker.downloadFromGithub }));
  expect(mocks.open).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly/releases/latest");
  expect(mocks.installUpdate).not.toHaveBeenCalled();
});

it("offers a download for package installations that cannot update in place", async () => {
  mocks.invoke.mockImplementation(async (command: string) => (command === "release_notes_page" ? [] : false));
  render(<UpdateWindow />);
  const download = await screen.findByRole("button", { name: enShell.updateChecker.downloadFromGithub });
  expect(screen.queryByRole("button", { name: enShell.updateChecker.updateNow })).not.toBeInTheDocument();
  fireEvent.click(download);
  expect(mocks.open).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly/releases/tag/v0.4.1");
});

it("tries the install again after it fails", async () => {
  mocks.installUpdate.mockRejectedValueOnce(new Error("connection reset")).mockImplementation(() => new Promise(() => {}));
  render(<UpdateWindow />);
  fireEvent.click(await screen.findByRole("button", { name: enShell.updateChecker.updateNow }));
  expect(await screen.findByText("Error: connection reset")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: enShell.updateChecker.tryAgain }));
  await waitFor(() => expect(mocks.installUpdate).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Error: connection reset")).not.toBeInTheDocument();
});

it("checks again after a failed check", async () => {
  mocks.findUpdate
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ version: "0.4.1", currentVersion: "0.4.0", body: "Release notes" });
  render(<UpdateWindow />);
  expect(await screen.findByText("Error: offline")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: enShell.updateChecker.tryAgain }));
  expect(await screen.findByRole("button", { name: enShell.updateChecker.updateNow })).toBeInTheDocument();
  expect(mocks.findUpdate).toHaveBeenCalledTimes(2);
});

it("loads the notes of skipped releases through the backend", async () => {
  mocks.findUpdate.mockResolvedValue({ version: "0.4.2", currentVersion: "0.3.13", body: "Release notes" });
  mocks.invoke.mockImplementation(async (command: string, args?: { page: number }) => {
    if (command !== "release_notes_page") return true;
    return args?.page === 1
      ? [
          { tag_name: "v0.4.2", body: "## What's new in 0.4.2" },
          { tag_name: "v0.4.1", body: "## What's new in 0.4.1\n\n- Skipped fix.", published_at: "2026-09-13T03:32:37Z" },
          { tag_name: "v0.3.13", body: "## What's new in 0.3.13" },
        ]
      : [];
  });
  render(<UpdateWindow />);
  expect(await screen.findByText("Skipped fix.")).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledWith("release_notes_page", { page: 1 });
  expect(await screen.findByTestId("release-history-end")).toHaveTextContent("You're on v0.3.13");
});
